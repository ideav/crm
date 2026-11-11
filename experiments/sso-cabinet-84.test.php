<?php
# Мерка к ideav/courses#84: вход в базу через кабинет my (константа SSO_DBS).
# Запуск: php experiments/sso-cabinet-84.test.php (в гейте — через sso-cabinet-84-php.test.js)
#
# Validate_Token, Sso_enter, Sso_role, Sso_back_redirect берутся из index.php как есть и исполняются
# в пространстве имён S84: заглушки Exec_sql/Insert/setcookie/header/login этого пространства находят
# раньше встроенных. База — массив строк. Каждый случай — отдельный процесс: ветки ядра завершаются die().
#   1) SSO_DBS не задан — аноним в cources идёт на обычный вход, ничего не заводится;
#   2) база не из списка — то же;
#   3) кука idb_my — заводится my<id> с ролью «Ученик» и почтой, сессия idb_cources, повтор запроса;
#   4) повторный вход — без дубля, роль не трогается;
#   5) роль admin (по имени или ADMINROLE) и незаведённая роль — отказ, обычный вход;
#   6) аноним с ?aff=<число> — кука _aff; существующая не перезаписывается; мусор в aff — без куки;
#      на вход в кабинет my с возвратом (кука sso_back);
#   7) JSON API без входа — 401, как было;
#   8) Sso_back_redirect: только база из списка, кука гасится.

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
        $res = array("login" => "CRASH", "location" => null, "cookies" => array(), "inserts" => array(), "users" => array(), "back" => null);
    $res["out"] = (string)$out;
    return $res;
}

# --- 1, 2: без списка и чужая база — поведение ядра прежнее
foreach(array("off_anon" => "SSO_DBS не задан", "other_db" => "база не из SSO_DBS", "list_has_my" => "my в SSO_DBS не действует") as $c => $title){
    $r = child($c);
    expect($r["login"] === "InvalidToken" && !$r["location"], "$title: обычный вход");
    expect(!count($r["inserts"]) && !count($r["cookies"]), "$title: ничего не заведено, кук нет");
}
$r = child("off_my");
expect($r["login"] === "InvalidToken" && !count($r["inserts"]), "SSO_DBS не задан, кука idb_my: пользователь не заводится");

# --- 3: первый вход через кабинет
$r = child("new_user");
expect($r["login"] === "reenter", "idb_my: повтор запроса уже с сессией");
expect(isset($r["users"]["my77"]), "idb_my: заведён пользователь my77");
expect($r["users"]["my77"]["role_link"] === array("t" => 500, "val" => "115"), "idb_my: роль «Ученик» ссылкой через колонку роли");
expect($r["users"]["my77"]["email"] === "a@b.ru", "idb_my: почта из кабинета");
expect(!isset($r["users"]["my77"]["pwd"]), "idb_my: пароль не заводится");
expect($r["cookies"]["idb_cources"]["v"] === "s.SESSION.".$r["users"]["my77"]["id"] && $r["cookies"]["idb_cources"]["exp"] > time(), "idb_my: кука сессии idb_cources");
expect(isset($r["cookies"]["sso_back"]) && $r["cookies"]["sso_back"]["exp"] < time(), "idb_my: кука возврата sso_back гасится");
expect(count($r["inserts"]) === 3, "idb_my: три строки — пользователь, почта, роль");

# --- 4: повторный вход
$r = child("existing_user");
expect($r["login"] === "reenter" && !count($r["inserts"]), "повторный вход: без дубля и без правки роли");
expect($r["cookies"]["idb_cources"]["v"] === "s.SESSION.900", "повторный вход: сессия прежнему пользователю");

# --- 5: отказы
foreach(array("role_admin_name" => "роль admin по имени", "role_admin_id" => "роль с id ADMINROLE", "role_missing" => "роль не заведена",
              "role_col_missing" => "нет колонки роли") as $c => $title){
    $r = child($c);
    expect($r["login"] === "InvalidToken" && !count($r["inserts"]), "$title: отказ, обычный вход");
    expect(!isset($r["cookies"]["idb_cources"]), "$title: сессии нет");
}

