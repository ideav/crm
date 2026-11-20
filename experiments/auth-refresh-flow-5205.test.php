<?php
# Сценарий режима refresh/access (#5205) на функциях ядра поверх таблицы в памяти:
#   вход → обновление (ротация) → повтор прежнего refresh закрывает сессию; простой гасит refresh;
#   параллельное обновление тем же refresh проходит один раз; access живёт подписью на строке.
# Заглушки mysqli_* и Exec_sql — в неймспейсе (в CI php грузит mysqli, глобальные конфликтуют).
# Запуск: php experiments/auth-refresh-flow-5205.test.php; INDEX_PHP=<путь> — другая версия ядра.
namespace Test5205;

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
define("SALT", "yyy"); define("USER", 18); define("TOKEN", 125);
$z = "abc";
$GLOBALS["T"] = array();      # id => array(up, t, val, ord) — строки таблицы базы
$GLOBALS["NOW"] = 2000000000; # часы ядра в сценарии
$GLOBALS["AFFECTED"] = 0;
$GLOBALS["connection"] = NULL;
$GLOBALS["T"][7] = array("up" => 0, "t" => USER, "val" => "ivan", "ord" => 1);
function time(){ return $GLOBALS["NOW"]; }
function secureToken(){ return bin2hex(random_bytes(32)); }
function Session_prune($uid){}
function Insert($up, $ord, $t, $val, $msg){
    $id = max(array_keys($GLOBALS["T"])) + 1;
    $GLOBALS["T"][$id] = array("up" => $up, "t" => $t, "val" => $val, "ord" => $ord);
    return $id;
}
function Exec_sql($sql, $msg){
    $T =& $GLOBALS["T"];
    if(preg_match("/^SELECT .* tok\.val LIKE 'r\.([0-9]+)\.%'$/s", $sql, $m)){
        $rows = array();
        foreach($T as $id => $r)
            if(($r["t"] === TOKEN) && (strpos($r["val"], "r.$m[1].") === 0) && isset($T[$r["up"]]) && ($T[$r["up"]]["t"] === USER))
                $rows[] = array("id" => $id, "up" => $r["up"], "val" => $r["val"], "ord" => $r["ord"]);
        return new \ArrayObject($rows);
    }
    if(preg_match("/^DELETE FROM \w+ WHERE id=([0-9]+) AND t=".TOKEN."( AND val LIKE 'r\.%')?$/", $sql, $m)){
        if(isset($T[(int)$m[1]]) && (empty($m[2]) || strpos($T[(int)$m[1]]["val"], "r.") === 0))
            unset($T[(int)$m[1]]);
        return NULL;
    }
    if(preg_match("/^UPDATE \w+ SET val='([^']*)', ord=([0-9]+) WHERE id=([0-9]+) AND val='([^']*)'$/", $sql, $m)){
        if(!empty($GLOBALS["BEFORE_UPDATE"]))
            ($GLOBALS["BEFORE_UPDATE"])();  # другой запрос вклинился между чтением и записью
        $GLOBALS["AFFECTED"] = 0;
        if(isset($T[(int)$m[3]]) && ($T[(int)$m[3]]["val"] === $m[4])){
            $T[(int)$m[3]]["val"] = $m[1]; $T[(int)$m[3]]["ord"] = (int)$m[2];
            $GLOBALS["AFFECTED"] = 1;
        }
        return NULL;
    }
    throw new \Exception("unexpected SQL: $sql");
}
function mysqli_fetch_array($set){
    if(!$set || !count($set)) return NULL;
    $a = $set->getArrayCopy(); $row = array_shift($a); $set->exchangeArray($a);
    return $row;
}
function mysqli_affected_rows($c){ return $GLOBALS["AFFECTED"]; }

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new \Exception("not found: ".$name);
    $depth = 0; $len = strlen($source);
    for($i = strpos($source, "{", $start); $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new \Exception("not closed: ".$name);
}
$source = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../index.php");
if(preg_match_all('/^(?:defined\("\w+"\) \|\| )?define\("(SESSION_LIFETIME|SESSION_MAX)", (.+?)\);/m', $source, $mm, PREG_SET_ORDER))
    foreach($mm as $m) eval('namespace Test5205; define("'.$m[1].'", '.$m[2].');');
