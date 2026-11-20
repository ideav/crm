<?php
# Validate_Token из index.php с access-токеном (#5205): запрос API с Authorization: Bearer a.… проходит
# только с живой строкой refresh; xsrf — от строки refresh; без режима refresh access не принимается.
# Ядро исполняется как есть в неймспейсе V5205, база — таблица в памяти.
# Запуск: php experiments/auth-refresh-validate-5205.test.php; INDEX_PHP=<путь> — другая версия ядра.
namespace V5205;

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
foreach(array("USER"=>18, "XSRF"=>40, "ROLE"=>42, "ACTIVITY"=>124, "TOKEN"=>125, "SECRET"=>130, "ADMINROLE"=>145) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
$z = "abc";
$_SERVER["REQUEST_METHOD"] = "GET"; $_SERVER["REMOTE_ADDR"] = "127.0.0.1";
$GLOBALS["T"] = array(7 => array("up" => 0, "t" => USER, "val" => "ivan", "ord" => 1));
$GLOBALS["HDR"] = array();
class Denied extends \Exception {}
function isApi(){ return TRUE; }
function getallheaders(){ return $GLOBALS["HDR"]; }
function t9n($s){ return $s; }
function my_die($m, $code = ""){ throw new Denied($m); }
function login($z = "", $u = "", $m = ""){ throw new Denied("login:$m"); }
function header($h){}
function setcookie($n, $v, $o = 0){ return TRUE; }
function Admin_token($db){ return str_repeat("e", 128); }
function Admin_xsrf($db){ return "admin-xsrf"; }
function Basic_auth_token($v){ return FALSE; }
function Xsrf_is_legacy($x, $u){ return FALSE; }
function getGrants($r){}
function secureToken(){ return bin2hex(random_bytes(32)); }
function Session_prune($uid){}
function Insert($up, $ord, $t, $val, $msg){
    $id = max(array_keys($GLOBALS["T"])) + 1;
    $GLOBALS["T"][$id] = array("up" => $up, "t" => $t, "val" => $val, "ord" => $ord);
    return $id;
}
function Update_Val($id, $val){ $GLOBALS["T"][$id]["val"] = $val; }
# Запрос «Validate token»: строка токена по tok.id=… (access) или tok.val='…' (прочие), вместе с пользователем
function Exec_sql($sql, $msg){
    $rows = array();
    if($msg === "Validate token"){
        foreach($GLOBALS["T"] as $id => $r){
            if(($r["t"] !== TOKEN) || !isset($GLOBALS["T"][$r["up"]])) continue;
            if(preg_match("/tok\.id=([0-9]+) AND tok\.val LIKE 'r\.%'/", $sql, $m))
                $hit = ($id === (int)$m[1]) && (strpos($r["val"], "r.") === 0);
            elseif(preg_match("/tok\.val='([^']*)'/", $sql, $m))
                $hit = $r["val"] === $m[1];
            else
                $hit = FALSE;
            if($hit)
                $rows[] = array("id" => $r["up"], "val" => $GLOBALS["T"][$r["up"]]["val"], "r" => 99, "role" => "user",
                                "xsrf" => "stored-xsrf", "tok" => $id, "tok_ord" => $r["ord"], "tok_val" => $r["val"],
                                "xsrf_id" => 1, "act_id" => 1);
        }
    }
    return new \ArrayIterator($rows);
}
function mysqli_fetch_array($set){
    if(!$set || !$set->valid()) return NULL;
    $row = $set->current(); $set->next();
    return $row;
}
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
if(preg_match_all('/^(?:defined\("\w+"\) \|\| )?define\("(SESSION_IDLE|SESSION_LIFETIME|SESSION_TOUCH|SESSION_ROTATE|SESSION_MAX|AUTH_COOKIE_SAMESITE)", (.+?)\);/m', $source, $mm, PREG_SET_ORDER))
    foreach($mm as $m) eval('namespace V5205; define("'.$m[1].'", '.$m[2].');');
$missing = array();
foreach(array("Validate_Token", "Token_parse", "Token_stored_val", "Token_db_val", "Token_idle_sql", "Session_refresh_action",
              "Session_cookie_exp", "Auth_cookie_opts", "Auth_cookie", "qrLoginIsHttps", "xsrf", "Auth_conf", "Refresh_mode",
              "Refresh_row_val", "Refresh_idle", "Refresh_xsrf", "Refresh_login", "Refresh_pair", "Access_parse", "Access_mac",
              "Access_issue", "Access_check", "Login_json_fields") as $fn){
    try { eval("namespace V5205; ".extract_function_source($source, $fn)); } catch(\Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в index.php есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
if($missing){ echo "\n$failures FAIL\n"; exit(1); }

# Один запрос API с токеном $tok в Authorization: Bearer — array(пустили?, user_id, xsrf)
function request($tok){
    $GLOBALS["GLOBAL_VARS"] = array();
    $GLOBALS["HDR"] = array("Authorization" => "Bearer $tok");
    try { $ok = Validate_Token(); }
    catch(Denied $e){ return array(FALSE, NULL, NULL); }
    return array($ok, $GLOBALS["GLOBAL_VARS"]["user_id"], $GLOBALS["GLOBAL_VARS"]["xsrf"]);
}

putenv("INTEGRAM_AUTH_TOKENS=refresh");
$pair = Login_json_fields(array(), 7);
$rid = Access_parse($pair["access_token"])["rid"];
$res = request($pair["access_token"]);
expect($res[0] === TRUE && (int)$res[1] === 7, "access в Bearer: вход пользователем строки refresh");
expect($res[2] === $pair["_xsrf"] && $res[2] === Refresh_xsrf($z, $rid), "xsrf запроса — от строки refresh, как в ответе входа");

$p = Access_parse($pair["access_token"]);
expect(request("a.".$p["exp"].".7.".$p["mac"])[0] === FALSE, "access с чужим номером строки (пользователь) не пускает");
expect(request("a.".$p["exp"].".$rid.".str_repeat("0", 64))[0] === FALSE, "access с битой подписью не пускает");
expect(request(substr($pair["refresh_token"], 0))[0] === FALSE, "refresh как токен запроса не пускает");
expect(request($GLOBALS["T"][$rid]["val"])[0] === FALSE, "значение строки из базы как токен не пускает");
$GLOBALS["T"][$rid]["ord"] = 1;
expect(request($pair["access_token"])[0] === FALSE, "простой refresh гасит его access");
$GLOBALS["T"][$rid]["ord"] = (int)floor(time() / 60);
expect(request($pair["access_token"])[0] === TRUE, "живой refresh — access снова годен");
putenv("INTEGRAM_AUTH_TOKENS");
expect(request($pair["access_token"])[0] === FALSE, "режим выключен: access не принимается");
unset($GLOBALS["T"][$rid]);
putenv("INTEGRAM_AUTH_TOKENS=refresh");
expect(request($pair["access_token"])[0] === FALSE, "строка refresh удалена — access мёртв");

echo "\n".($failures ? "$failures FAIL" : "OK")."\n";
exit($failures ? 1 : 0);
