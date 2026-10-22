<?php
# Мерка к правкам безопасности ядра (index.php) по лучшим практикам MCP Authorization / OAuth 2.1 (#1036):
#   A) ?login= входа в кабинет — только имя базы: SQL-идентификатор не переписывается (UNION → чужой токен);
#   B) адрес abn_URL/_connect — только http(s) на публичный хост: метаданные облака, loopback, приватные сети, file:// — нет;
#   C) _connect не отправляет токен/xsrf пользователя на внешний хост (token passthrough);
#   D) переход после выхода: next_act не закрывает <script> и не выходит из строки JS;
#   E) журнал запросов маскирует новый пароль (npw1/npw2), хеши ссылки confirm (p/o) и jwt;
#   F) смена пароля заменяет текущий токен сессии; без смены токен прежний.
#
# Запуск: php experiments/security-auth-bp-1036.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра (так тест виден красным на старом index.php).

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "TOKEN"=>125, "SECRET"=>130, "DATABASE"=>271) as $k => $v)
    define($k, $v);
define("SALT", "yyy");
define("USER_DB_MASK", "/^[a-z]\w{2,14}$/i");
define("LOG_VAL_MAX", 2048);
$z = "abc";

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
foreach(array("Salt", "checkDbName", "Cabinet_login_ok", "fetchUrlHostIsPublic", "Report_url_allowed", "Connect_url",
              "Exit_redirect_script", "logCut", "maskSensitiveLogValue", "logParams", "Rotate_token_hashes") as $fn){
    try { eval(extract_function_source($source, $fn)); } catch(Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в index.php есть все проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));

# ── A) имя базы кабинета ───────────────────────────────────────────────────────────────────
if(function_exists("Cabinet_login_ok")){
    foreach(array("abcd", "ivan_petrov", "Shop2026") as $ok)
        expect((bool)Cabinet_login_ok($ok), "A: имя базы ".json_encode($ok)." принимается");
    foreach(array("my/**/u/**/WHERE/**/0/**/UNION/**/SELECT/**/0x61626364#", "my u WHERE 0 UNION SELECT 1", "a`b", "ab",
                  "my;DROP", "abc'", array("abc")) as $bad)
        expect(!Cabinet_login_ok($bad), "A: ".json_encode($bad)." отклонено до SQL");
}

# ── B) исходящий адрес ─────────────────────────────────────────────────────────────────────
if(function_exists("Report_url_allowed")){
    foreach(array("http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8081/x", "http://10.0.0.5/", "http://192.168.1.1/",
                  "http://172.17.0.3:5432/", "http://[::1]/", "file:///etc/passwd", "gopher://127.0.0.1:6379/_x",
                  "ftp://8.8.8.8/", "javascript:alert(1)", "", "http:///nohost") as $bad)
        expect(!Report_url_allowed($bad), "B: ".json_encode($bad)." запрещён");
    foreach(array("https://8.8.8.8/api?x=1", "http://93.184.216.34/") as $ok)
        expect(Report_url_allowed($ok), "B: публичный ".json_encode($ok)." разрешён");
}

# ── C) параметры коннектора ────────────────────────────────────────────────────────────────
if(function_exists("Connect_url")){
    $u = Connect_url("https://api.example.com/v1?key=K", array("q" => "x", "token" => "T0K", "_xsrf" => "XS", "secret" => "S", "JWT" => "J"));
    expect($u === "https://api.example.com/v1?key=K&q=x", "C: внешнему хосту уходят только свои параметры: $u");
    expect(Connect_url("https://api.example.com/v1", array("a" => "1", "b" => "2")) === "https://api.example.com/v1?a=1&b=2",
        "C: без учётных данных адрес прежний");
}

# ── D) переход после выхода ────────────────────────────────────────────────────────────────
if(function_exists("Exit_redirect_script")){
    $s = Exit_redirect_script("abc", "x</script><script>alert(document.cookie)</script>");
    expect(substr_count(strtolower($s), "<script") === 1 && substr_count(strtolower($s), "</script") === 1,
        "D: next_act не открывает и не закрывает тег script");
    $s = Exit_redirect_script("abc", "x\\';alert(1);//");
    expect(preg_match('#^<script>document\.location\.href=("(?:[^"\\\\]|\\\\.)*")</script>$#', $s, $m)
        && json_decode($m[1]) === "/abc/x\\';alert(1);//", "D: next_act остаётся внутри одной строки JS");
    $s = Exit_redirect_script("abc", "edit_obj/12?edit&up=3");
    preg_match('#href=("(?:[^"\\\\]|\\\\.)*")#', $s, $m);
    expect(isset($m[1]) && json_decode($m[1]) === "/abc/edit_obj/12?edit&up=3", "D: обычный next_act ведёт туда же");
}

# ── E) маскирование журнала ────────────────────────────────────────────────────────────────
if(function_exists("logParams")){
    $_GET = array("u" => "ivan", "p" => "NEWHASH", "o" => "OLDHASH");
    $_POST = array("npw1" => "Secret-1", "npw2" => "Secret-1", "jwt" => "eyJ.x.y", "login" => "ivan");
    $out = logParams();
    foreach(array("p", "o", "npw1", "npw2", "jwt") as $k)
        expect(isset($out[$k]) && $out[$k] === "***", "E: $k в журнале замаскирован");
    expect($out["u"] === "ivan" && $out["login"] === "ivan", "E: несекретные параметры видны");
}

# ── F) ротация токена ──────────────────────────────────────────────────────────────────────
if(function_exists("Rotate_token_hashes")){
    $row = array("token" => "CURRENT-TOKEN");
    expect(in_array("CURRENT-TOKEN", Rotate_token_hashes($row, "ivan", "old-pwd", true), true),
        "F: после смены пароля текущий токен идёт на замену");
    expect(!in_array("CURRENT-TOKEN", Rotate_token_hashes($row, "ivan", "old-pwd", false), true),
        "F: обычный вход прежний токен сохраняет");
    expect(in_array(hash("sha512", Salt("ivan", "old-pwd")), Rotate_token_hashes($row, "ivan", "old-pwd", false), true),
        "F: токен, равный хешу пароля, по-прежнему заменяется (#5202)");
}

$out = ob_get_clean();
echo $out;
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
