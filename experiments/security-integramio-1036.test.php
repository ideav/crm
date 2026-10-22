<?php
# Мерка к правкам авторизации ядра integram.io (integram.io/index.php), issue #1036.
#
# Запуск: php experiments/security-integramio-1036.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра (так тест виден красным на прежней версии).
#
# Функции берутся из ядра как есть; MySQL подменён: Exec_sql отвечает по метке запроса.
#   A) подтверждение регистрации: код из ссылки обязан совпасть, после подтверждения токен — новый случайный;
#      код регистрации случайный; прежний md5-код регистрации токеном не остаётся;
#   B) вход по коду (checkcode): точное сравнение, «%%%%»/«____» не входят, лимит неудач;
#   C) Basic/Bearer/X-Authorization: значения остаются строковыми литералами SQL, логин не в ошибке;
#   D) check(): xsrf сравнивается строго, пустой xsrf не проходит;
#   E) у DDL-команд `_d_*` нет синонимов без префикса;
#   F) dir_admin: add_path, имена удаляемых/загружаемых файлов, чёрный список расширений;
#   G) ?login= кабинета: имя таблицы только по маске имени базы;
#   H) _connect: только http(s) на публичный хост, учётные данные Интеграма не уходят в адрес;
#   I) журнал: пароли, токены, коды, xsrf и заголовки входа маскируются.

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

$indexPhp = getenv("INDEX_PHP") ?: __DIR__."/../integram.io/index.php";
$source = file_get_contents($indexPhp);

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "EMAIL"=>41, "ACTIVITY"=>124, "TOKEN"=>125, "SECRET"=>130, "DATABASE"=>271) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
define("ADMINHASH", "adminhash");
define("MAIL_MASK", "/.+@.+\..+/i");
define("DB_MASK", "/^[a-z0-9_]\w{1,14}$/i");
$logsDir = sys_get_temp_dir()."/sec1036_".bin2hex(random_bytes(4))."/";
mkdir($logsDir);
define("LOGS_DIR", $logsDir);
# Лимиты входа по коду — как заданы в ядре
foreach(array("CHECKCODE_RETRIES_LIMIT" => 3, "CHECKCODE_LOCK_TTL" => 3600) as $k => $v)
    define($k, preg_match('/define\("'.$k.'",\s*(\d+)\)/', $source, $m) ? (int)$m[1] : $v);
$z = "abc";
class Died extends Exception {}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function my_die($msg, $code=""){ throw new Died($msg); }
function trace($t){}

