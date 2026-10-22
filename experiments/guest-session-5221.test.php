<?php
# Мерка к issue #5221: гость (пользователь guest) видит приложение без входа.
# https://github.com/ideav/crm/issues/5221
#
# Запуск: php experiments/guest-session-5221.test.php (в гейте — через одноимённый .test.js)
#
# Validate_Token из index.php берётся как есть и исполняется в пространстве имён G5221:
# неквалифицированные вызовы (Exec_sql, mysqli_fetch_array, setcookie, header, Insert…)
# находят заглушки этого пространства раньше встроенных функций. База — массив строк.
# Каждый случай — отдельный процесс: ветки ядра завершаются die().
#   1) JSON API без токена, гость заведён — запрос обслуживается гостем, а не 401;
#   2) страница без токена — гость входит в этом же запросе: без перенаправления, кука гостя
#      ставится, запись токена гостя не затирается;
#   3) у гостя чужое значение токена — оно восстанавливается, сайт не падает с «Неверный токен»;
#   4) повторный визит с кукой гостя — обычная проверка токена, роль гостя;
#   5) гостя нет: JSON API без токена — 401 «No authorization token provided», страница — вход;
#   6) гостю не задана роль — посетителя отправляют на вход, а не «не задана роль»;
#   7) (#5231) у пользователя guest роль не guest — гостевого входа нет: страница — вход,
#      JSON API — 401, кука гостя с прошлого визита не впускает.

const GUEST_TOK = "gtuoeksetn";

if(isset($argv[1]) && $argv[1] !== ""){
    run_case($argv[1]);
    exit(0);
}

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function child($case){
    $out = shell_exec(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." ".escapeshellarg($case)." 2>&1");
    $p = strrpos((string)$out, "@@");
    $res = $p === false ? null : json_decode(substr($out, $p + 2), true);
    if(!is_array($res))
        $res = array("raw" => $out);
    $res["out"] = (string)$out;
    return $res;
}

$r = child("api_no_token");
expect(!empty($r["ok"]) && $r["user"] === "guest", "JSON API без токена: обслуживается гостем");
expect(!empty($r["ok"]) && $r["role"] === "guest" && $r["role_id"] === "300", "JSON API без токена: роль гостя из базы");
expect(!empty($r["ok"]) && $r["grants_of"] === "300", "JSON API без токена: права роли гостя загружены");
expect(!empty($r["ok"]) && $r["token"] === GUEST_TOK, "JSON API без токена: токен сессии — гостевой");

$r = child("page_no_token");
expect(!empty($r["ok"]) && $r["user"] === "guest", "страница без токена: гость входит в этом же запросе");
expect(!empty($r["ok"]) && empty($r["location"]), "страница без токена: без перенаправления (кука могла не сохраниться)");
expect(!empty($r["ok"]) && $r["cookie"] === GUEST_TOK, "страница без токена: кука гостя поставлена");
expect(!empty($r["ok"]) && $r["db_token"] === GUEST_TOK, "страница без токена: запись токена гостя не затёрта");
expect(!empty($r["ok"]) && $r["xsrf"] !== "" && $r["xsrf"] === $r["db_xsrf"], "страница без токена: xsrf сессии совпадает с записанным");

$r = child("foreign_token");
expect(!empty($r["ok"]) && $r["user"] === "guest", "чужое значение токена гостя: сайт открывается гостю");
expect(!empty($r["ok"]) && $r["db_token"] === GUEST_TOK, "чужое значение токена гостя: восстановлено");

$r = child("cookie_revisit");
expect(!empty($r["ok"]) && $r["user"] === "guest" && $r["role"] === "guest", "повторный визит с кукой гостя: гость с ролью");

$r = child("no_guest_api");
expect(empty($r["ok"]) && strpos($r["out"], "No authorization token provided") !== false, "гостя нет, JSON API без токена: 401 с прежним текстом");
$r = child("no_guest_page");
expect(empty($r["ok"]) && strpos($r["out"], "LOGIN:InvalidToken") !== false, "гостя нет, страница: на вход");

