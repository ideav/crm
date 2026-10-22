<?php
# Мерка к переносу правок авторизации python2node#1043 в ядро integram.io (integram.io/index.php; до crm#5228 — experiments/index_integram.io.php).
#
# Запуск: php experiments/security-integramio-1043.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра (так тест виден красным на прежней версии).
#
# Функции берутся из ядра как есть; MySQL подменён: Exec_sql отвечает по метке запроса.
#   A) пароль — password_hash; прежний sha1(Salt(<логин>, <пароль>)) принимается и требует перехеша;
#   B) ссылка сброса пароля подписана: p не подменить, после смены пароля ссылка мертва;
#   C) сессия на устройство: в базе — хеш; истёкший и MCP-токен как вход не принимаются;
#   D) чистка сессий: истёкшие, простаивающие и сверх лимита; ключ API не трогается;
#   E) блокировка подбора: файловый счётчик, окно после RETRIES_LIMIT неудач, удача сбрасывает;
#   F) права MCP: разбор scope и пропуск маршрутов коротким токеном ядра;
#   G) кука входа — HttpOnly (AUTH_COOKIE_HTTPONLY), SameSite, Secure на https;
#   H) скользящий срок: простой гасит сессию, запрос её продлевает, у конца жизни — новая;
#   I) вход: updateTokens выдаёт браузеру сессию, ключ API остаётся; Basic сверяет пароль и перехеширует;
#      код из письма выдаёт сессию; пароль, кабинет и Basic в окне блокировки закрыты.

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

$indexPhp = getenv("INDEX_PHP") ?: (is_file(__DIR__."/../integram.io/index.php") ? __DIR__."/../integram.io/index.php" : __DIR__."/index_integram.io.php");
$source = file_get_contents($indexPhp);

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "EMAIL"=>41, "ACTIVITY"=>124, "TOKEN"=>125, "SECRET"=>130, "DATABASE"=>271) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
define("ADMINHASH", "adminhash");
define("MAIL_MASK", "/.+@.+\..+/i");
$logsDir = sys_get_temp_dir()."/sec1043io_".bin2hex(random_bytes(4))."/";
mkdir($logsDir);
define("LOGS_DIR", $logsDir);
foreach(array("CHECKCODE_RETRIES_LIMIT" => 3, "CHECKCODE_LOCK_TTL" => 3600) as $k => $v)
    define($k, preg_match('/define\("'.$k.'",\s*(\d+)\)/', $source, $m) ? (int)$m[1] : $v);
# Константы блока #1043 — как в ядре
if(preg_match_all('/^(?:defined\("\w+"\) \|\| )?define\("(SESSION_IDLE|SESSION_LIFETIME|SESSION_TOUCH|SESSION_ROTATE|SESSION_MAX|MCP_SCOPES|RETRIES_LIMIT|LOGIN_LOCK_S|AUTH_COOKIE_SAMESITE|AUTH_COOKIE_HTTPONLY)", (.+?)\);/m', $source, $mm, PREG_SET_ORDER))
    foreach($mm as $m) eval('define("'.$m[1].'", '.$m[2].');');
$z = "abc";
class Died extends Exception {}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function my_die($msg, $code=""){ throw new Died($msg); }
function login($z="", $u="", $message="", $details=""){ throw new Died("login:$message"); }
function wlog($m, $f=""){}
function isApi(){ return !empty($GLOBALS["IS_API"]); }
function api_dump($json, $name=""){ throw new Died("api:$json"); }

