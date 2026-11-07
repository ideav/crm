<?php
# Заголовки CORS ядра (python2node#1142, аудит #872 A8): Access-Control-Allow-* уходят только
# в ответ API-запросу — предзапрос OPTIONS, запрос с токеном в заголовке (X-Authorization /
# Authorization) или с параметром JSON* в адресе/теле. HTML-страницы, вход и кабинет отдаются
# без них. Список разрешённых origin задаёт CORS_ORIGINS в include/connection.php; без него —
# «*», как раньше, но только у API.
#
# Мерка: настоящая Cors_headers_list() из index.php на таблице «запрос × список origin».

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
try {
    eval(extract_function_source($source, "Cors_headers_list"));
} catch(Exception $e) {
    echo "FAIL: Cors_headers_list() в index.php — ".$e->getMessage()."\n";
    exit(1);
}

function acao($headers){
    foreach($headers as $h)
        if(stripos($h, "Access-Control-Allow-Origin:") === 0)
            return trim(substr($h, strlen("Access-Control-Allow-Origin:")));
    return null;
}
function has_header($headers, $prefix){
    foreach($headers as $h)
        if(stripos($h, $prefix) === 0) return true;
    return false;
}

$page   = array("REQUEST_METHOD" => "GET", "HTTP_ORIGIN" => "https://evil.example");
$opts   = array("REQUEST_METHOD" => "OPTIONS", "HTTP_ORIGIN" => "https://app.example");
$tokXA  = array("REQUEST_METHOD" => "POST", "HTTP_ORIGIN" => "https://app.example", "HTTP_X_AUTHORIZATION" => "t");
$tokA   = array("REQUEST_METHOD" => "GET", "HTTP_ORIGIN" => "https://app.example", "REDIRECT_HTTP_AUTHORIZATION" => "Bearer t");
$jsonQ  = array("JSON" => "");
$jsonKV = array("JSON_KV" => "");
$allow  = array("https://app.example", "https://other.example");

# 1. Без списка (как на проде до настройки): «*» только у API.
expect(acao(Cors_headers_list($page, array("a" => "1"), null)) === null, "страница без JSON и токена — без CORS");
expect(Cors_headers_list($page, array(), null) === array(), "страница — ни одного Access-Control-*");
expect(acao(Cors_headers_list($page, $jsonQ, null)) === "*", "?JSON — Allow-Origin *");
expect(acao(Cors_headers_list($page, $jsonKV, null)) === "*", "?JSON_KV — Allow-Origin *");
expect(acao(Cors_headers_list($opts, array(), null)) === "*", "предзапрос OPTIONS — Allow-Origin *");
expect(acao(Cors_headers_list($tokXA, array(), null)) === "*", "X-Authorization — Allow-Origin *");
expect(acao(Cors_headers_list($tokA, array(), null)) === "*", "Authorization (REDIRECT_) — Allow-Origin *");
expect(has_header(Cors_headers_list($opts, array(), null), "Access-Control-Allow-Headers:"), "OPTIONS — Allow-Headers есть");
expect(has_header(Cors_headers_list($opts, array(), null), "Access-Control-Allow-Methods:"), "OPTIONS — Allow-Methods есть");

# 2. Со списком origin: origin из списка отражается, чужой и пустой — без CORS.
expect(acao(Cors_headers_list($opts, array(), $allow)) === "https://app.example", "список: свой origin отражён");
expect(has_header(Cors_headers_list($opts, array(), $allow), "Vary: Origin"), "список: Vary: Origin");
expect(Cors_headers_list(array("REQUEST_METHOD" => "OPTIONS", "HTTP_ORIGIN" => "https://evil.example"), array(), $allow) === array(), "список: чужой origin — без CORS");
expect(Cors_headers_list(array("REQUEST_METHOD" => "GET"), $jsonQ, $allow) === array(), "список: без Origin — без CORS");
expect(Cors_headers_list(array("REQUEST_METHOD" => "GET", "HTTP_ORIGIN" => "https://app.example.evil"), $jsonQ, $allow) === array(), "список: сравнение точное, не префикс");
expect(Cors_headers_list($page, array(), $allow) === array(), "список: страница — без CORS");

# 3. Учётные данные кросс-доменно не разрешаются ни в одном режиме.
foreach(array(null, $allow) as $a)
    expect(!has_header(Cors_headers_list($tokXA, $jsonQ, $a), "Access-Control-Allow-Credentials"), "без Allow-Credentials (".($a === null ? "*" : "список").")");

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