$missing = array();
foreach(array("xsrf", "Auth_conf", "Refresh_mode", "Refresh_parse", "Refresh_row_val", "Refresh_row_matches", "Refresh_idle",
              "Refresh_xsrf", "Access_parse", "Access_mac", "Access_issue", "Access_check", "Refresh_login", "Refresh_pair",
              "Refresh_find", "Refresh_rotate", "Login_json_fields", "Session_drop", "Token_parse", "Token_stored_val") as $fn){
    try { eval("namespace Test5205; ".extract_function_source($source, $fn)); } catch(\Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в index.php есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
if($missing){ echo "\n$failures FAIL\n"; exit(1); }

# Проверка access так, как это делает Validate_Token: строка по номеру, подпись и простой — по её значению
function access_ok($tok){
    global $z;
    $p = Access_parse($tok);
    if(!$p || !isset($GLOBALS["T"][$p["rid"]]) || (strpos($GLOBALS["T"][$p["rid"]]["val"], "r.") !== 0)) return false;
    $row = $GLOBALS["T"][$p["rid"]];
    return Access_check($z, $p, $row["val"], time()) && !Refresh_idle($row["ord"], time());
}

putenv("INTEGRAM_AUTH_TOKENS");
$plain = Login_json_fields(array("token" => "s.1.x", "_xsrf" => "q"), 7);
expect($plain === array("token" => "s.1.x", "_xsrf" => "q") && count($GLOBALS["T"]) === 1, "режим выключен: ответ входа прежний, строк не прибавилось");
putenv("INTEGRAM_AUTH_TOKENS=refresh");
expect(Login_json_fields(array("token" => "adm"), 0) === array("token" => "adm"), "admin (без пользователя) пары не получает");

$login = Login_json_fields(array("token" => "s.1.x", "_xsrf" => "q", "id" => 7), 7);
expect(isset($login["access_token"], $login["refresh_token"]) && $login["token"] === $login["access_token"]
    && $login["token_type"] === "Bearer" && $login["expires_in"] === 900 && $login["id"] === 7, "вход: пара токенов, token = access");
$rid = Access_parse($login["access_token"])["rid"];
expect(isset($GLOBALS["T"][$rid]) && $GLOBALS["T"][$rid]["up"] === 7 && strpos($GLOBALS["T"][$rid]["val"], explode(".", $login["refresh_token"])[2]) === false,
    "вход: строка refresh у пользователя, секрета в базе нет");
expect($login["_xsrf"] === Refresh_xsrf($z, $rid), "вход: xsrf — от строки refresh");
expect(access_ok($login["access_token"]), "access принимается");

$GLOBALS["NOW"] += 600;
$n1 = Refresh_rotate($login["refresh_token"]);
expect($n1 && $n1["refresh_token"] !== $login["refresh_token"] && $n1["_xsrf"] === $login["_xsrf"], "обновление: новый refresh, xsrf прежний");
expect(Access_parse($n1["access_token"])["rid"] === $rid && count($GLOBALS["T"]) === 2, "обновление: та же строка, новых строк нет");
expect(!access_ok($login["access_token"]) && access_ok($n1["access_token"]), "обновление: прежний access мёртв, новый живёт");
$GLOBALS["NOW"] += 901;
expect(!access_ok($n1["access_token"]), "access гаснет через ACCESS_TTL");

$n2 = Refresh_rotate($n1["refresh_token"]);
expect($n2 && access_ok($n2["access_token"]), "второе обновление проходит");
expect(Refresh_rotate($n1["refresh_token"]) === NULL, "повтор прежнего refresh отклонён");
expect(!isset($GLOBALS["T"][$rid]) && !access_ok($n2["access_token"]) && Refresh_rotate($n2["refresh_token"]) === NULL,
    "повтор прежнего refresh закрывает сессию: гаснут и действующие токены");

$s2 = Login_json_fields(array(), 7);
$GLOBALS["NOW"] += 31 * 86400;
expect(Refresh_rotate($s2["refresh_token"]) === NULL && !isset($GLOBALS["T"][Access_parse($s2["access_token"])["rid"]]), "простой больше REFRESH_TTL: refresh отклонён, строка удалена");

$s3 = Login_json_fields(array(), 7);
$row3 = Access_parse($s3["access_token"])["rid"];
# Два запроса с одним refresh: второй прочёл строку, но первый успел её ротировать до записи второго
$GLOBALS["BEFORE_UPDATE"] = function(){
    global $s3, $first;
    $GLOBALS["BEFORE_UPDATE"] = NULL;
    $first = Refresh_rotate($s3["refresh_token"]);
};
$second = Refresh_rotate($s3["refresh_token"]);
expect($first !== NULL && access_ok($first["access_token"]), "параллельное обновление: первое проходит");
expect($second === NULL && access_ok($first["access_token"]), "параллельное обновление: второе отклонено, сессия первого цела");
$GLOBALS["T"][50] = array("up" => 7, "t" => TOKEN, "val" => str_repeat("f", 64), "ord" => 1);  # ключ API
$s4 = Login_json_fields(array(), 7);
expect(Session_drop($s4["access_token"]) === TRUE && !access_ok($s4["access_token"]) && Refresh_rotate($s4["refresh_token"]) === NULL
    && isset($GLOBALS["T"][50]) && isset($GLOBALS["T"][$row3]), "выход по access закрывает только его сессию, ключ API и другие сессии целы");
expect(Refresh_rotate("r.".(time() - 1).".".str_repeat("a", 64)) === NULL && Refresh_rotate("мусор") === NULL, "истёкший и битый refresh отклонены");

echo "\n".($failures ? "$failures FAIL" : "OK")."\n";
exit($failures ? 1 : 0);
