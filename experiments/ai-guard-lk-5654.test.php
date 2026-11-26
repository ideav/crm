<?php
# Мерка к ideav/crm#5654: страж данных ИИ-чата включается из ЛК (ideav.ru/my) с оплатой с баланса.
# https://github.com/ideav/crm/issues/5654
#
# Запуск: php experiments/ai-guard-lk-5654.test.php (в гейте — через одноимённый .test.js)
#
# include/ai_guard_lk.php и include/custom_domain.php (Cd_own_db) грузятся в пространство имён T,
# чтобы подменить mysqli_*/Exec_sql/Insert маленькой базой my в памяти. Функции сервиса стража
# (aiAgentGuardService, aiAgentGuardCacheFile, aiAgentGuardStatus) берутся из index.php как есть,
# HTTP к сервису агента (aiAgentGuardFetch/aiAgentGuardPost) подменён.
# Проверяется: чужая база и гость — отказ; списание с баланса и платёж 957 bal2guard; нехватка
# средств — без списания и без платежа; тариф «Старт» режет block и тематики; срок стыкуется;
# переход Старт→Профи; сервису уходит until; кеш статуса чата сбрасывается; сбой сервиса не
# теряет оплату; без адреса агента оплата закрыта.
namespace T;

class Died extends \Exception {}
class Res { public $rows; public $i = 0; function __construct($rows){ $this->rows = $rows; } }

$GLOBALS["failures"] = 0;
function expect($cond, $name, $extra=""){
    if($cond){ echo "PASS: $name\n"; return; }
    echo "FAIL: $name".($extra !== "" ? "\n   ".$extra : "")."\n";
    $GLOBALS["failures"]++;
}
# Вызов, который должен завершиться my_die; возвращает текст ошибки или null.
function dies($fn){
    try { $fn(); } catch(Died $e){ return $e->getMessage(); }
    return null;
}

define("DATABASE", 271);
define("USER_DB_MASK", "/^[a-z]\w{2,14}$/i");

function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function my_die($msg, $code="", $raw=false){ throw new Died(t9n($msg)); }
function check(){ return true; }

# --- база my в памяти ---------------------------------------------------------------------------
function reset_db($balance){
    $GLOBALS["DB"] = array(
        "dbs" => array(10 => array("acme" => 501), 20 => array("other" => 502)),
        "balance" => array(10 => (float)$balance, 20 => 100000.0),
        "pay" => array(),        # id => [user, amount, type, paid, notes]
        "next" => 9000,
        "affected" => 0,
    );
}
function Exec_sql($sql, $msg, $log=true, $fatal=true){
    $db =& $GLOBALS["DB"];
    $db["affected"] = 0;
    if(preg_match("/^SELECT id FROM my WHERE up=(\d+) AND t=271 AND val='([^']*)' LIMIT 1$/", $sql, $m)){
        $u = (int)$m[1];
        return new Res(isset($db["dbs"][$u][$m[2]]) ? array(array("id" => $db["dbs"][$u][$m[2]])) : array());
    }
    if(preg_match('/^UPDATE my SET val=CAST\(val AS DECIMAL\(15,2\)\)-([0-9.]+) WHERE up=(\d+) AND t=285 AND CAST\(val AS DECIMAL\(15,2\)\)>=([0-9.]+) LIMIT 1$/', $sql, $m)){
        $u = (int)$m[2];
        if($m[1] === $m[3] && isset($db["balance"][$u]) && $db["balance"][$u] >= (float)$m[3]){
            $db["balance"][$u] -= (float)$m[1];
            $db["affected"] = 1;
        }
        return true;
    }
    if(strpos($sql, "SELECT") === 0 && strpos($sql, "'bal2guard'") !== false && preg_match('/p\.up=(\d+)/', $sql, $m)){
        $rows = array();
        foreach($db["pay"] as $id => $p)
            if($p["user"] === (int)$m[1] && $p["type"] === "bal2guard" && $p["paid"] !== null && $p["notes"] !== null)
                $rows[] = array("id" => $id, "amount" => $p["amount"], "paid" => $p["paid"], "notes" => $p["notes"]);
        return new Res($rows);
    }
    $GLOBALS["UNKNOWN_SQL"][] = $sql;
    return new Res(array());
}
function mysqli_fetch_assoc($r){
    if(!($r instanceof Res) || $r->i >= count($r->rows)) return null;
    return $r->rows[$r->i++];
}
$GLOBALS["connection"] = null;
function mysqli_affected_rows($c){ return $GLOBALS["DB"]["affected"]; }
function Insert($up, $ord, $t, $val, $msg){
    $db =& $GLOBALS["DB"];
    $id = ++$db["next"];
    if($t === 957)
        $db["pay"][$id] = array("user" => (int)$up, "amount" => (string)$val, "type" => null, "paid" => null, "notes" => null);
    elseif(isset($db["pay"][$up])){
        if($t === 1085) $db["pay"][$up]["type"] = (string)$val;
        if($t === 967) $db["pay"][$up]["paid"] = (string)$val;
        if($t === 1075) $db["pay"][$up]["notes"] = (string)$val;
    }
    return $id;
}
function payments(){ return array_values($GLOBALS["DB"]["pay"]); }
function balance(){ return $GLOBALS["DB"]["balance"][10]; }

