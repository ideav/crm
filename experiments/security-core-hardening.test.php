<?php
# Мерка к правкам безопасности ядра (index.php): xsrf, Basic-вход, синонимы DDL-команд,
# код подтверждения регистрации, add_path в dir_admin, restore_admin, закрытые каталоги.
#
# Запуск: php experiments/security-core-hardening.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра (так тест виден красным на старом index.php).
#
# Функции берутся из index.php как есть; MySQL подменён: Exec_sql отвечает по метке запроса.
#   A) xsrf зависит от токена сессии; значение прежней формулы (общее на базу) распознаётся;
#   B) check() сравнивает xsrf строго: «0e…»-строки и пустой xsrf не проходят;
#   C) логин Basic-входа остаётся строковым литералом SQL при любых символах;
#   D) у DDL-команды `_d_*` нет синонима без префикса — синоним обходил проверку прав и xsrf;
#   E) код подтверждения регистрации случайный и проходит проверку формата ссылки;
#   F) add_path dir_admin не выводит за папку базы, в т.ч. в папку базы с именем-продолжением;
#   G) restore_admin — только по токену владельца базы, кабинета владельца или мастер-токену;
#   H) templates/, logs/, include/ закрыты от прямой выдачи веб-сервером.

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "TOKEN"=>125, "DATABASE"=>271) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
define("ADMINHASH", "adminhash");
$z = "abc";
class Died extends Exception {}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function my_die($msg, $code=""){ throw new Died($msg); }
if(!function_exists("getallheaders")){
    function getallheaders(){ return isset($GLOBALS["HDRS"]) ? $GLOBALS["HDRS"] : array(); }
}