# ── Exec_sql по меткам: запрос сохраняется, ответ — строки из $GLOBALS["ANSWER"][метка]($sql) ──
function Exec_sql($sql, $label, $log=TRUE, $fatal=TRUE){
    $GLOBALS["SQL"][$label] = $sql;
    $fn = isset($GLOBALS["ANSWER"][$label]) ? $GLOBALS["ANSWER"][$label] : null;
    $r = new stdClass; $r->rows = $fn ? $fn($sql) : array();
    return $r;
}
function fk_fetch_array($res){ return ($res && count($res->rows)) ? array_shift($res->rows) : NULL; }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["LOG"][] = array("ins", $t, (string)$val); return 999; }
function Update_Val($id, $val, $no_tail=FALSE){ $GLOBALS["LOG"][] = array("upd", $id, (string)$val); }
function test_setcookie($n, $v, $e=0, $p=""){ $GLOBALS["LOG"][] = array("cookie", $n, (string)$v); return true; }
# Строковый литерал SQL сразу после $prefix: [значение, остаток запроса после закрывающей кавычки]
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
    if(!preg_match('/\nfunction '.preg_quote($name, '/').'\s*\(/', $source, $m, PREG_OFFSET_CAPTURE))
        throw new Exception("not found: ".$name);
    $start = $m[0][1] + 1;
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}
$missing = array();
foreach(array("Salt", "secureToken", "xsrf", "check", "updateTokens", "BlackList",
              "Reg_confirm_code", "Reg_confirm_row", "Token_is_reg_code", "User_names_for_reg_code", "Reg_code_tokens",
              "Basic_auth_token", "Header_auth_token", "Checkcode_retries", "Checkcode_login",
              "Dir_admin_add_path", "Dir_admin_entry_name", "Cabinet_login_db",
              "fetchUrlHostIsPublic", "Report_url_allowed", "Connect_url",
              "Log_sensitive_key", "Log_mask_value", "Log_params", "Log_uri", "Log_header_value") as $fn){
    try {
        eval(str_replace(array("mysqli_fetch_array(", "setcookie("), array("fk_fetch_array(", "test_setcookie("),
            extract_function_source($source, $fn)));
    } catch(Exception $e){
        $missing[] = $fn;
    }
}
expect(!$missing, "в ядре integram.io есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
function log_has($kind, $val){
    foreach($GLOBALS["LOG"] as $l) if(($l[0] === $kind) && ($l[2] === $val)) return TRUE;
    return FALSE;
}

# ── A) подтверждение регистрации ───────────────────────────────────────────────────────────
$code = "c0de".str_repeat("7", 60);
$liveTok = "live".str_repeat("e", 60);
# База: у пользователя 5 в токене — код из ссылки, у пользователя 6 — рабочий токен сессии
$GLOBALS["ANSWER"]["Check user & conf code"] = function($sql) use ($code, $liveTok){
    $users = array(5 => $code, 6 => $liveTok);
    if(!preg_match('/user\.id=(\d+)/', $sql, $m) || !isset($users[(int)$m[1]])) return array();
    $row = array("user" => "ivan@x.ru", "uid" => (int)$m[1], "tok" => 70 + (int)$m[1], "token" => $users[(int)$m[1]],
                 "xsrf" => 0, "act" => 0, "pwd" => "secret1", "pid" => 80, "email" => "ivan@x.ru");
    list($lit) = sql_literal_after($sql, "token.val='");
    if(($lit === null) && (strpos($sql, "token.val") === false)) return array($row);  # код в запросе не проверяется
    return ($lit === $row["token"]) ? array($row) : array();
};
if(function_exists("Reg_confirm_row")){
    expect(Reg_confirm_row(6, "x") === FALSE, "A: ?u=6&c=x — пользователь не найден (код не совпал)");
    expect(Reg_confirm_row(6, "wrongcode") === FALSE, "A: неверный код подтверждения — отказ");
    expect(Reg_confirm_row(5, "' OR '1'='1") === FALSE, "A: подстановка SQL в коде — отказ");
    expect(Reg_confirm_row(5, array("x")) === FALSE, "A: массив вместо кода — отказ");
    $row = Reg_confirm_row(5, $code);
    expect(is_array($row) && ($row["uid"] === 5), "A: верный код — пользователь найден");
}
if(function_exists("updateTokens")){
    $GLOBALS["LOG"] = array(); $GLOBALS["GLOBAL_VARS"] = array();
    $row = array("uid" => 5, "user" => "ivan@x.ru", "tok" => 75, "token" => $code, "xsrf" => 0, "act" => 0);
    updateTokens($row, array($code));
    $t = isset($GLOBALS["GLOBAL_VARS"]["token"]) ? $GLOBALS["GLOBAL_VARS"]["token"] : "";
    expect(($t !== $code) && (strlen($t) === 64), "A: после подтверждения токен — новый случайный, не код из ссылки");
    expect(log_has("cookie", $t) && !log_has("cookie", $code), "A: кука выдана с новым токеном");
    $legacy = md5("xzivan@x.ru");
    $GLOBALS["LOG"] = array(); $GLOBALS["GLOBAL_VARS"] = array();
    $GLOBALS["ANSWER"]["Get user emails"] = function($sql){ return array(array("val" => "ivan@x.ru")); };
    $repl = function_exists("Reg_code_tokens") ? Reg_code_tokens(9, "abc") : array();
    updateTokens(array("uid" => 9, "val" => "abc", "tok" => 79, "token" => $legacy, "xsrf" => 0, "act" => 0), $repl);
    expect($GLOBALS["GLOBAL_VARS"]["token"] !== $legacy, "A: прежний md5-код регистрации в токене при входе заменяется");
    $GLOBALS["GLOBAL_VARS"] = array();
    updateTokens(array("uid" => 9, "val" => "abc", "tok" => 79, "token" => $liveTok, "xsrf" => 0, "act" => 0), $repl);
    expect($GLOBALS["GLOBAL_VARS"]["token"] === $liveTok, "A: обычный токен при входе сохраняется");
}
if(function_exists("Reg_confirm_code")){
    $c1 = Reg_confirm_code(); $c2 = Reg_confirm_code();
    expect($c1 !== $c2, "A: коды подтверждения разные при каждом вызове");
    expect(preg_match('/^[a-z0-9]{6,128}$/', $c1) === 1, "A: код проходит проверку формата ссылки подтверждения");
    expect($c1 !== md5("xzivan@x.ru"), "A: код не вычисляется из адреса почты");
}
if(function_exists("Token_is_reg_code")){
    expect(Token_is_reg_code(md5("xzivan@x.ru"), array("abc", "ivan@x.ru")), "A: md5-код регистрации распознаётся по почте");
    expect(!Token_is_reg_code(bin2hex(random_bytes(32)), array("ivan@x.ru")), "A: случайный токен кодом регистрации не считается");
    expect(!Token_is_reg_code(md5("xz"), array("", null)), "A: пустое имя кода не даёт");
}

# ── B) вход по коду ────────────────────────────────────────────────────────────────────────
function checkcode_as($tokenVal, $c, $uid = 11){
    $GLOBALS["LOG"] = array();
    $GLOBALS["ANSWER"]["Check the user token"] = function($sql) use ($tokenVal, $uid){
        return array(array("id" => $uid, "tok" => 100 + $uid, "token" => $tokenVal, "xsrf" => 0, "act" => 0));
    };
    $GLOBALS["ANSWER"]["Get user emails"] = function($sql){ return array(array("val" => "ivan@x.ru")); };
    return Checkcode_login("ivan@x.ru", $c);
}
if(function_exists("Checkcode_login") && function_exists("Checkcode_retries")){
    $tok = "ab12".str_repeat("f", 60);
    foreach(array("%%%%", "____", "ab1%", "a_1_", "AB%%") as $wild){
        $r = checkcode_as($tok, $wild, 11);
        expect(!isset($r["token"]), "B: код ".json_encode($wild)." не входит (подстановочные символы — не код)");
    }
    Checkcode_retries(11, -1);
    $r = checkcode_as($tok, "AB12", 11);
    expect(isset($r["token"]) && ($r["token"] !== $tok) && log_has("upd", $r["token"]), "B: верный код — вход, токен заменён");
    $r = checkcode_as($tok, "zz99", 12);
    expect(isset($r["error"]) && !isset($r["token"]), "B: неверный код — отказ");
    for($i = 1; $i < CHECKCODE_RETRIES_LIMIT; $i++) checkcode_as($tok, "zz99", 12);
    $r = checkcode_as($tok, "ab12", 12);
    expect(!isset($r["token"]), "B: после ".CHECKCODE_RETRIES_LIMIT." неудач даже верный код не входит (перебор 65536 кодов закрыт)");
    $r = checkcode_as(md5("xzivan@x.ru"), substr(md5("xzivan@x.ru"), 0, 4), 13);
    expect(!isset($r["token"]), "B: код из прежнего md5-кода регистрации (вычислим по почте) не входит");
    $r = Checkcode_login("ivan@x.ru", "ab1'");
    expect(isset($r["error"]) && !isset($r["token"]), "B: код не из [a-z0-9]{4} — отказ без запроса");
}

# ── C) Basic / Bearer / X-Authorization ────────────────────────────────────────────────────
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
    $GLOBALS["ANSWER"]["Basic authentication"] = function($sql){ return array(array("tok" => "T0K", "tok_id" => 3, "id" => 7)); };
    expect(Basic_auth_token(base64_encode("alice:secret")) === "T0K", "C: верная пара — токен пользователя");
    $pwdHash = sha1(Salt("alice", "secret"));
    $GLOBALS["ANSWER"]["Basic authentication"] = function($sql) use ($pwdHash){ return array(array("tok" => $pwdHash, "tok_id" => 3, "id" => 7)); };
    $GLOBALS["LOG"] = array();
    $t = Basic_auth_token("alice:secret");
    expect(($t !== $pwdHash) && log_has("upd", $t), "C: токен, равный хешу пароля, заменяется случайным");
}
if(function_exists("Header_auth_token")){
    foreach(array("x' OR '1'='1", "abc\\", "t' UNION SELECT 1 -- ") as $evil){
        foreach(array(array("Authorization", "Bearer $evil"), array("X-Authorization", $evil), array("Authorization", $evil)) as $h){
            $t = Header_auth_token($h[0], $h[1]);
            list($lit, $rest) = sql_literal_after("tok.val='$t' AND tok.t=125", "tok.val='");
            expect(is_string($t) && ($rest === " AND tok.t=125"), "C: ".$h[0]." ".json_encode($h[1])." остаётся внутри литерала tok.val");
        }
    }
    expect(Header_auth_token("Accept", "text/html") === NULL, "C: прочие заголовки не дают токена");
    $GLOBALS["ANSWER"]["Basic authentication"] = null;
    expect(Header_auth_token("Authorization", "Basic ".base64_encode("bob:bad")) === FALSE, "C: неверная пара Basic — FALSE (ответ 401 без логина)");
}