# --- настройки и сервис агента -------------------------------------------------------------------
$GLOBALS["__cfg"] = array("INTEGRAM_AGENT_ENDPOINT" => "https://agent.example/agent/chat", "INTEGRAM_AGENT_TOKEN" => "agent-bearer");
function aiConfigValue($names){
    foreach($names as $n)
        if(isset($GLOBALS["__cfg"][$n]) && trim((string)$GLOBALS["__cfg"][$n]) !== "")
            return trim((string)$GLOBALS["__cfg"][$n]);
    return "";
}
$GLOBALS["__get"] = array(); $GLOBALS["__post"] = array();
$GLOBALS["__get_reply"] = json_encode(array("available" => true, "toggle" => true, "topics" => array(), "action" => "mask",
    "settings" => array("enabled" => false, "topics" => array("bank"), "action" => "block", "user_toggle" => true, "until" => null)));
$GLOBALS["__post_reply"] = json_encode(array("available" => true, "toggle" => true, "topics" => array(), "action" => "mask"));
function aiAgentGuardFetch($url, $headers){
    $GLOBALS["__get"][] = array("url" => $url, "headers" => $headers);
    return $GLOBALS["__get_reply"];
}
function aiAgentGuardPost($url, $headers, $body){
    $GLOBALS["__post"][] = array("url" => $url, "headers" => $headers, "body" => json_decode($body, true));
    return $GLOBALS["__post_reply"];
}
function last_post(){ $p = $GLOBALS["__post"]; return $p ? $p[count($p) - 1] : null; }

# --- загрузка кода --------------------------------------------------------------------------------
function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new \Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0;
    for($i = $brace, $len = strlen($source); $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new \Exception("not closed: ".$name);
}
function load_file($path){
    $src = file_get_contents($path);
    eval("namespace T; ?>".$src);
}
$mod = __DIR__."/../include/ai_guard_lk.php";
if(!is_file($mod)){
    echo "FAIL: include/ai_guard_lk.php not found\n";
    exit(1);
}
load_file(__DIR__."/../include/custom_domain.php");
load_file($mod);
$index = file_get_contents(__DIR__."/../index.php");
foreach(array("aiAgentGuardService", "aiAgentGuardCacheFile", "aiAgentGuardStatus") as $fn){
    try { eval("namespace T; ".extract_function_source($index, $fn)); }
    catch(\Exception $e){ echo "FAIL: index.php: ".$e->getMessage()."\n"; exit(1); }
}

function as_user($id, $name="petrov"){ $GLOBALS["GLOBAL_VARS"] = array("user_id" => $id, "user" => $name); }
$plans = Gd_plans();
$M = GD_MONTH; $Y = GD_YEAR;

