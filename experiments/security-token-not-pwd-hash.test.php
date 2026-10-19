<?php
# Мерка: токен сессии не совпадает с хешем пароля.
#
# Запуск: php experiments/security-token-not-pwd-hash.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра.
#
# До подтверждения регистрации в токене пользователя лежит хеш пароля; подтверждение переносило
# хеш в пароль и оставляло тот же токен. Basic-вход клал хеш пароля в токен, если токена не было.
# Функции берутся из index.php как есть; MySQL подменён: Exec_sql отвечает по метке запроса.
#   A) updateTokens заменяет токен, равный одному из переданных хешей пароля, случайным
#      и сохраняет его; прочий токен сохраняется как есть;
#   B) Basic-вход выдаёт токен, не равный хешу пароля, и заменяет такой токен, если он уже есть.

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "TOKEN"=>125, "ACTIVITY"=>124) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
$z = "abc";
function Exec_sql($sql, $label){
    $fn = isset($GLOBALS["ANSWER"][$label]) ? $GLOBALS["ANSWER"][$label] : null;
    return array("rows" => $fn ? $fn($sql) : array());
}
function fk_fetch_array($res){ return count($res["rows"]) ? $res["rows"][0] : NULL; }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["W"][] = array("insert", $up, $t, $val); return 999; }
function Update_Val($id, $val){ $GLOBALS["W"][] = array("update", $id, $val); }

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
$source = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../index.php");
foreach(array("Salt", "secureToken", "xsrf", "updateTokens", "Basic_auth_token") as $fn){
    try {
        eval(str_replace("mysqli_fetch_array(", "fk_fetch_array(", extract_function_source($source, $fn)));
    } catch(Exception $e){
        echo "FAIL: в index.php нет функции $fn\n";
        exit(1);
    }
}
function saved_token($tokId){
    foreach($GLOBALS["W"] as $w)
        if(($w[0] === "update") && ($w[1] === $tokId)) return $w[2];
    return null;
}

# ── A) updateTokens ────────────────────────────────────────────────────────────────────────
$hash = hash("sha512", SALT."my"."secret1");
$GLOBALS["W"] = array();
updateTokens(array("uid" => 7, "tok" => 70, "token" => $hash, "xsrf" => 71, "act" => 72), array($hash));
$tok = $GLOBALS["GLOBAL_VARS"]["token"];
expect($tok !== $hash, "A: токен, равный хешу пароля, заменён");
expect(preg_match('/^[0-9a-f]{64}$/', (string)$tok) === 1, "A: новый токен — случайные 32 байта");
expect(saved_token(70) === $tok, "A: новый токен сохранён в записи токена пользователя");

$GLOBALS["W"] = array();
updateTokens(array("uid" => 7, "tok" => 70, "token" => "keepme", "xsrf" => 71, "act" => 72), array($hash, "other"));
expect($GLOBALS["GLOBAL_VARS"]["token"] === "keepme", "A: токен, не равный хешу пароля, сохраняется");
expect(saved_token(70) === null, "A: такой токен не перезаписывается");

$GLOBALS["W"] = array();
updateTokens(array("uid" => 7, "tok" => 70, "token" => "keepme", "xsrf" => 71, "act" => 72));
expect($GLOBALS["GLOBAL_VARS"]["token"] === "keepme", "A: без списка хешей — прежнее поведение (токен сохраняется)");

# ── B) Basic-вход ──────────────────────────────────────────────────────────────────────────
$pwd = hash("sha512", SALT.$z."secret2");
$GLOBALS["ANSWER"]["Basic authentication"] = function($sql){ return array(array("tok" => null, "tok_id" => null, "id" => 8)); };
$GLOBALS["W"] = array();
$t = Basic_auth_token(base64_encode("bob:secret2"));
expect(is_string($t) && ($t !== $pwd), "B: пользователю без токена выдан токен, не равный хешу пароля");
expect(count($GLOBALS["W"]) === 1 && $GLOBALS["W"][0][0] === "insert" && $GLOBALS["W"][0][3] === $t, "B: выданный токен сохранён");

$GLOBALS["ANSWER"]["Basic authentication"] = function($sql) use ($pwd){ return array(array("tok" => $pwd, "tok_id" => 80, "id" => 8)); };
$GLOBALS["W"] = array();
$t = Basic_auth_token(base64_encode("bob:secret2"));
expect(is_string($t) && ($t !== $pwd), "B: токен, равный хешу пароля, при Basic-входе заменён");
expect(saved_token(80) === $t, "B: заменённый токен сохранён в той же записи");

$GLOBALS["ANSWER"]["Basic authentication"] = function($sql){ return array(array("tok" => "T0K", "tok_id" => 80, "id" => 8)); };
$GLOBALS["W"] = array();
expect(Basic_auth_token(base64_encode("bob:secret2")) === "T0K" && !$GLOBALS["W"], "B: обычный токен возвращается без записи");

ob_end_flush();
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