$r = child("guest_no_role");
expect(empty($r["ok"]) && strpos($r["out"], "LOGIN:InvalidToken") !== false, "гость без роли: на вход");
expect(strpos($r["out"], "не задана роль") === false, "гость без роли: не падает «не задана роль»");

# #5231: гость работает, только когда заведены и пользователь guest, и роль guest
$r = child("guest_other_role_page");
expect(empty($r["ok"]) && strpos($r["out"], "LOGIN:InvalidToken") !== false, "#5231 guest с ролью не guest, страница: на вход");
$r = child("guest_other_role_api");
expect(empty($r["ok"]) && strpos($r["out"], "No authorization token provided") !== false, "#5231 guest с ролью не guest, JSON API: 401");
$r = child("guest_other_role_cookie");
expect(empty($r["ok"]) && strpos($r["out"], "LOGIN:InvalidToken") !== false, "#5231 guest с ролью не guest, кука гостя: на вход");
$r = child("guest_no_role_cookie");
expect(empty($r["ok"]) && strpos($r["out"], "LOGIN:InvalidToken") !== false, "#5231 guest без роли, кука гостя: на вход");

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
    # python2node#1043: Validate_Token зовёт разбор токена сессии и флаги куки — берутся из ядра как есть
    foreach(array("Validate_Token", "Guest_session", "Token_parse", "Token_stored_val", "Token_db_val", "Token_idle_sql",
                  "Session_refresh_action", "Session_cookie_exp", "Auth_cookie_opts", "Auth_cookie", "qrLoginIsHttps") as $fn)
        $code .= extract_function_source($src, $fn)."\n";
    eval("namespace G5221;\n".stubs()."\n".$code);

    $GLOBALS["z"] = "demo";
    $GLOBALS["DB"] = array(
        "guest" => array("id"=>"500", "role"=>"300", "role_name"=>"Guest", "tokens"=>array(), "xsrf"=>null),
        "api" => FALSE,
    );
    $g =& $GLOBALS["DB"]["guest"];
    switch($case){
        case "api_no_token":  $GLOBALS["DB"]["api"] = TRUE; $_GET["JSON"] = ""; $g["tokens"] = array(GUEST_TOK); break;
        case "page_no_token": $g["tokens"] = array(GUEST_TOK); break;
        case "foreign_token": $g["tokens"] = array("someoldtoken"); break;
        case "cookie_revisit": $g["tokens"] = array(GUEST_TOK); $_COOKIE["idb_demo"] = GUEST_TOK; break;
        case "no_guest_api":  $GLOBALS["DB"]["guest"] = null; $GLOBALS["DB"]["api"] = TRUE; $_GET["JSON"] = ""; break;
        case "no_guest_page": $GLOBALS["DB"]["guest"] = null; break;
        case "guest_no_role": $g["role"] = null; break;
        case "guest_other_role_page": $g["role_name"] = "Reader"; $g["tokens"] = array(GUEST_TOK); break;
        case "guest_other_role_api": $g["role_name"] = "Reader"; $GLOBALS["DB"]["api"] = TRUE; $_GET["JSON"] = ""; break;
        case "guest_other_role_cookie": $g["role_name"] = "Reader"; $g["tokens"] = array(GUEST_TOK); $_COOKIE["idb_demo"] = GUEST_TOK; break;
        case "guest_no_role_cookie": $g["role"] = null; $g["tokens"] = array(GUEST_TOK); $_COOKIE["idb_demo"] = GUEST_TOK; break;
    }
    unset($g);
    $ok = \G5221\Validate_Token();
    $gv = $GLOBALS["GLOBAL_VARS"];
    $guest = $GLOBALS["DB"]["guest"];
    echo "@@".json_encode(array(
        "ok" => $ok,
        "user" => isset($gv["user"]) ? $gv["user"] : null,
        "role" => isset($gv["role"]) ? $gv["role"] : null,
        "role_id" => isset($gv["role_id"]) ? (string)$gv["role_id"] : null,
        "token" => isset($gv["token"]) ? $gv["token"] : null,
        "xsrf" => isset($gv["xsrf"]) ? $gv["xsrf"] : null,
        "grants_of" => isset($GLOBALS["GRANTS_OF"]) ? (string)$GLOBALS["GRANTS_OF"] : null,
        "cookie" => isset($GLOBALS["COOKIES"]["idb_demo"]) ? $GLOBALS["COOKIES"]["idb_demo"] : null,
        "location" => isset($GLOBALS["LOCATION"]) ? $GLOBALS["LOCATION"] : null,
        "db_token" => $guest && count($guest["tokens"]) ? $guest["tokens"][0] : null,
        "db_xsrf" => $guest ? $guest["xsrf"] : null,
    ));
}