# ── D) check() ─────────────────────────────────────────────────────────────────────────────
function check_passes($stored, $posted){
    $GLOBALS["GLOBAL_VARS"]["xsrf"] = $stored;
    $_POST = array();
    if($posted !== null) $_POST["_xsrf"] = $posted;
    try { return check() === true; } catch(Died $e){ return false; }
}
if(function_exists("check")){
    expect(check_passes("a1b2c3d4e5f6a7b8c9d0e1", "a1b2c3d4e5f6a7b8c9d0e1"), "D: верный xsrf проходит");
    expect(!check_passes("a1b2c3d4e5f6a7b8c9d0e1", "a1b2c3d4e5f6a7b8c9d0e2"), "D: чужой xsrf не проходит");
    expect(!check_passes("0e1234567890123456789", "0e9999999999999999999"), "D: «0e…»-строки не равны друг другу");
    expect(!check_passes("", ""), "D: пустой xsrf не проходит");
    expect(!check_passes(null, ""), "D: xsrf, которого нет, не совпадает с пустым");
}

# ── E) синонимы DDL-команд ─────────────────────────────────────────────────────────────────
# Диспетчер проверяет права на структуру и xsrf по префиксу `_d_`. Метка case в одной связке
# с `_d_*` исполняет тот же код без проверки — таких меток быть не должно.
$group = array(); $bad = array();
foreach(preg_split('/\r?\n/', $source) as $line){
    if(preg_match('/^\s*case\s+"([^"]+)"\s*:/', $line, $m)){ $group[] = $m[1]; continue; }
    if($group){
        $ddl = array_filter($group, function($a){ return strpos($a, "_d_") === 0; });
        if($ddl)
            foreach($group as $a)
                if(strpos($a, "_d_") !== 0) $bad[] = "$a (= ".implode("/", $ddl).")";
    }
    $group = array();
}
expect(!$bad, "E: у команд _d_* нет синонимов без префикса".($bad ? " — найдены: ".implode(", ", $bad) : ""));