# --- A: срок и тариф по платежам ------------------------------------------------------------------
$t = 1800000000;
$P = function($plan, $period, $paid, $db="acme", $id=0){ static $n = 0; return array("id" => $id ?: ++$n, "amount" => "1", "paid" => (string)$paid, "notes" => "страж $plan $period ($db)"); };
$c = Gd_compute(array(), "acme");
expect($c["plan"] === "" && $c["until"] === 0, "A1 нет платежей — нет срока");
$c = Gd_compute(array($P("start", "month", $t)), "acme");
expect($c["plan"] === "start" && $c["until"] === $t + $M, "A2 Старт на месяц", json_encode($c));
$c = Gd_compute(array($P("start", "month", $t), $P("start", "year", $t + 100)), "acme");
expect($c["until"] === $t + $M + $Y, "A3 продление стыкуется к концу срока", json_encode($c));
$c = Gd_compute(array($P("start", "month", $t), $P("start", "month", $t + $M + 500)), "acme");
expect($c["until"] === $t + $M + 500 + $M, "A4 после истечения новый период — от даты оплаты", json_encode($c));
$c = Gd_compute(array($P("start", "month", $t), $P("pro", "month", $t + 1000)), "acme");
$left = $M - 1000;
$want = $t + 1000 + $M + (int)floor($left * $plans["start"]["month"] / $plans["pro"]["month"]);
expect($c["plan"] === "pro" && $c["until"] === $want, "A5 Старт→Профи сразу, остаток Старта пересчитан в дни Профи по цене", json_encode($c)." want $want");
$c = Gd_compute(array($P("start", "month", $t, "other"), $P("start", "month", $t, "acmex")), "acme");
expect($c["until"] === 0, "A6 платежи других баз не считаются");
$c = Gd_compute(array(array("id" => 1, "amount" => "1490", "paid" => (string)$t, "notes" => "что-то ещё")), "acme");
expect($c["until"] === 0, "A7 платёж с чужим примечанием не считается");
$c = Gd_compute(array($P("pro", "month", $t + 1000, "acme", 7), $P("start", "month", $t, "acme", 9)), "acme");
expect($c["plan"] === "pro" && $c["until"] === $want, "A8 порядок — по дате оплаты, не по id");

# --- B: что разрешает тариф ----------------------------------------------------------------------
expect($plans["start"]["month"] === 1490 && $plans["start"]["year"] === 15190 && $plans["pro"]["month"] === 2990 && $plans["pro"]["year"] === 30490, "B1 цены тарифов");
expect($plans["start"]["limit"] === 5000 && $plans["pro"]["limit"] === 20000, "B2 лимиты вопросов");
expect(Gd_plan_error("start", array(), "block") !== "", "B3 Старт: block запрещён");
expect(Gd_plan_error("start", array("bank"), "mask") !== "", "B4 Старт: тематики запрещены");
expect(Gd_plan_error("start", array(), "audit") === "" && Gd_plan_error("start", array(), "mask") === "", "B5 Старт: mask и audit можно");
expect(Gd_plan_error("pro", array("bank", "finance", "realtor", "hr", "medical"), "block") === "", "B6 Профи: всё можно");

# --- C: права ------------------------------------------------------------------------------------
reset_db(100000);
as_user(10);
expect(dies(function(){ Gd_status("other"); }) !== null, "C1 статус чужой базы — отказ");
expect(dies(function(){ Gd_action_pay("other", "start", "month"); }) !== null && balance() === 100000.0 && !payments(), "C2 оплата чужой базы — отказ без списания");
as_user(0, "guest");
expect(dies(function(){ Gd_action_pay("acme", "start", "month"); }) !== null && balance() === 100000.0, "C3 гость — отказ");
as_user(10);
$st = Gd_status("acme");
expect($st["db"] === "acme" && $st["state"] === "none" && $st["agent"] === true, "C4 статус своей базы: none", json_encode($st, JSON_UNESCAPED_UNICODE));
expect(isset($st["prices"]["pro"]["year"]) && $st["prices"]["pro"]["year"] === 30490 && $st["limits"]["start"] === 5000, "C5 статус отдаёт цены и лимиты");
expect(array_key_exists("used", $st) && array_key_exists("settings", $st), "C6 статус: used и settings");
$g = end($GLOBALS["__get"]);
expect($g && strpos($g["url"], "https://agent.example/agent/guard?db=acme") === 0 && strpos($g["url"], "lk=1") !== false
    && in_array("Authorization: Bearer agent-bearer", $g["headers"], true), "C7 статус спрашивает сервис ?lk=1 с Bearer", json_encode($g));

