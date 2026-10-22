<?php
# Мерка к правкам авторизации ядра (index.php) по python2node#1043:
#   A) пароль — password_hash, прежний sha512 принимается и требует перехеша;
#   B) сброс пароля — подпись ссылки: p не подменить, после смены пароля ссылка мертва;
#   C) сессия на устройство: в базе — хеш; истёкший и MCP-токен как вход не принимаются;
#   D) чистка сессий: истёкшие, простаивающие и сверх лимита (старые первыми); ключ API не трогается;
#   H) скользящий срок: простой гасит сессию, запрос её продлевает, у конца жизни страница получает новую;
#   E) блокировка подбора: окно после RETRIES_LIMIT неудач, прежнее число без времени окна не держит;
#   F) права MCP: разбор scope и пропуск маршрутов коротким токеном ядра;
#   G) кука входа — HttpOnly, SameSite, Secure на https.
#
# Запуск: php experiments/security-auth-1043.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра (так тест виден красным на старом index.php).

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "TOKEN"=>125, "SECRET"=>130, "RETRIES"=>301, "RETRIES_LIMIT"=>5) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
$z = "abc";
function t9n($s){ return $s; }

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
# Константы блока #1043 — как в ядре (define из исходника, а не копией в тесте)
if(preg_match_all('/^(?:defined\("\w+"\) \|\| )?define\("(SESSION_IDLE|SESSION_LIFETIME|SESSION_TOUCH|SESSION_ROTATE|SESSION_MAX|MCP_SCOPES|LOGIN_LOCK_S)", (.+?)\);/m', $source, $mm, PREG_SET_ORDER))
    foreach($mm as $m) eval('define("'.$m[1].'", '.$m[2].');');
