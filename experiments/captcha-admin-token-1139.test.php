<?php
# Мерка #1139: капча входа и мастер-токен супер-админа (index.php).
#   A) с CAPTCHA_AFTER_RETRIES неудач подряд вход без капчи не проходит, и пароль не сверяется;
#   B) вход admin паролем сервера — только с капчей, валидная кука другого пользователя не в счёт;
#   C) мастер-токен не равен sha512(ADMINHASH.база) и меняется со сменой SALT;
#   D) ключ-заглушка капчи пропускает только на localhost;
#   E) дефолтные секреты на сервере — отказ запуска, на localhost — работа.
# Запуск: php experiments/captcha-admin-token-1139.test.php (в гейте — через .test.js).
# INDEX_PHP=<путь> — другая версия ядра. Каждый сценарий — отдельным процессом.

$indexPhp = getenv("INDEX_PHP") ?: __DIR__."/../index.php";
if(!isset($argv[1])){
    $cases = array(
        "A1" => "логин с 2 неудачами, без капчи, верный пароль — 403 капча",
        "A2" => "логин с 2 неудачами, с решённой капчей — вход",
        "A3" => "логин с 1 неудачей, без капчи — вход",
        "A4" => "логин с 2 неудачами, без капчи, неверный пароль — 403 капча, счётчик не растёт",
        "B1" => "admin паролем сервера без капчи — 403 капча",
        "B2" => "admin без капчи с валидной кукой другого пользователя — 403 капча",
        "B3" => "admin с решённой капчей — вход",
        "C1" => "мастер-токен не sha512(ADMINHASH.база) и зависит от SALT",
        "D1" => "заглушка капчи на сервере — отказ",
        "D2" => "заглушка капчи на localhost — пропуск",
        "E1" => "дефолтные секреты на сервере — отказ запуска",
        "E2" => "дефолтные секреты на localhost — работа",
        "E3" => "свои секреты на сервере — работа");
    $fail = 0;
    foreach($cases as $id => $name){
        $out = array(); $code = 0;
        exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." ".$id." 2>&1", $out, $code);
        $ok = ($code === 0) && (end($out) === "OK");
        echo ($ok ? "PASS" : "FAIL").": $id $name".($ok ? "" : "  → ".implode(" | ", array_slice($out, -3)))."\n";
        if(!$ok) $fail++;
    }
    echo $fail ? "$fail FAILED\n" : "All passed\n";
    exit($fail ? 1 : 0);
}

# ── один сценарий ──────────────────────────────────────────────────────────────────────────
$case = $argv[1];
$local = in_array($case, array("D2", "E2"), TRUE);
$_SERVER["SERVER_NAME"] = $local ? "localhost" : "ideav.ru";
$_SERVER["REMOTE_ADDR"] = "1.2.3.4";
$z = "abc";
$defaults = ($case[0] === "E") && ($case !== "E3");
$salt = $defaults ? "yyy" : (getenv("T_SALT") ?: "salt-1139");
foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "TOKEN"=>125, "ACTIVITY"=>124, "RETRIES"=>301,
              "RETRIES_LIMIT"=>5, "LOGIN_LOCK_S"=>900, "CAPTCHA_AFTER_RETRIES"=>2, "EMAIL"=>41, "DATABASE"=>271) as $k => $v)
    define($k, $v);
define("SALT", $salt);
define("ADMINHASH", sha1($_SERVER["SERVER_NAME"].$z.($defaults ? "xxx" : "master-1139")));
define("SMARTCAPTCHA_SERVER_KEY", $case[0] === "D" ? "ysc2_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" : "ysc2_real");

class Died extends Exception { public $payload; function __construct($p){ parent::__construct(is_string($p) ? $p : ""); $this->payload = $p; } }
function check($cond, $msg){ if(!$cond){ echo "assert: $msg\n"; exit(1); } }
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function my_die($msg){ throw new Died($msg); }
function api_dump($json){ throw new Died(json_decode($json, true)); }
function isApi(){ return TRUE; }
function wlog($m, $f){}
function login(){ throw new Died("LOGIN_PAGE"); }
function Auth_cookie_opts($e){ return array(); }
function Pwd_verify($p, $h){ return $p === $h; }
function Pwd_needs_rehash($h){ return FALSE; }
function Update_Val($id, $v){ $GLOBALS["UPDATED"][$id] = $v; }
function Insert($up, $ord, $t, $v, $m){ $GLOBALS["INSERTED"][] = array($up, $t, $v); return 77; }
function Rotate_token_hashes($row, $u, $p, $ch){ return NULL; }
function updateTokens($row, $x){ $GLOBALS["GLOBAL_VARS"]["token"] = "usertok"; $GLOBALS["GLOBAL_VARS"]["xsrf"] = "userxsrf"; }
function hasValidTokenCookie(){ return !empty($GLOBALS["COOKIE_OK"]); }
function Exec_sql($sql, $label){ $r = new stdClass; $r->i = 0; $r->rows = isset($GLOBALS["ROWS"][$label]) ? $GLOBALS["ROWS"][$label] : array(); return $r; }
function fk_fetch($r){ return $r->i < count($r->rows) ? $r->rows[$r->i++] : NULL; }
function fk_seek($r, $n){ $r->i = $n; }
function Token_key_sql($a){ return "1"; }
if($case[0] !== "D")
    eval('function verifyCaptcha($t){ return $t === "good"; }');