# --- D: включение без оплаты и оплата -----------------------------------------------------------
$GLOBALS["__post"] = array();
expect(dies(function(){ Gd_action_set("acme", array("enabled" => "1", "topics" => "", "action" => "mask")); }) !== null && !$GLOBALS["__post"], "D1 включить без оплаты нельзя");
$before = time();
$st = Gd_action_pay("acme", "start", "month");
$pay = payments();
expect(balance() === 100000.0 - 1490, "D2 списано 1490 с баланса", (string)balance());
expect(count($pay) === 1 && $pay[0]["amount"] === "1490" && $pay[0]["type"] === "bal2guard" && $pay[0]["notes"] === "страж start month (acme)"
    && (int)$pay[0]["paid"] >= $before, "D3 платёж 957: сумма, Type bal2guard, Notes", json_encode($pay, JSON_UNESCAPED_UNICODE));
$paid1 = (int)$pay[0]["paid"];
expect($st["state"] === "active" && $st["plan"] === "start" && $st["until"] === $paid1 + $M, "D4 после оплаты активен Старт на месяц", json_encode($st, JSON_UNESCAPED_UNICODE));
$p = last_post();
expect($p && $p["url"] === "https://agent.example/agent/guard" && in_array("Authorization: Bearer agent-bearer", $p["headers"], true), "D5 оплата шлёт настройку сервису", json_encode($p));
expect($p && $p["body"]["db"] === "acme" && $p["body"]["enabled"] === true && $p["body"]["until"] === $paid1 + $M, "D6 сервису уходит enabled и until", json_encode($p ? $p["body"] : null));
# в сервисе был выбор Профи (bank, block) — на Старте его урезали
expect($p && $p["body"]["topics"] === array() && $p["body"]["action"] === "mask", "D7 выбор сверх Старта урезан до тарифа", json_encode($p ? $p["body"] : null));
expect(!empty($st["applied"]), "D8 настройка применена");

# --- E: тариф режет выбор ------------------------------------------------------------------------
$GLOBALS["__post"] = array();
$e = dies(function(){ Gd_action_set("acme", array("enabled" => "1", "topics" => "", "action" => "block")); });
expect($e !== null && !$GLOBALS["__post"], "E1 Старт: запрет (block) — понятный отказ", (string)$e);
$e = dies(function(){ Gd_action_set("acme", array("enabled" => "1", "topics" => "bank,hr", "action" => "mask")); });
expect($e !== null && !$GLOBALS["__post"], "E2 Старт: тематики — отказ", (string)$e);
expect(dies(function(){ Gd_action_set("acme", array("enabled" => "1", "topics" => "casino", "action" => "mask")); }) !== null, "E3 неизвестная тематика — отказ");
expect(dies(function(){ Gd_action_set("acme", array("enabled" => "1", "topics" => "", "action" => "drop")); }) !== null, "E4 неизвестный режим — отказ");
$st = Gd_action_set("acme", array("enabled" => "1", "topics" => "", "action" => "audit", "user_toggle" => "0"));
$p = last_post();
expect($p && $p["body"]["action"] === "audit" && $p["body"]["user_toggle"] === false && $p["body"]["enabled"] === true
    && $p["body"]["until"] === $paid1 + $M, "E5 set: режим, переключатель и until уходят сервису", json_encode($p ? $p["body"] : null));
$st = Gd_action_set("acme", array("enabled" => "0", "topics" => "", "action" => "mask", "user_toggle" => "1"));
$p = last_post();
expect($p && $p["body"]["enabled"] === false, "E6 выключение уходит сервису");