# --- 6: аноним
$r = child("anon_aff");
expect($r["login"] === null && $r["location"] === "/start.html?db=my&r=InvalidToken&uri=%2Fcources%2F%3Faff%3D42",
    "аноним: на вход в кабинет my с возвратом в базу");
expect($r["cookies"]["_aff"]["v"] === "42" && $r["cookies"]["_aff"]["exp"] > time() + 179 * 86400, "аноним ?aff=42: кука _aff на 180 дней");
expect($r["cookies"]["_aff"]["opts"]["path"] === "/" && $r["cookies"]["_aff"]["opts"]["samesite"] === "Lax", "аноним ?aff: путь / и SameSite=Lax");
expect($r["cookies"]["sso_back"]["v"] === "cources" && $r["cookies"]["sso_back"]["exp"] > time() + 86000, "аноним: кука sso_back на сутки");
expect(!count($r["inserts"]), "аноним: ничего не заведено");
$r = child("anon_aff_kept");
expect(!isset($r["cookies"]["_aff"]) && isset($r["cookies"]["sso_back"]), "аноним с кукой _aff: прежняя не перезаписывается");
foreach(array("abc", "-1", "0", "1e3", "12345678901") as $bad){
    $r = child("anon_badaff:$bad");
    expect(!isset($r["cookies"]["_aff"]) && $r["location"] !== null, "аноним ?aff=$bad: без куки _aff, на вход");
}
$r = child("stale_my");
expect($r["location"] !== null && strpos($r["location"], "db=my") !== false && !count($r["inserts"]), "кука idb_my неизвестной сессии: как аноним");

# --- 7: JSON API
$r = child("api_anon");
expect(strpos($r["out"], "No authorization token provided") !== false && !count($r["cookies"]), "JSON API без входа: 401, как было");

# --- 8: возврат после входа в кабинет
$r = child("back:cources");
expect($r["back"] === "/cources/" && $r["cookies"]["sso_back"]["exp"] < time(), "sso_back=cources: возврат в базу, кука гасится");
foreach(array("demo", "../x", "my") as $b){
    $r = child("back:$b");
    expect($r["back"] === "" && $r["cookies"]["sso_back"]["exp"] < time(), "sso_back=$b: не из списка — без возврата, кука гасится");
}
$r = child("back:");
expect($r["back"] === "" && !count($r["cookies"]), "без куки sso_back: без возврата");

# --- 9: гость в базе из SSO_DBS (лендинг с гостевым доступом)
$r = child("guest_my");
expect($r["login"] === "reenter" && isset($r["users"]["my77"]), "гость + idb_my: вход своим пользователем my77");
expect(isset($r["cookies"]["idb_cources"]) && $r["cookies"]["idb_cources"]["v"] === "s.SESSION.".$r["users"]["my77"]["id"], "гость + idb_my: кука сессии вместо гостевой");
$r = child("guest_nocookie_my");
expect($r["login"] === "reenter" && isset($r["users"]["my77"]), "гость заведён, без куки базы + idb_my: вход своим пользователем");
$r = child("guest_owner");
expect($r["login"] === "reenter" && $r["cookies"]["idb_cources"]["v"] === "s.SESSION.800" && !count($r["inserts"]), "гость + idb_my владельца: вход владельцем, без новых строк");
$r = child("anon_owner");
expect($r["login"] === "reenter" && $r["cookies"]["idb_cources"]["v"] === "s.SESSION.800" && !count($r["inserts"]), "без гостя, idb_my владельца: вход владельцем, не учеником");
$r = child("owner_role_refused");
expect($r["login"] === "reenter" && $r["cookies"]["idb_cources"]["v"] === "s.SESSION.800", "владелец входит владельцем и при роли admin в SSO_DBS");
$r = child("guest_stale");
expect($r["user"] === "guest" && $r["login"] === null && $r["location"] === null, "гость + протухшая idb_my: остаётся гостем, без перенаправления");
$r = child("guest_refused");
expect($r["user"] === "guest" && $r["login"] === null && $r["location"] === null && !count($r["inserts"]), "гость + idb_my, роль admin: остаётся гостем");
$r = child("guest_other_db");
expect($r["user"] === "guest" && $r["login"] === null && !count($r["inserts"]), "база не из SSO_DBS, гость + idb_my: гость, как раньше");
$r = child("guest_api");
expect($r["user"] === "guest" && $r["login"] === null && !count($r["inserts"]), "JSON API гостя с idb_my: гость, как раньше");

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
exit(0);