function extract_src($source, $start, $end = NULL){
    $s = strpos($source, $start);
    if($s === false) return NULL;
    if($end !== NULL) return substr($source, $s, strpos($source, $end, $s) - $s);
    $depth = 0;
    for($i = strpos($source, "{", $s); $i < strlen($source); $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}" && --$depth === 0) return substr($source, $s, $i - $s + 1);
    }
}
$source = file_get_contents($indexPhp);
$fns = array("Login_lock_left", "Login_locked_die", "incrementRetries", "Login_captcha_passed", "Login_captcha_die",
             "Login_captcha_required", "Admin_token", "Admin_xsrf", "Is_local_server", "Secrets_are_default", "Secrets_guard");
if($case[0] === "D") $fns[] = "verifyCaptcha";
foreach($fns as $fn){
    $src = extract_src($source, "function $fn(");
    if($src !== NULL) eval($src);
}

# Блок case "auth" из ядра — в функцию; MySQL-итератор подменён
$auth = extract_src($source, 'case "auth":', 'case "confirm":');
check($auth !== NULL, "в index.php нет case auth");
$auth = str_replace(array("mysqli_fetch_array(", "mysqli_data_seek("), array("fk_fetch(", "fk_seek("), $auth);
eval('function run_auth(){ global $z; switch("auth"){ '.$auth.' } }');

function auth_try($login, $pwd, $token, $retries, $cookieOk = FALSE){
    $GLOBALS["_POST"] = array("login" => $login, "pwd" => $pwd);
    if($token !== NULL) $GLOBALS["_POST"]["smart-token"] = $token;
    $GLOBALS["COOKIE_OK"] = $cookieOk;
    $GLOBALS["UPDATED"] = array(); $GLOBALS["GLOBAL_VARS"] = array();
    $GLOBALS["ROWS"] = array("Authenticate user" => $retries === NULL ? array() : array(array("uid" => 5, "val" => $login,
        "pwd_id" => 6, "pwd" => "right", "tok" => 7, "token" => "t", "act" => 8, "xsrf" => 9, "retries_id" => 10, "retries" => $retries)));
    try { run_auth(); } catch(Died $d){ return $d->payload; }
    return NULL;
}
function is_captcha_403($r){ return is_array($r) && isset($r["captcha"]) && $r["captcha"] === "required"; }
function is_login($r){ return is_array($r) && isset($r["token"]); }
$t = time();
switch($case){
    case "A1": check(is_captcha_403(auth_try("bob", "right", NULL, "2:$t")), "без капчи вошёл"); break;
    case "A2": check(is_login(auth_try("bob", "right", "good", "2:$t")), "с капчей не вошёл"); break;
    case "A3": check(is_login(auth_try("bob", "right", NULL, "1:$t")), "1 неудача — не вошёл"); break;
    case "A4": $r = auth_try("bob", "wrong", NULL, "2:$t");
        check(is_captcha_403($r), "нет требования капчи");
        check(!isset($GLOBALS["UPDATED"][10]), "счётчик неудач вырос — пароль сверялся"); break;
    case "B1": check(is_captcha_403(auth_try("admin", "master-1139", NULL, NULL)), "admin вошёл без капчи"); break;
    case "B2": check(is_captcha_403(auth_try("admin", "master-1139", NULL, NULL, TRUE)), "admin вошёл без капчи по чужой куке"); break;
    case "B3": $r = auth_try("admin", "master-1139", "good", NULL);
        check(is_login($r) && $r["id"] === 0, "admin с капчей не вошёл"); break;
    case "C1": $r = auth_try("admin", "master-1139", "good", NULL);
        check(is_login($r), "admin не вошёл");
        check($r["token"] !== hash("sha512", ADMINHASH.$z), "мастер-токен = sha512(ADMINHASH.база)");
        if(!getenv("T_SALT")){
            exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." C1tok", $o);
            putenv("T_SALT=salt-other");
            exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." C1tok", $o2);
            check(end($o) !== end($o2), "мастер-токен не зависит от SALT");
        } break;
    case "C1tok": $r = auth_try("admin", "master-1139", "good", NULL); echo $r["token"]."\n"; exit(0);
    case "D1": check(verifyCaptcha("") === FALSE && verifyCaptcha("x") === FALSE, "заглушка пропустила на сервере"); break;
    case "D2": check(verifyCaptcha("") === TRUE, "заглушка не пропустила на localhost"); break;
    case "E1": case "E2": case "E3":
        check(function_exists("Secrets_guard"), "нет Secrets_guard");
        if($case === "E1") register_shutdown_function(function(){ echo "\nOK\n"; });  # отказ = die()
        ob_start(); Secrets_guard($z); ob_end_clean();
        check($case !== "E1", "дефолтные секреты на сервере пропущены"); break;
}
echo "OK\n";