# ── F) dir_admin ───────────────────────────────────────────────────────────────────────────
if(function_exists("Dir_admin_add_path")){
    $cases = array("" => "", "d" => "/d", "/d" => "/d", "/d/" => "/d", "d/e" => "/d/e", "\\d" => "/d", "/" => "",
                   ".." => "", "../x" => "", "/a/../../x" => "", "d\0" => "");
    foreach($cases as $in => $want)
        expect(Dir_admin_add_path($in) === $want, "F: add_path ".json_encode($in)." → ".json_encode($want));
}
if(function_exists("Dir_admin_entry_name")){
    foreach(array("a.txt" => TRUE, "dir_1" => TRUE, "" => FALSE, ".." => FALSE, "../x" => FALSE, "a/b" => FALSE,
                  "a\\b" => FALSE, "x..y" => FALSE, "a\0" => FALSE) as $in => $want)
        expect(Dir_admin_entry_name($in) === $want, "F: имя ".json_encode($in).($want ? " допустимо" : " отклонено"));
    expect(Dir_admin_entry_name(array("a")) === FALSE, "F: массив вместо имени отклонён");
}
function blacklisted($ext){ try { BlackList($ext); return false; } catch(Died $e){ return true; } }
if(function_exists("BlackList")){
    foreach(array("php", "PHP", "phtml", "pht", "phar", "php7", "php8", "phps", "htaccess", "htpasswd", "sh", "cgi") as $ext)
        expect(blacklisted($ext), "F: расширение .$ext запрещено к загрузке");
    foreach(array("html", "js", "css", "png", "txt") as $ext)
        expect(!blacklisted($ext), "F: расширение .$ext разрешено");
}