defined("AUTH_COOKIE_SAMESITE") || define("AUTH_COOKIE_SAMESITE", "Lax");
$missing = array();
foreach(array("Salt", "qrLoginIsHttps", "Pwd_legacy", "Pwd_prehash", "Pwd_hash", "Pwd_is_modern", "Pwd_verify", "Pwd_needs_rehash",
              "Pwd_reset_sig", "Token_parse", "Token_stored_val", "Token_db_val", "Token_scope_code", "Token_scope_names",
              "Session_prune_ids", "Login_lock_left", "Token_scope_allows", "Auth_cookie_opts", "Token_idle_sql",
              "Session_cookie_exp", "Session_refresh_action", "Mcp_client_secret_presented") as $fn){
    try { eval(extract_function_source($source, $fn)); } catch(Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в index.php есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
foreach(array("SESSION_IDLE", "SESSION_LIFETIME", "SESSION_TOUCH", "SESSION_ROTATE", "SESSION_MAX", "MCP_SCOPES", "LOGIN_LOCK_S") as $c)
    expect(defined($c), "константа $c задана в index.php");

# ── A) пароль ──────────────────────────────────────────────────────────────────────────────
if(function_exists("Pwd_verify") && function_exists("Pwd_hash")){
    $h = Pwd_hash("Пароль-1");
    expect(Pwd_is_modern($h) && !in_array($h, array(hash("sha512", SALT.$z."Пароль-1")), true), "A: новый хеш — password_hash, не sha512");
    expect(Pwd_verify("Пароль-1", $h), "A: верный пароль проходит");
    expect(!Pwd_verify("Пароль-2", $h), "A: неверный пароль не проходит");
    $long = str_repeat("я", 60);  # 120 байт: голый bcrypt обрезал бы до 72
    expect(!Pwd_verify($long."x", Pwd_hash($long."y")), "A: длинный пароль сравнивается целиком (за пределом 72 байт bcrypt)");
    $legacy = hash("sha512", SALT.$z."old-pwd");
    expect(Pwd_verify("old-pwd", $legacy) && !Pwd_verify("other", $legacy), "A: прежний sha512 принимается только с верным паролем");
    expect(Pwd_needs_rehash($legacy) && !Pwd_needs_rehash($h), "A: прежний хеш требует перехеша, новый — нет");
    expect(!Pwd_verify("", ""), "A: пустой хеш не пускает и с пустым паролем");
    $z = "other";
    expect(!Pwd_verify("Пароль-1", $h), "A: хеш одной базы не подходит к другой (перец SALT.<база>)");
    $z = "abc";
}

# ── B) ссылка сброса пароля ────────────────────────────────────────────────────────────────
if(function_exists("Pwd_reset_sig")){
    $old = hash("sha512", SALT.$z."old"); $new = Pwd_hash("new-one"); $evil = Pwd_hash("evil");
    $sig = Pwd_reset_sig("Ivan", $new, $old);
    expect(hash_equals($sig, Pwd_reset_sig("ivan", $new, $old)), "B: подпись сходится на том же имени, p и текущем хеше");
    expect(!hash_equals($sig, Pwd_reset_sig("ivan", $evil, $old)), "B: подменённый p подпись не проходит");
    expect(!hash_equals($sig, Pwd_reset_sig("ivan", $new, $new)), "B: после смены пароля старая ссылка мертва");
    expect(strpos($sig, $old) === false, "B: в ссылке нет хеша пароля");
}

# ── C) токены ──────────────────────────────────────────────────────────────────────────────
if(function_exists("Token_db_val")){
    $now = 1800000000; $sec = str_repeat("ab", 32);
    $s = "s.".($now + 100).".".$sec;
    $p = Token_parse($s);
    expect($p && $p["kind"] === "s" && $p["exp"] === $now + 100, "C: сессия разбирается");
    $db = Token_db_val($s, $now);
    expect($db === "s.".($now + 100).".".hash("sha256", $sec) && strpos($db, $sec) === false, "C: в базе — хеш секрета, не сам токен");
    expect(Token_db_val($s, $now + 100) === false, "C: истёкшая сессия не принимается");
    expect(Token_db_val("mcp.".($now + 100).".rw.".$sec, $now) === false, "C: MCP-токен ядро как вход не принимает");
    $m = "m.".($now + 100).".rw.".$sec;
    expect(Token_db_val($m, $now) === "m.".($now + 100).".rw.".hash("sha256", $sec), "C: короткий токен ядра (m.) принимается по хешу");
    expect(Token_db_val("0123abcd", $now) === "0123abcd", "C: прежний ключ API ищется как есть");
    foreach(array("s.".($now + 1).".rw.".$sec, "m.".($now + 1).".".$sec, "s.x.".$sec, "s.".($now + 1).".".substr($sec, 1)) as $bad)
        expect(Token_parse($bad) === NULL, "C: ".json_encode($bad)." — не токен нового вида");
}

# ── D) чистка сессий ───────────────────────────────────────────────────────────────────────
if(function_exists("Session_prune_ids")){
    $now = 1800000000; $act = (int)floor($now / 60);
    $rows = array();
    foreach(array(1 => "0123abcd", 2 => "s.".($now - 1).".h", 3 => "s.".($now + 9).".h", 4 => "s.".($now + 9).".h",
                  5 => "s.".($now + 9).".h", 6 => "mcp.".($now - 5).".r.h", 7 => "mcp.".($now + 5).".r.h", 8 => "m.".($now - 1).".r.h",
                  9 => "s.".($now + 9).".h") as $id => $val)
        $rows[$id] = array("val" => $val, "ord" => $id === 9 ? $act - (int)(SESSION_IDLE / 60) - 1 : ($id === 1 ? 1 : $act));
    $drop = Session_prune_ids($rows, $now, 2);
    sort($drop);
    expect($drop === array(2, 3, 6, 8, 9), "D: удаляются истёкшие, простаивающая и старшая сессия сверх лимита: ".json_encode($drop));
    expect(!in_array(1, $drop, true) && !in_array(7, $drop, true), "D: ключ API и живой MCP-токен не трогаются");
}

# ── H) скользящий срок ─────────────────────────────────────────────────────────────────────
if(function_exists("Session_refresh_action") && function_exists("Token_idle_sql")){
    $now = 1800000000; $act = (int)floor($now / 60); $sec = str_repeat("cd", 32);
    $s = Token_parse("s.".($now + 200 * 86400).".".$sec);
    expect(Token_idle_sql("tok", $s, $now) === " AND tok.ord>=".(int)floor(($now - SESSION_IDLE) / 60),
        "H: сессия принимается, только пока последний запрос не старше SESSION_IDLE");
    expect(Token_idle_sql("tok", Token_parse("m.".($now + 9).".r.".$sec), $now) === "" && Token_idle_sql("tok", NULL, $now) === "",
        "H: у короткого токена ядра и ключа API простоя нет");
    expect(Session_refresh_action($s, $act, $now, true) === "", "H: свежая активность — без записи в базу");
    expect(Session_refresh_action($s, $act - (int)(SESSION_TOUCH / 60), $now, false) === "touch", "H: раз в SESSION_TOUCH запрос продлевает сессию");
    $old = Token_parse("s.".($now + SESSION_ROTATE - 60).".".$sec);
    expect(Session_refresh_action($old, $act, $now, true) === "rotate", "H: у конца жизни страница браузера получает новую сессию");
    expect(Session_refresh_action($old, $act, $now, false) !== "rotate", "H: API-запрос и POST сессию не подменяют");
    expect(Session_cookie_exp("s.".($now + 200 * 86400).".".$sec, $now) === $now + SESSION_IDLE, "H: кука живёт до следующего простоя");
    expect(Session_cookie_exp("s.".($now + 5).".".$sec, $now) === $now + 5, "H: но не дольше жизни сессии");
    expect(SESSION_LIFETIME > SESSION_IDLE && SESSION_ROTATE < SESSION_IDLE, "H: жизнь сессии длиннее простоя, перевыпуск — раньше конца");
}

# ── E) блокировка подбора ──────────────────────────────────────────────────────────────────
if(function_exists("Login_lock_left")){
    $now = 1800000000;
    expect(Login_lock_left("4:".$now, $now) === 0, "E: до лимита вход открыт");
    expect(Login_lock_left("5:".$now, $now) === LOGIN_LOCK_S, "E: на лимите — окно");
    expect(Login_lock_left("5:".($now - 60), $now) === LOGIN_LOCK_S - 60, "E: окно отсчитывается от последней неудачи");
    expect(Login_lock_left("7:".($now - LOGIN_LOCK_S), $now) === 0, "E: окно истекает само");
    expect(Login_lock_left("5", $now) === 0 && Login_lock_left("", $now) === 0 && Login_lock_left(NULL, $now) === 0,
        "E: прежнее число без времени и пустой счётчик не запирают");
}

# ── F) права MCP ───────────────────────────────────────────────────────────────────────────
if(function_exists("Token_scope_allows")){
    expect(Token_scope_code("write,read") === "rw" && Token_scope_code("") === "r" && Token_scope_code("schema, delete") === "drs",
        "F: права в код: read всегда, буквы по алфавиту");
    expect(Token_scope_code("read,admin") === false, "F: неизвестное право отвергается");
    expect(Token_scope_names("dgrsw") === array("read", "write", "delete", "rights", "schema"), "F: код в имена");
    $cases = array(
        array("r", "object", "GET", true), array("r", "metadata", "GET", true), array("r", "_m_new", "POST", false),
        array("r", "object", "POST", false), array("rw", "_m_save", "POST", true), array("rw", "_m_del", "POST", false),
        array("drw", "_m_del", "POST", true), array("rw", "_d_new", "POST", false), array("rsw", "_d_new", "POST", true),
        array("drsw", "_d_del", "POST", false), array("dgrsw", "dir_admin", "GET", false), array("dgrsw", "_mcp_token", "POST", false),
        array("dgrsw", "exit", "GET", false), array("r", "report", "POST", true));
    foreach($cases as $c)
        expect(Token_scope_allows($c[0], $c[1], $c[2]) === $c[3], "F: права {$c[0]}: {$c[2]} {$c[1]} ".($c[3] ? "разрешён" : "запрещён"));
}

# ── G) кука входа ──────────────────────────────────────────────────────────────────────────
if(function_exists("Auth_cookie_opts")){
    $_SERVER["HTTPS"] = "on";
    $o = Auth_cookie_opts(123);
    expect($o["httponly"] === true && $o["secure"] === true && in_array($o["samesite"], array("Lax", "Strict"), true) && $o["path"] === "/",
        "G: кука входа — HttpOnly, Secure на https, SameSite");
    unset($_SERVER["HTTPS"]);
    expect(Auth_cookie_opts(1)["secure"] === false, "G: на http без Secure (иначе браузер куку не примет)");
    expect(Auth_cookie_opts(1, false)["httponly"] === false, "G: метка idbs_ видна скрипту");
}

# ── M) секрет клиента ideav-mcp доходит и через FastCGI ────────────────────────────────────
if(function_exists("Mcp_client_secret_presented")){
    expect(Mcp_client_secret_presented(array("Authorization" => "Bearer s3cr3t"), array()) === "s3cr3t", "M: Authorization: Bearer");
    expect(Mcp_client_secret_presented(array("X-MCP-Client-Secret" => "s3cr3t"), array()) === "s3cr3t",
        "M: свой заголовок — когда сервер (fcgid) режет Authorization");
    expect(Mcp_client_secret_presented(array(), array("REDIRECT_HTTP_AUTHORIZATION" => "Bearer s3cr3t")) === "s3cr3t",
        "M: Authorization, переданный сервером в окружение");
    expect(Mcp_client_secret_presented(array("Authorization" => "Basic eDp5"), array()) === "" && Mcp_client_secret_presented(array(), array()) === "",
        "M: без Bearer и без своего заголовка — секрета нет");
}

$out = ob_get_clean();
echo $out;
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