# --- F: продление, нехватка средств, переход на Профи ---------------------------------------------
$st = Gd_action_pay("acme", "start", "year");
expect($st["until"] === $paid1 + $M + $Y && balance() === 100000.0 - 1490 - 15190, "F1 год Старта стыкуется к сроку", json_encode($st));
reset_db(1000);
$GLOBALS["__post"] = array();
$e = dies(function(){ Gd_action_pay("acme", "pro", "month"); });
expect($e !== null && balance() === 1000.0 && !payments() && !$GLOBALS["__post"], "F2 нехватка средств: отказ, без списания и платежа", (string)$e);
reset_db(100000);
Gd_action_pay("acme", "start", "month");
$paidS = (int)payments()[0]["paid"];
$st = Gd_action_pay("acme", "pro", "month");
$paidP = (int)payments()[1]["paid"];
$want = $paidP + $M + (int)floor(($paidS + $M - $paidP) * 1490 / 2990);
expect($st["plan"] === "pro" && $st["until"] === $want && balance() === 100000.0 - 1490 - 2990, "F3 Профи поверх Старта — сразу, с пересчётом остатка", json_encode($st)." want $want");
$e = dies(function(){ Gd_action_pay("acme", "start", "month"); });
expect($e !== null && count(payments()) === 2 && balance() === 100000.0 - 1490 - 2990, "F4 Старт во время Профи не продаётся", (string)$e);
$st = Gd_action_set("acme", array("enabled" => "1", "topics" => "bank,hr", "action" => "block"));
$p = last_post();
expect($p && $p["body"]["topics"] === array("bank", "hr") && $p["body"]["action"] === "block", "F5 Профи: тематики и запрет разрешены", json_encode($p ? $p["body"] : null));
expect(dies(function(){ Gd_action_pay("acme", "gold", "month"); }) !== null && dies(function(){ Gd_action_pay("acme", "pro", "week"); }) !== null
    && count(payments()) === 2, "F6 неизвестный тариф или период — отказ без списания");

# --- G: кеш статуса чата сбрасывается ------------------------------------------------------------
$cache = aiAgentGuardCacheFile("acme");
expect($cache !== "" && strpos($cache, "ai_agent_guard_acme_") !== false, "G1 файл кеша статуса чата", $cache);
file_put_contents($cache, json_encode(array("at" => time(), "status" => array("available" => false))));
Gd_action_set("acme", array("enabled" => "1", "topics" => "", "action" => "mask"));
expect(!is_file($cache), "G2 set сбрасывает кеш статуса чата");
file_put_contents($cache, json_encode(array("at" => time(), "status" => array("available" => false))));
Gd_action_pay("acme", "pro", "month");
expect(!is_file($cache), "G3 оплата сбрасывает кеш статуса чата");

# --- H: сервис недоступен или не настроен ---------------------------------------------------------
reset_db(100000);
$GLOBALS["__post_reply"] = false;
$GLOBALS["__get_reply"] = false;
$st = Gd_action_pay("acme", "start", "month");
expect(count(payments()) === 1 && balance() === 100000.0 - 1490 && $st["state"] === "active", "H1 сбой сервиса: оплата прошла");
expect(empty($st["applied"]) && !empty($st["notice"]), "H2 сбой сервиса: ответ говорит, что настройка не применилась", json_encode($st, JSON_UNESCAPED_UNICODE));
$GLOBALS["__post_reply"] = json_encode(array("available" => true));
$st = Gd_action_set("acme", array("enabled" => "1", "topics" => "", "action" => "mask"));
expect(!empty($st["applied"]), "H3 повторный set применяет настройку");
$GLOBALS["__cfg"]["INTEGRAM_AGENT_ENDPOINT"] = "";
$st = Gd_status("acme");
expect($st["agent"] === false && $st["state"] === "active", "H4 без адреса агента: статус с флагом agent=false");
expect(dies(function(){ Gd_action_pay("acme", "start", "month"); }) !== null && count(payments()) === 1, "H5 без адреса агента оплата закрыта");

echo $GLOBALS["failures"] ? $GLOBALS["failures"]." FAILED\n" : "All passed\n";
exit($GLOBALS["failures"] ? 1 : 0);
