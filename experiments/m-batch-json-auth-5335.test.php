<?php
# Мерка к issue #5335: _m_batch отвечает JSON при любом способе авторизации, без ?JSON в адресе.
# https://github.com/ideav/crm/issues/5335
#
# Запуск: php experiments/m-batch-json-auth-5335.test.php (в гейте — через одноимённый .test.js)
#
# Маршрут запроса воспроизводится как в ядре: Api_always_json_mark($a), затем Validate_Token.
# isApi, Validate_Token и Api_always_json_mark берутся из index.php как есть и исполняются в
# пространстве имён M5335: неквалифицированные вызовы (Exec_sql, getallheaders, header, login…)
# находят заглушки этого пространства. Каждый случай — отдельный процесс: ветки ядра делают die().
#   1) _m_batch, токен в заголовке X-Authorization, ?JSON нет — пользователь опознан;
#   2) _m_batch, Authorization: Bearer <токен> — пользователь опознан;
#   3) _m_batch без авторизации, гостя нет — 401 и JSON-ошибка, а не страница входа;
#   4) _m_batch, токен в теле — как и прежде, пользователь опознан;
#   5) обычная страница (object) с заголовком и без ?JSON — прежнее поведение: вход, не JSON.

const USER_TOK = "usertok5335";

if(isset($argv[1]) && $argv[1] !== ""){
    run_case($argv[1]);
    exit(0);
}

$failures = 0;
function expect($cond, $name, $out = ""){
    global $failures;
    if($cond){ echo "PASS: $name\n"; }
    else{ echo "FAIL: $name".($out === "" ? "" : " — вывод: ".trim(substr($out, 0, 300)))."\n"; $failures++; }
}
function child($case){
    $out = shell_exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." ".escapeshellarg($case)." 2>&1");
    $p = strrpos((string)$out, "@@");
    $res = $p === false ? null : json_decode(substr($out, $p + 2), true);
    if(!is_array($res))
        $res = array();
    $res["out"] = (string)$out;
    return $res;
}

$r = child("batch_x_authorization");
expect(!empty($r["ok"]) && $r["user"] === "tester", "_m_batch, X-Authorization без ?JSON: пользователь опознан", $r["out"]);
expect(!empty($r["api"]), "_m_batch, X-Authorization без ?JSON: запрос — API (ответ JSON)", $r["out"]);

$r = child("batch_bearer");
expect(!empty($r["ok"]) && $r["user"] === "tester", "_m_batch, Authorization: Bearer без ?JSON: пользователь опознан", $r["out"]);

$r = child("batch_no_auth");
expect(strpos($r["out"], "No authorization token provided") !== false, "_m_batch без авторизации: JSON-ошибка", $r["out"]);
expect(strpos($r["out"], "STATUS:401") !== false, "_m_batch без авторизации: код 401", $r["out"]);
expect(strpos($r["out"], "LOGIN:") === false, "_m_batch без авторизации: не страница входа", $r["out"]);

$r = child("batch_body_token");
expect(!empty($r["ok"]) && $r["user"] === "tester", "_m_batch, token в теле: пользователь опознан", $r["out"]);

$r = child("page_x_authorization");
expect(empty($r["ok"]) && strpos($r["out"], "LOGIN:") !== false, "страница object с заголовком без ?JSON: прежнее поведение — вход", $r["out"]);

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
exit(0);

# ---------------------------------------------------------------- дочерний процесс

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) return "";
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