function stubs(){
    return <<<'PHP'
function isApi(){ return $GLOBALS["DB"]["api"]; }
function getallheaders(){ return array(); }
function t9n($s){ return preg_replace('/^\[RU\](.*?)\[EN\].*$/s', '$1', $s); }
function my_die($m){ die("MY_DIE:".$m); }
function login($z="", $u="", $message=""){ die("LOGIN:".$message); }
function Cabinet_login_ok($db){ return FALSE; }
function Basic_auth_token($v){ return FALSE; }
function xsrf($a, $b){ return substr(hash("sha512", SALT."{$GLOBALS["z"]}:$a:$b"), 0, 22); }
function Xsrf_is_legacy($x, $u){ return FALSE; }
function getGrants($r){ $GLOBALS["GRANTS_OF"] = $r; }
function setcookie($n, $v, $exp = 0, $path = ""){ $GLOBALS["COOKIES"][$n] = $v; return TRUE; }
function header($h){ if(stripos($h, "Location:") === 0) $GLOBALS["LOCATION"] = trim(substr($h, 9)); }
function Insert($up, $ord, $t, $val, $msg){
    $g =& $GLOBALS["DB"]["guest"];
    if((string)$up === $g["id"] && $t == TOKEN) $g["tokens"][] = $val;
    if((string)$up === $g["id"] && $t == XSRF) $g["xsrf"] = $val;
    return 999;
}
function Update_Val($id, $val){
    $g =& $GLOBALS["DB"]["guest"];
    if($id === "tok0") $g["tokens"][0] = (string)$val;
    if($id === "xsrf0") $g["xsrf"] = (string)$val;
}
function Exec_sql($sql, $msg){
    $rows = array();
    $g = $GLOBALS["DB"]["guest"];
    if($msg === "Validate token" && $g && preg_match("/tok\\.val='([^']*)'/", $sql, $m) && in_array($m[1], $g["tokens"], TRUE))
        $rows[] = array("id"=>$g["id"], "val"=>"guest", "r"=>$g["role"], "role"=>$g["role_name"],
                        "xsrf"=>$g["xsrf"], "tok"=>"tok0", "xsrf_id"=>$g["xsrf"] === null ? null : "xsrf0", "act_id"=>"act0");
    elseif($msg === "Get Guest credentials" && $g){
        $toks = count($g["tokens"]) ? $g["tokens"] : array(null);
        foreach($toks as $i => $t)
            $rows[] = array("u"=>$g["id"], "tok"=>$t, "token"=>$t === null ? null : "tok$i",
                            "xsrf"=>$g["xsrf"] === null ? null : "xsrf0", "xsrf_val"=>$g["xsrf"],
                            "r"=>$g["role"], "role"=>$g["role"] ? $g["role_name"] : null);
    }
    return new \ArrayIterator($rows);
}
function mysqli_fetch_array($set){
    if(!$set->valid()) return NULL;
    $row = $set->current();
    $set->next();
    return $row;
}
PHP;
}