# ── Exec_sql по меткам: последний запрос сохраняется, ответ — из $GLOBALS["ANSWER"][метка] ──
function Exec_sql($sql, $label){
    $GLOBALS["SQL"][$label] = $sql;
    $fn = isset($GLOBALS["ANSWER"][$label]) ? $GLOBALS["ANSWER"][$label] : null;
    return array("rows" => $fn ? $fn($sql) : array());
}
function fk_fetch_array($res){ return count($res["rows"]) ? $res["rows"][0] : NULL; }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["INSERTED"][] = array($up, $t, $val); return 999; }
# Строковый литерал SQL, начинающийся сразу после $prefix: [значение, остаток запроса после закрывающей кавычки]
function sql_literal_after($sql, $prefix){
    $i = strpos($sql, $prefix);
    if($i === false) return array(null, "");
    $i += strlen($prefix); $val = "";
    while($i < strlen($sql) && $sql[$i] !== "'"){
        if($sql[$i] === "\\") $i++;
        $val .= $sql[$i]; $i++;
    }
    return array($val, substr($sql, $i + 1));
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}
$indexPhp = getenv("INDEX_PHP") ?: __DIR__."/../index.php";
$source = file_get_contents($indexPhp);
$missing = array();
foreach(array("Salt", "secureToken", "xsrf", "check", "Xsrf_is_legacy", "Basic_auth_token", "Reg_confirm_code",
              "Dir_admin_add_path", "Restore_admin_allowed") as $fn){
    try {
        eval(str_replace("mysqli_fetch_array(", "fk_fetch_array(", extract_function_source($source, $fn)));
    } catch(Exception $e){
        $missing[] = $fn;
    }
}
expect(!$missing, "в index.php есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));

# ── A) xsrf ────────────────────────────────────────────────────────────────────────────────
if(function_exists("xsrf")){
    $ta = bin2hex(random_bytes(32)); $tb = bin2hex(random_bytes(32));
    expect(xsrf($ta, $z) !== xsrf($tb, $z), "A: у разных сессий одной базы разный xsrf");
    $legacy = substr(hash("sha512", SALT.$z.$z), 0, 22);
    expect(xsrf($ta, $z) !== $legacy, "A: xsrf не равен общему на базу значению прежней формулы");
    expect(strlen(xsrf($ta, $z)) === 22, "A: длина xsrf прежняя (22)");
}
if(function_exists("Xsrf_is_legacy") && function_exists("xsrf")){
    expect(Xsrf_is_legacy(substr(hash("sha512", SALT.$z.$z), 0, 22), "ivan"), "A: прежний xsrf (по имени базы) распознаётся");
    expect(Xsrf_is_legacy(substr(hash("sha512", SALT.$z."ivan"), 0, 22), "ivan"), "A: прежний xsrf (по имени пользователя) распознаётся");
    expect(!Xsrf_is_legacy(xsrf(bin2hex(random_bytes(32)), $z), "ivan"), "A: новый xsrf прежним не считается");
}

# ── B) check() ─────────────────────────────────────────────────────────────────────────────
function check_passes($stored, $posted){
    $GLOBALS["GLOBAL_VARS"]["xsrf"] = $stored;
    $_POST = array();
    if($posted !== null) $_POST["_xsrf"] = $posted;
    try { return check() === true; } catch(Died $e){ return false; }
}
if(function_exists("check")){
    expect(check_passes("a1b2c3d4e5f6a7b8c9d0e1", "a1b2c3d4e5f6a7b8c9d0e1"), "B: верный xsrf проходит");
    expect(!check_passes("a1b2c3d4e5f6a7b8c9d0e1", "a1b2c3d4e5f6a7b8c9d0e2"), "B: чужой xsrf не проходит");
    expect(!check_passes("0e1234567890123456789", "0e9999999999999999999"), "B: «0e…»-строки не равны друг другу");
    expect(!check_passes("", ""), "B: пустой xsrf не проходит");
    expect(!check_passes(null, ""), "B: xsrf, которого нет, не совпадает с пустым");
}

# ── C) Basic-вход ──────────────────────────────────────────────────────────────────────────
if(function_exists("Basic_auth_token")){
    foreach(array("alice", "o'brien", "' OR 1=1 -- ", "x\\' OR u.val!='", "a\\") as $login){
        $GLOBALS["SQL"] = array();
        $GLOBALS["ANSWER"]["Basic authentication"] = null;
        $r = Basic_auth_token(base64_encode("$login:secret"));
        $sql = isset($GLOBALS["SQL"]["Basic authentication"]) ? $GLOBALS["SQL"]["Basic authentication"] : "";
        list($lit, $rest) = sql_literal_after($sql, "u.val='");
        expect(($lit === $login) && (strpos($rest, " AND pwd.up=u.id AND pwd.val='") === 0),
            "C: логин ".json_encode($login)." целиком внутри литерала u.val, запрос не переписан");
        expect($r === FALSE, "C: неверная пара ".json_encode($login)." — вход не выдан");
    }
    $GLOBALS["ANSWER"]["Basic authentication"] = function($sql){ return array(array("tok" => "T0K", "id" => 7)); };
    expect(Basic_auth_token(base64_encode("alice:secret")) === "T0K", "C: верная пара — токен пользователя");
    expect(Basic_auth_token("alice:secret") === "T0K", "C: открытый текст «логин:пароль» тоже принимается");
}

# ── D) синонимы DDL-команд ─────────────────────────────────────────────────────────────────
# Диспетчер проверяет права на структуру и xsrf по префиксу `_d_`. Метка case, стоящая в одной
# связке с `_d_*`, исполняет тот же код без проверки — таких меток быть не должно.
$lines = preg_split('/\r?\n/', $source);
$group = array(); $bad = array();
foreach($lines as $line){
    if(preg_match('/^\s*case\s+"([^"]+)"\s*:/', $line, $m)){ $group[] = $m[1]; continue; }
    if($group){
        $ddl = array_filter($group, function($a){ return strpos($a, "_d_") === 0; });
        if($ddl)
            foreach($group as $a)
                if(strpos($a, "_d_") !== 0) $bad[] = "$a (= ".implode("/", $ddl).")";
    }
    $group = array();
}
expect(!$bad, "D: у команд _d_* нет синонимов без префикса".($bad ? " — найдены: ".implode(", ", $bad) : ""));

# ── E) код подтверждения регистрации ────────────────────────────────────────────────────────
if(function_exists("Reg_confirm_code")){
    $c1 = Reg_confirm_code(); $c2 = Reg_confirm_code();
    expect($c1 !== $c2, "E: коды подтверждения разные при каждом вызове");
    expect(preg_match('/^[a-z0-9]{6,128}$/', $c1) === 1, "E: код проходит проверку формата ссылки подтверждения");
    expect($c1 !== hash("sha512", "xzivan@example.com"), "E: код не вычисляется из адреса почты");
}

# ── F) add_path dir_admin ──────────────────────────────────────────────────────────────────
if(function_exists("Dir_admin_add_path")){
    $cases = array("" => "", "d" => "/d", "/d" => "/d", "/d/" => "/d", "d/e" => "/d/e", "\\d" => "/d", "/" => "",
                   ".." => "", "../x" => "", "/a/../../x" => "", "d\0" => "");
    foreach($cases as $in => $want)
        expect(Dir_admin_add_path($in) === $want, "F: add_path ".json_encode($in)." → ".json_encode($want));
    foreach(array("d", "def", "x/y", "/q", "..d", "z\\w") as $in){
        $p = "download/abc".Dir_admin_add_path($in);
        expect(($p === "download/abc") || (strpos($p, "download/abc/") === 0), "F: путь ".json_encode($in)." остаётся в папке базы abc ($p)");
    }
}

# ── G) restore_admin ───────────────────────────────────────────────────────────────────────
function restore_allowed_with($cookies, $post, $headers){
    $_COOKIE = $cookies; $_POST = $post; $GLOBALS["HDRS"] = $headers;
    return Restore_admin_allowed();
}
if(function_exists("Restore_admin_allowed")){
    $owner = "0wner".str_repeat("a", 59); $other = "07her".str_repeat("b", 59); $cab = "cab".str_repeat("c", 61);
    $GLOBALS["ANSWER"]["Restore admin: owner token"] = function($sql) use ($owner){
        list($v) = sql_literal_after($sql, "tok.val='");
        return ($v === $owner) && (strpos($sql, "u.val='abc'") !== false) ? array(array("id" => 5)) : array();
    };
    $GLOBALS["ANSWER"]["Restore admin: cabinet token"] = function($sql) use ($cab){
        list($v) = sql_literal_after($sql, "tok.val='");
        return ($v === $cab) && (strpos($sql, "db.val='abc'") !== false) ? array(array("id" => 9)) : array();
    };
    expect(!restore_allowed_with(array(), array(), array()), "G: без токена — отказ");
    expect(!restore_allowed_with(array("idb_abc" => $other), array(), array()), "G: токен не владельца — отказ");
    expect(!restore_allowed_with(array("idb_abc" => "' OR '1'='1"), array(), array()), "G: подстановка SQL в куке — отказ");
    expect(!restore_allowed_with(array("idb_my" => $other), array(), array()), "G: кабинет не владельца базы — отказ");
    expect(restore_allowed_with(array("idb_abc" => $owner), array(), array()), "G: кука владельца базы — можно");
    expect(restore_allowed_with(array(), array("token" => $owner), array()), "G: POST token владельца — можно");
    expect(restore_allowed_with(array(), array(), array("X-Authorization" => $owner)), "G: X-Authorization владельца — можно");
    expect(restore_allowed_with(array("idb_my" => $cab), array(), array()), "G: кабинет владельца базы — можно");
    expect(restore_allowed_with(array("idb_abc" => hash("sha512", ADMINHASH.$z)), array(), array()), "G: мастер-токен сервера — можно");
}

# ── H) закрытые каталоги ───────────────────────────────────────────────────────────────────
foreach(array("templates", "logs", "include") as $dir){
    $f = dirname($indexPhp)."/$dir/.htaccess";
    expect(is_file($f) && preg_match('/^\s*Require\s+all\s+denied\s*$/mi', file_get_contents($f)),
        "H: $dir/.htaccess запрещает прямую выдачу (бэкапы, трассировки, журналы, исходники)");
}

ob_end_flush();
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