# ── G) ?login= кабинета ────────────────────────────────────────────────────────────────────
if(function_exists("Cabinet_login_db")){
    expect(Cabinet_login_db("abc") === "abc", "G: имя базы проходит");
    foreach(array("abc tok, my u WHERE 1=1 -- ", "my;DROP", "a", "../x", "abc'", "") as $evil)
        expect(Cabinet_login_db($evil) === "", "G: ".json_encode($evil)." именем таблицы не становится");
    expect(Cabinet_login_db(array("abc")) === "", "G: массив отклонён");
}

# ── H) _connect ────────────────────────────────────────────────────────────────────────────
if(function_exists("Report_url_allowed")){
    foreach(array("http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.1.2.3/x", "http://192.168.0.1/",
                  "http://[::1]/", "http://0.0.0.0/", "file:///etc/passwd", "gopher://8.8.8.8/", "dict://8.8.8.8/", "") as $u)
        expect(!Report_url_allowed($u), "H: коннектор на ".json_encode($u)." запрещён");
    expect(Report_url_allowed("https://8.8.8.8/api?x=1"), "H: публичный http(s)-адрес разрешён");
}
if(function_exists("Connect_url")){
    $u = Connect_url("https://8.8.8.8/api", array("a" => "1", "token" => "TT", "_xsrf" => "XX", "JWT" => "JJ", "b" => "2"));
    expect((strpos($u, "TT") === false) && (strpos($u, "XX") === false) && (strpos($u, "JJ") === false)
        && (strpos($u, "a=1") !== false) && (strpos($u, "b=2") !== false), "H: токен/xsrf/jwt не уходят в адрес коннектора ($u)");
}

# ── I) журнал ──────────────────────────────────────────────────────────────────────────────
if(function_exists("Log_params")){
    $secrets = array("pwd", "regpwd", "regpwd1", "npw1", "npw2", "token", "secret", "jwt", "c", "p", "o", "_xsrf", "t20", "PWD");
    $post = array("name" => "VISIBLE1");
    foreach($secrets as $i => $k) $post[$k] = "S3CR3T$i";
    $post["arr"] = array("token" => "S3CR3Tarr", "x" => "VISIBLE2");
    $line = Log_params($post);
    expect(strpos($line, "S3CR3T") === false, "I: пароли, токены, коды и xsrf не попадают в журнал");
    expect((strpos($line, "VISIBLE1") !== false) && (strpos($line, "VISIBLE2") !== false), "I: прочие параметры журналируются");
}
if(function_exists("Log_uri")){
    $l = Log_uri("/my/register?u=5&c=S3CR3T&token=S3CR3T2&x=1");
    expect((strpos($l, "S3CR3T") === false) && (strpos($l, "u=5") !== false) && (strpos($l, "x=1") !== false), "I: секретные параметры адреса скрыты ($l)");
    expect(Log_uri("/abc/object/18") === "/abc/object/18", "I: адрес без параметров не меняется");
}
if(function_exists("Log_header_value")){
    foreach(array("Authorization", "authorization", "X-Authorization", "Cookie") as $h)
        expect(Log_header_value($h, "S3CR3T") !== "S3CR3T", "I: заголовок $h маскируется");
    expect(Log_header_value("Accept", "text/html") === "text/html", "I: прочие заголовки журналируются");
}

@array_map("unlink", glob($logsDir."*")); @rmdir($logsDir);
ob_end_flush();
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