# ---------------------------------------------------------------- дочерний процесс

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("no function in index.php: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}

function run_case($case){
    foreach(array("USER"=>18, "PASSWORD"=>20, "DATABASE"=>271, "TOKEN"=>125, "XSRF"=>40, "EMAIL"=>41, "ROLE"=>42, "ACTIVITY"=>124,
                  "SECRET"=>130, "ADMINROLE"=>145, "COOKIES_EXPIRE"=>2592000, "ADMINHASH"=>"adminhash", "SALT"=>"salt",
                  "AUTH_COOKIE_SAMESITE"=>"Lax", "SESSION_IDLE"=>2592000, "SESSION_LIFETIME"=>31536000,
                  "SESSION_TOUCH"=>86400, "SESSION_ROTATE"=>604800, "DB_MASK"=>"/^[a-z][a-z0-9_]{0,14}$/i") as $k=>$v)
        define($k, $v);
    list($case, $arg) = array_pad(explode(":", $case, 2), 2, "");
    $z = "cources";
    $sso = array("cources" => "Ученик");
    # строки базы: id => [up, t, val]; роль «Ученик» 500, admin 145, колонка роли 115 у Пользователя (ссылка 116 на роль)
    $db = array(145 => array(1, 42, "admin"), 500 => array(1, 42, "Ученик"), 116 => array(0, 42, ""), 115 => array(18, 116, ""));
    switch($case){
        case "off_anon": $sso = null; break;
        case "off_my": $sso = null; $_COOKIE["idb_my"] = "GOOD"; break;
        case "other_db": $z = "demo"; $_COOKIE["idb_my"] = "GOOD"; break;
        case "list_has_my": $z = "my"; $sso = array("my" => "Ученик"); break;
        case "new_user": $_COOKIE["idb_my"] = "GOOD"; $_COOKIE["sso_back"] = "cources"; break;
        case "existing_user": $_COOKIE["idb_my"] = "GOOD"; $db[900] = array(1, 18, "my77"); $db[901] = array(900, 500, "115"); break;
        case "role_admin_name": $_COOKIE["idb_my"] = "GOOD"; $sso = array("cources" => "Admin"); break;
        case "role_admin_id": $_COOKIE["idb_my"] = "GOOD"; unset($db[500]); $db[145] = array(1, 42, "Ученик"); break;
        case "role_missing": $_COOKIE["idb_my"] = "GOOD"; $sso = array("cources" => "Куратор"); break;
        case "role_col_missing": $_COOKIE["idb_my"] = "GOOD"; unset($db[115]); break;
        case "anon_aff": $_GET["aff"] = "42"; $_SERVER["REQUEST_URI"] = "/cources/?aff=42"; break;
        case "anon_aff_kept": $_GET["aff"] = "42"; $_COOKIE["_aff"] = "7"; break;
        case "anon_badaff": $_GET["aff"] = $arg; break;
        case "stale_my": $_COOKIE["idb_my"] = "BAD"; break;
        case "api_anon": $_GET["JSON"] = ""; $_COOKIE["idb_my"] = "GOOD"; break;
        case "back": if($arg !== "") $_COOKIE["sso_back"] = $arg; break;
        case "guest_my": $guest = TRUE; $_COOKIE["idb_cources"] = "gtuoeksetn"; $_COOKIE["idb_my"] = "GOOD"; break;
        case "guest_nocookie_my": $guest = TRUE; $_COOKIE["idb_my"] = "GOOD"; break;
        case "guest_owner": $guest = TRUE; $_COOKIE["idb_cources"] = "gtuoeksetn"; $_COOKIE["idb_my"] = "OWNER"; break;
        case "anon_owner": $_COOKIE["idb_my"] = "OWNER"; break;
        case "owner_role_refused": $_COOKIE["idb_my"] = "OWNER"; $sso = array("cources" => "admin"); break;
        case "guest_stale": $guest = TRUE; $_COOKIE["idb_cources"] = "gtuoeksetn"; $_COOKIE["idb_my"] = "BAD"; break;
        case "guest_refused": $guest = TRUE; $_COOKIE["idb_cources"] = "gtuoeksetn"; $_COOKIE["idb_my"] = "GOOD"; $sso = array("cources" => "admin"); break;
        case "guest_other_db": $guest = TRUE; $z = "demo"; $_COOKIE["idb_demo"] = "gtuoeksetn"; $_COOKIE["idb_my"] = "GOOD"; break;
        case "guest_api": $guest = TRUE; $_GET["JSON"] = ""; $_COOKIE["idb_cources"] = "gtuoeksetn"; $_COOKIE["idb_my"] = "GOOD"; break;
    }
    if($sso !== null)
        define("SSO_DBS", $sso);
    if(!isset($_SERVER["REQUEST_URI"]))
        $_SERVER["REQUEST_URI"] = "/$z/";
    $GLOBALS["z"] = $z;
    $GLOBALS["DB"] = $db;
    $GLOBALS["INSERTS"] = array();
    $GLOBALS["COOKIES"] = array();
    $GLOBALS["DB"][800] = array(1, 18, $z);  # владелец базы
    if(!empty($guest))
        $GLOBALS["DB"][700] = array(1, 18, "guest");
    $GLOBALS["GUEST"] = !empty($guest);
    $src = file_get_contents(__DIR__."/../index.php");
    $code = "";
    foreach(array("Validate_Token", "Sso_role", "Sso_enter", "Sso_back_redirect", "Restore_id", "Token_parse", "Token_stored_val",
                  "Token_db_val", "Token_idle_sql", "Token_match_sql", "Session_refresh_action", "Session_cookie_exp",
                  "Auth_cookie_opts", "Auth_cookie", "qrLoginIsHttps", "Admin_token", "Admin_xsrf", "Guest_session") as $fn)
        $code .= extract_function_source($src, $fn)."\n";
    if(strpos($src, "function Sso_login_my(") !== false)
        $code .= extract_function_source($src, "Sso_login_my")."\n";
    eval("namespace S84;\n".stubs()."\n".$code);
    register_shutdown_function("dump_state");
    if($case === "back")
        $GLOBALS["BACK"] = \S84\Sso_back_redirect();
    else
        \S84\Validate_Token();
}

function dump_state(){
    $users = array();
    foreach($GLOBALS["DB"] as $id => $r)
        if($r[1] === 18){
            $u = array("id" => $id);
            foreach($GLOBALS["DB"] as $cid => $c)
                if($c[0] === $id){
                    if($c[1] === 41) $u["email"] = $c[2];
                    elseif($c[1] === 20) $u["pwd"] = $c[2];
                    elseif(isset($GLOBALS["DB"][$c[1]]) && $GLOBALS["DB"][$c[1]][1] === 42) $u["role_link"] = array("t" => $c[1], "val" => $c[2]);
                }
            $users[$r[2]] = $u;
        }
    echo "@@".json_encode(array(
        "login" => isset($GLOBALS["LOGIN"]) ? $GLOBALS["LOGIN"] : null,
        "location" => isset($GLOBALS["LOCATION"]) ? $GLOBALS["LOCATION"] : null,
        "cookies" => (object)$GLOBALS["COOKIES"],
        "inserts" => $GLOBALS["INSERTS"],
        "users" => (object)$users,
        "user" => isset($GLOBALS["GLOBAL_VARS"]["user"]) ? $GLOBALS["GLOBAL_VARS"]["user"] : null,
        "back" => isset($GLOBALS["BACK"]) ? $GLOBALS["BACK"] : null,
    ), JSON_UNESCAPED_UNICODE);
}

function stubs(){
    return <<<'PHP'
function isApi(){ return isset($_GET["JSON"]); }
function getallheaders(){ return array(); }
function t9n($s){ return preg_replace('/^\[RU\](.*?)\[EN\].*$/s', '$1', $s); }
function my_die($m){ die("MY_DIE:".$m); }
function login($z = "", $u = "", $message = ""){ $GLOBALS["LOGIN"] = $message; die(); }
function Cabinet_login_ok($db){ return FALSE; }
function Basic_auth_token($v){ return FALSE; }
function xsrf($a, $b){ return "x"; }
function Xsrf_is_legacy($x, $u){ return FALSE; }
function getGrants($r){}
function Update_Val($id, $val){ $GLOBALS["INSERTS"][] = array("update", $id, (string)$val); }
function Session_new($uid){ return "s.SESSION.$uid"; }
function setcookie($n, $v, $opts = 0){
    $GLOBALS["COOKIES"][$n] = array("v" => (string)$v, "exp" => is_array($opts) ? $opts["expires"] : $opts, "opts" => $opts);
    return TRUE;
}
function header($h){ if(stripos($h, "Location:") === 0) $GLOBALS["LOCATION"] = trim(substr($h, 9)); }
function Insert($up, $ord, $t, $val, $msg){
    $id = 1000 + count($GLOBALS["INSERTS"]);
    $GLOBALS["DB"][$id] = array((int)$up, (int)$t, (string)$val);
    $GLOBALS["INSERTS"][] = array($up, $t, (string)$val);
    return $id;
}
function Exec_sql($sql, $msg){
    $rows = array();
    $one = function($id) use (&$rows){ $rows[] = array(0 => $id, "id" => $id); };
    preg_match("/val='([^']*)'/", $sql, $m);
    $guestOn = $GLOBALS["GUEST"];
    if($msg === "SSO: cabinet user" && $_COOKIE["idb_my"] === "GOOD" && strpos($sql, " my ") !== false)
        $rows[] = array(0 => 77, "id" => 77, "email" => "a@b.ru", "own" => null);
    elseif($msg === "SSO: cabinet user" && $_COOKIE["idb_my"] === "OWNER" && strpos($sql, "db.val='{$GLOBALS["z"]}'") !== false)
        $rows[] = array(0 => 66, "id" => 66, "email" => "o@b.ru", "own" => 5);
    elseif($msg === "Validate token" && $guestOn && isset($_COOKIE["idb_".$GLOBALS["z"]]) && $_COOKIE["idb_".$GLOBALS["z"]] === "gtuoeksetn")
        $rows[] = array("id" => 700, "val" => "guest", "r" => 300, "role" => "guest", "xsrf" => "x", "tok" => 701, "tok_ord" => 1, "xsrf_id" => 702, "act_id" => 703);
    elseif($msg === "Get Guest credentials" && $guestOn)
        $rows[] = array("u" => 700, "tok" => "gtuoeksetn", "token" => 701, "xsrf" => 702, "xsrf_val" => "x", "r" => 300, "role" => "guest");
    elseif($msg === "SSO: find the user"){
        foreach($GLOBALS["DB"] as $id => $r) if($r[1] === 18 && $r[2] === $m[1]) $one($id);
    }
    elseif($msg === "SSO: find the role"){
        foreach($GLOBALS["DB"] as $id => $r) if($r[1] === 42 && $r[0] !== 0 && mb_strtolower($r[2]) === mb_strtolower($m[1])) $one($id);
    }
    elseif($msg === "SSO: find the role column"){
        foreach($GLOBALS["DB"] as $id => $r)
            if($r[0] === 18 && isset($GLOBALS["DB"][$r[1]]) && $GLOBALS["DB"][$r[1]][0] === 0 && $GLOBALS["DB"][$r[1]][1] === 42) $one($id);
    }
    return new \ArrayIterator(array_slice($rows, 0, 1));
}
function mysqli_fetch_array($set){
    if(!$set->valid()) return NULL;
    $row = $set->current();
    $set->next();
    return $row;
}
PHP;
}