function Exec_sql($sql, $label, $log=TRUE, $fatal=TRUE){
    $GLOBALS["SQL"][$label] = $sql;
    $fn = isset($GLOBALS["ANSWER"][$label]) ? $GLOBALS["ANSWER"][$label] : null;
    $r = new stdClass; $r->rows = $fn ? $fn($sql) : array();
    return $r;
}
function fk_fetch_array($res){ return ($res && count($res->rows)) ? array_shift($res->rows) : NULL; }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["LOG"][] = array("ins", $t, (string)$val, $ord); return 999; }
function Update_Val($id, $val, $no_tail=FALSE){ $GLOBALS["LOG"][] = array("upd", $id, (string)$val); }
function test_setcookie($n, $v, $o=0, $p=""){ $GLOBALS["LOG"][] = array("cookie", $n, (string)$v, $o); return true; }
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
foreach(array("Salt", "secureToken", "xsrf", "updateTokens", "Token_is_reg_code", "User_names_for_reg_code", "Reg_code_tokens",
              "Basic_auth_token", "Checkcode_retries", "Checkcode_login",
              "Pwd_legacy", "Pwd_prehash", "Pwd_hash", "Pwd_is_modern", "Pwd_verify", "Pwd_needs_rehash", "Pwd_reset_sig",
              "Token_parse", "Token_stored_val", "Token_db_val", "Token_key_sql", "Token_idle_sql", "Token_match_sql",
              "Session_cookie_exp", "Session_refresh_action", "Token_scope_code", "Token_scope_names", "Session_new",
              "Session_prune_ids", "Session_prune", "Is_https", "Auth_cookie_opts", "Auth_cookie", "Login_lock_left",
              "Login_retries", "Token_scope_allows", "Exit_redirect_script", "Reg_db_password") as $fn){
    try {
        eval(str_replace(array("mysqli_fetch_array(", "setcookie("), array("fk_fetch_array(", "test_setcookie("),
            extract_function_source($source, $fn)));
    } catch(Exception $e){
        $missing[] = $fn;
    }
}
expect(!$missing, "в ядре integram.io есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
foreach(array("SESSION_IDLE", "SESSION_LIFETIME", "SESSION_TOUCH", "SESSION_ROTATE", "SESSION_MAX", "MCP_SCOPES", "RETRIES_LIMIT", "LOGIN_LOCK_S") as $c)
    expect(defined($c), "константа $c задана в ядре");
if($missing){
    $out = ob_get_clean(); echo $out; echo "\n$failures FAILED\n"; exit(1);
}
function log_find($kind, $pred){
    foreach($GLOBALS["LOG"] as $l) if(($l[0] === $kind) && $pred($l)) return $l;
    return NULL;
}

# ── A) пароль ──────────────────────────────────────────────────────────────────────────────
$h = Pwd_hash("Пароль-1");
$legacy = sha1(Salt("ivan", "old-pwd"));
expect(Pwd_is_modern($h) && Pwd_verify("Пароль-1", $h, "ivan") && !Pwd_verify("Пароль-2", $h, "ivan"), "A: новый хеш — password_hash, сверяется только верный пароль");
$long = str_repeat("я", 60);
expect(!Pwd_verify($long."x", Pwd_hash($long."y"), "ivan"), "A: длинный пароль сравнивается целиком (за пределом 72 байт bcrypt)");
expect(Pwd_verify("old-pwd", $legacy, "IVAN") && !Pwd_verify("other", $legacy, "ivan"), "A: прежний sha1(Salt) принимается только с верным паролем");
expect(!Pwd_verify("old-pwd", $legacy, "petr"), "A: прежний хеш солён логином — чужой логин не подходит");
expect(Pwd_needs_rehash($legacy) && !Pwd_needs_rehash($h), "A: прежний хеш требует перехеша, новый — нет");
expect(!Pwd_verify("", "", "ivan"), "A: пустой хеш не пускает");
$z = "other";
expect(!Pwd_verify("Пароль-1", $h, "ivan"), "A: хеш одной базы не подходит к другой");
$z = "abc";

# ── B) ссылка сброса ───────────────────────────────────────────────────────────────────────
$new = Pwd_hash("new-one");
$sig = Pwd_reset_sig("Ivan", $new, $legacy);
expect(hash_equals($sig, Pwd_reset_sig("ivan", $new, $legacy)), "B: подпись сходится на том же имени, p и текущем хеше");
expect(!hash_equals($sig, Pwd_reset_sig("ivan", Pwd_hash("evil"), $legacy)), "B: подменённый p подпись не проходит");
expect(!hash_equals($sig, Pwd_reset_sig("ivan", $new, $new)), "B: после смены пароля старая ссылка мертва");

# ── C) токены ──────────────────────────────────────────────────────────────────────────────
$now = 1800000000; $sec = str_repeat("ab", 32);
$s = "s.".($now + 100).".".$sec;
expect(Token_db_val($s, $now) === "s.".($now + 100).".".hash("sha256", $sec), "C: в базе — хеш секрета, не сам токен");
expect(Token_db_val($s, $now + 100) === false, "C: истёкшая сессия не принимается");
expect(Token_db_val("mcp.".($now + 100).".rw.".$sec, $now) === false, "C: MCP-токен ядро как вход не принимает");
expect(Token_db_val("0123abcd", $now) === "0123abcd", "C: прежний ключ API ищется как есть");

# ── D) чистка сессий ───────────────────────────────────────────────────────────────────────
$act = (int)floor($now / 60);
$rows = array();
foreach(array(1 => "0123abcd", 2 => "s.".($now - 1).".h", 3 => "s.".($now + 9).".h", 4 => "s.".($now + 9).".h",
              5 => "s.".($now + 9).".h", 6 => "mcp.".($now - 5).".r.h", 7 => "mcp.".($now + 5).".r.h", 9 => "s.".($now + 9).".h") as $id => $val)
    $rows[$id] = array("val" => $val, "ord" => $id === 9 ? $act - (int)(SESSION_IDLE / 60) - 1 : $act);
$drop = Session_prune_ids($rows, $now, 2);
sort($drop);
expect($drop === array(2, 3, 6, 9), "D: удаляются истёкшие, простаивающая и старшая сессия сверх лимита: ".json_encode($drop));

# ── E) блокировка подбора ──────────────────────────────────────────────────────────────────
expect(Login_lock_left("4:".$now, $now) === 0 && Login_lock_left(RETRIES_LIMIT.":".$now, $now) === LOGIN_LOCK_S, "E: окно — на лимите неудач");
expect(Login_lock_left(RETRIES_LIMIT.":".($now - LOGIN_LOCK_S), $now) === 0, "E: окно истекает само");
Login_retries(41, -1);
for($i = 0; $i < RETRIES_LIMIT; $i++) Login_retries(41, 1);
expect(Login_lock_left(Login_retries(41), time()) > 0, "E: файловый счётчик после ".RETRIES_LIMIT." неудач запирает вход");
expect(Login_lock_left(Login_retries(42), time()) === 0, "E: у другого пользователя вход открыт");
Login_retries(41, -1);
expect(Login_lock_left(Login_retries(41), time()) === 0, "E: удачный вход сбрасывает счётчик");

# ── F) права MCP ───────────────────────────────────────────────────────────────────────────
expect(Token_scope_code("write,read") === "rw" && Token_scope_code("read,admin") === false, "F: разбор прав");
foreach(array(array("r", "object", "GET", true), array("r", "_m_new", "POST", false), array("drw", "_m_del", "POST", true),
              array("rw", "_m_del", "POST", false), array("rsw", "_d_new", "POST", true), array("dgrsw", "exit", "GET", false),
              array("dgrsw", "_mcp_token", "POST", false), array("dgrsw", "dir_admin", "GET", false)) as $c)
    expect(Token_scope_allows($c[0], $c[1], $c[2]) === $c[3], "F: права {$c[0]}: {$c[2]} {$c[1]} ".($c[3] ? "разрешён" : "запрещён"));

# ── G) кука ────────────────────────────────────────────────────────────────────────────────
$_SERVER["HTTPS"] = "on";
$o = Auth_cookie_opts(123);
expect($o["httponly"] === (bool)AUTH_COOKIE_HTTPONLY && AUTH_COOKIE_HTTPONLY && $o["secure"] === true && $o["samesite"] === "Lax",
    "G: кука входа — HttpOnly по умолчанию, Secure на https, SameSite=Lax");
unset($_SERVER["HTTPS"]);

# ── H) скользящий срок ─────────────────────────────────────────────────────────────────────
$sp = Token_parse("s.".($now + 200 * 86400).".".$sec);
expect(Token_idle_sql("tok", $sp, $now) === " AND tok.ord>=".(int)floor(($now - SESSION_IDLE) / 60), "H: сессия принимается, пока не простаивает");
expect(Session_refresh_action($sp, $act - (int)(SESSION_TOUCH / 60), $now, false) === "touch", "H: раз в SESSION_TOUCH запрос продлевает сессию");
expect(Session_refresh_action(Token_parse("s.".($now + 60).".".$sec), $act, $now, true) === "rotate", "H: у конца жизни страница получает новую сессию");
expect(Session_cookie_exp("s.".($now + 200 * 86400).".".$sec, $now) === $now + SESSION_IDLE, "H: кука живёт до следующего простоя");

# ── I) вход ────────────────────────────────────────────────────────────────────────────────
$key = "live".str_repeat("e", 60);
$GLOBALS["LOG"] = array(); $GLOBALS["GLOBAL_VARS"] = array();
updateTokens(array("uid" => 9, "val" => "abc", "tok" => 79, "token" => $key, "xsrf" => 0, "act" => 0), array());
$t = $GLOBALS["GLOBAL_VARS"]["token"];
expect(Token_parse($t) !== NULL && Token_parse($t)["kind"] === "s", "I: вход выдаёт сессию устройства, не общий ключ");
expect(log_find("ins", function($l) use ($t){ return $l[1] === TOKEN && $l[2] === Token_db_val($t); }) !== NULL, "I: в базу легла строка сессии с хешем");
expect(log_find("upd", function($l) use ($key){ return $l[1] === 79; }) === NULL, "I: ключ API пользователя не тронут");
$ck = log_find("cookie", function($l){ return $l[1] === "abc"; });
expect($ck && $ck[2] === $t && is_array($ck[3]) && $ck[3]["httponly"] === true, "I: кука базы — с сессией и HttpOnly");
expect($GLOBALS["GLOBAL_VARS"]["xsrf"] === xsrf($t, "abc"), "I: xsrf — свой у сессии");
$legacyAlice = sha1(Salt("alice", "secret"));
$GLOBALS["ANSWER"]["Basic authentication"] = function($sql) use ($legacyAlice){
    return array(array("tok" => "T0K", "tok_id" => 3, "id" => 7, "pwd" => $legacyAlice, "pwd_id" => 70)); };
$GLOBALS["LOG"] = array();
Login_retries(7, -1);
expect(Basic_auth_token(base64_encode("alice:secret")) === "T0K", "I: Basic с прежним хешем — ключ пользователя");
expect(log_find("upd", function($l){ return $l[1] === 70 && Pwd_is_modern($l[2]); }) !== NULL, "I: Basic перехешировал пароль");
expect(Basic_auth_token(base64_encode("alice:wrong")) === FALSE, "I: Basic с неверным паролем — отказ");
for($i = 1; $i < RETRIES_LIMIT; $i++) Basic_auth_token(base64_encode("alice:wrong"));
expect(Basic_auth_token(base64_encode("alice:secret")) === FALSE, "I: Basic в окне блокировки закрыт и с верным паролем");
Login_retries(7, -1);
$GLOBALS["ANSWER"]["Check the user token"] = function($sql){
    return array(array("id" => 11, "tok" => 111, "token" => "ab12".str_repeat("f", 60), "xsrf" => 0, "act" => 0)); };
$GLOBALS["ANSWER"]["Get user emails"] = function($sql){ return array(array("val" => "ivan@x.ru")); };
Checkcode_retries(11, -1);
$GLOBALS["LOG"] = array();
$r = Checkcode_login("ivan@x.ru", "AB12");
expect(isset($r["token"]) && Token_parse($r["token"]) !== NULL && Token_parse($r["token"])["kind"] === "s", "I: код из письма выдаёт сессию");
expect(log_find("upd", function($l){ return $l[1] === 111 && preg_match('/^[0-9a-f]{64}$/', $l[2]); }) !== NULL, "I: ключ, из которого взят код, заменён (код одноразовый)");

# ── R) регистрация без пароля открытым текстом ─────────────────────────────────────────────
# В кабинете до подтверждения лежит password_hash кабинета; новая база получает его с пометкой my:
$z = "my";
$cab = Pwd_hash("Reg-Pass-1");
expect(Pwd_is_modern($cab) && strpos($cab, "Reg-Pass-1") === false, "R: в кабинете хранится хеш, а не пароль");
$z = "newdb1";
$db = Reg_db_password($cab);
expect(strpos($db, "Reg-Pass-1") === false, "R: в новой базе пароля открытым текстом нет");
expect(Pwd_verify("Reg-Pass-1", $db, "newdb1") && !Pwd_verify("Reg-Pass-2", $db, "newdb1"),
    "R: в новой базе входит пароль кабинета и только он");
expect(Pwd_needs_rehash($db), "R: при первом входе хеш переводится на перец новой базы");
expect(!Pwd_verify("Reg-Pass-1", "my:".Pwd_legacy("newdb1", "Reg-Pass-1"), "newdb1") && !Pwd_verify("", "my:", "newdb1"),
    "R: пометка my: принимает только password_hash");
$old = Reg_db_password("Plain-Pending-1");  # регистрация, начатая до выкладки: в кабинете пароль текстом
expect(Pwd_is_modern($old) && Pwd_verify("Plain-Pending-1", $old, "newdb1"),
    "R: незавершённая прежняя регистрация хешируется для новой базы");
$z = "abc";

# ── X) переход после выхода ─────────────────────────────────────────────────────────────────
$s = Exit_redirect_script("abc", "x</script><script>alert(document.cookie)</script>");
expect(substr_count(strtolower($s), "<script") === 1 && substr_count(strtolower($s), "</script") === 1,
    "X: next_act не открывает и не закрывает тег script");
$s = Exit_redirect_script("abc", "x\\';alert(1);//");
expect(preg_match('#^<script>document\.location\.href=("(?:[^"\\\\]|\\\\.)*")</script>$#', $s, $m)
    && json_decode($m[1]) === "/abc/x\\';alert(1);//", "X: next_act остаётся внутри одной строки JS");
preg_match('#href=("(?:[^"\\\\]|\\\\.)*")#', Exit_redirect_script("abc", "edit_obj/12?edit&up=3"), $m);
expect(isset($m[1]) && json_decode($m[1]) === "/abc/edit_obj/12?edit&up=3", "X: обычный next_act ведёт туда же");

$out = ob_get_clean();
echo $out;
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