function run_case($case){
    foreach(array("USER"=>18, "TOKEN"=>125, "XSRF"=>40, "ROLE"=>42, "ACTIVITY"=>124, "SECRET"=>130,
                  "ADMINROLE"=>145, "COOKIES_EXPIRE"=>2592000, "ADMINHASH"=>"adminhash", "SALT"=>"salt",
                  "AUTH_COOKIE_SAMESITE"=>"Lax", "SESSION_IDLE"=>2592000, "SESSION_LIFETIME"=>31536000,
                  "SESSION_TOUCH"=>86400, "SESSION_ROTATE"=>604800) as $k=>$v)
        define($k, $v);
    $src = file_get_contents(__DIR__."/../index.php");
    $code = "";
    # Api_always_json_mark может отсутствовать (ядро до #5335) — тогда маршрут идёт без неё, как было
    foreach(array("isApi", "Api_always_json_mark", "Validate_Token", "Guest_session", "Token_parse", "Token_stored_val",
                  "Token_db_val", "Token_idle_sql", "Session_refresh_action", "Session_cookie_exp",
                  "Auth_cookie_opts", "Auth_cookie", "qrLoginIsHttps") as $fn)
        $code .= extract_function_source($src, $fn)."\n";
    eval("namespace M5335;\n".stubs()."\n".$code);

    $GLOBALS["z"] = "demo";
    $GLOBALS["HEADERS"] = array();
    $_SERVER["REQUEST_METHOD"] = "POST";
    $_POST["ops"] = "[]";
    switch($case){
        case "batch_x_authorization": $a = "_m_batch"; $GLOBALS["HEADERS"]["X-Authorization"] = USER_TOK; break;
        case "batch_bearer":          $a = "_m_batch"; $GLOBALS["HEADERS"]["Authorization"] = "Bearer ".USER_TOK; break;
        case "batch_no_auth":         $a = "_m_batch"; break;
        case "batch_body_token":      $a = "_m_batch"; $_POST["token"] = USER_TOK; break;
        case "page_x_authorization":  $a = "object"; unset($_POST["ops"]); $_SERVER["REQUEST_METHOD"] = "GET";
                                      $GLOBALS["HEADERS"]["X-Authorization"] = USER_TOK; break;
    }
    # Маршрут ядра: признак «ответ JSON» по действию — до проверки токена
    if(function_exists("M5335\\Api_always_json_mark"))
        \M5335\Api_always_json_mark($a);
    $ok = \M5335\Validate_Token();
    $gv = $GLOBALS["GLOBAL_VARS"];
    echo "@@".json_encode(array(
        "ok" => $ok,
        "api" => \M5335\isApi(),
        "user" => isset($gv["user"]) ? $gv["user"] : null,
    ));
}

function stubs(){
    return <<<'PHP'
function getallheaders(){ return $GLOBALS["HEADERS"]; }
function t9n($s){ return preg_replace('/^\[RU\](.*?)\[EN\].*$/s', '$1', $s); }
function my_die($m){ die("MY_DIE:".$m); }
function login($z="", $u="", $message=""){ die("LOGIN:".$message); }
function Cabinet_login_ok($db){ return FALSE; }
function Basic_auth_token($v){ return FALSE; }
function xsrf($a, $b){ return substr(hash("sha512", SALT."{$GLOBALS["z"]}:$a:$b"), 0, 22); }
function Xsrf_is_legacy($x, $u){ return FALSE; }
function getGrants($r){ $GLOBALS["GRANTS_OF"] = $r; }
function setcookie($n, $v, $exp = 0, $path = ""){ $GLOBALS["COOKIES"][$n] = $v; return TRUE; }
function header($h){ if(preg_match('~^HTTP/\S+\s+(\d+)~', $h, $m)) echo "STATUS:".$m[1]."\n"; }
function Insert($up, $ord, $t, $val, $msg){ return 999; }
function Update_Val($id, $val){}
function Exec_sql($sql, $msg){
    $rows = array();
    if($msg === "Validate token" && preg_match("/tok\\.val='([^']*)'/", $sql, $m) && $m[1] === USER_TOK)
        $rows[] = array("id"=>"700", "val"=>"tester", "r"=>"801", "role"=>"Manager",
                        "xsrf"=>"x", "tok"=>"tok0", "xsrf_id"=>"xsrf0", "act_id"=>"act0");
    return new \ArrayIterator($rows);   # гостя нет
}
function mysqli_fetch_array($set){
    if(!$set->valid()) return NULL;
    $row = $set->current();
    $set->next();
    return $row;
}
PHP;
}
