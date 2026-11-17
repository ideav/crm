<?php
# Мерка к ideav/python2node#1288: вход вошедшего в my в базу на новом ядре (Core_sso_* в index.php).
# Запуск: php experiments/core-sso-1288.test.php (в гейте — через core-sso-1288.test.js)
# Функции берутся из index.php как есть. Проверяется то, что ждёт ядро: RS256-подпись, claims
# {iss, aud, sub, email, jti, iat, exp}, жизнь не дольше 300 с, одноразовый jti; возврат — только путь
# на ядре; форма отправляет токен ТЕЛОМ POST, а не в адресе.
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
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}
$GLOBALS["__cfg"] = array();
function aiConfigValue($names){
    foreach($names as $n)
        if(isset($GLOBALS["__cfg"][$n]) && trim((string)$GLOBALS["__cfg"][$n]) !== "")
            return trim((string)$GLOBALS["__cfg"][$n]);
    return "";
}
$src = file_get_contents(__DIR__."/../index.php");
foreach(array("Core_sso_back", "Core_sso_url", "Core_sso_token", "Core_sso_page") as $fn)
    eval(extract_function_source($src, $fn));
expect(strpos($src, "Core_sso_enter();") !== false && strpos($src, '=== "coresso"') !== false, "маршрут /my/coresso подключён");

function b64url_decode($s){ return base64_decode(strtr($s, "-_", "+/").str_repeat("=", (4 - strlen($s) % 4) % 4)); }
$res = openssl_pkey_new(array("private_key_bits" => 2048, "private_key_type" => OPENSSL_KEYTYPE_RSA));
openssl_pkey_export($res, $privPem);
$pub = openssl_pkey_get_details($res)["key"];

# без ключа и без почты токена нет
expect(Core_sso_token("courses", "a@b.ru", 7) === "", "ключ не задан — токена нет");
$GLOBALS["__cfg"]["CORE_JWT_PRIVATE_KEY"] = str_replace("\n", "\n", $privPem);
expect(Core_sso_token("courses", "", 7) === "", "почты нет — токена нет");

$now = 1800000000;
$t = Core_sso_token("courses", "a@b.ru", 77, $now);
$p = explode(".", $t);
expect(count($p) === 3, "токен из трёх частей");
$h = json_decode(b64url_decode($p[0]), true);
$c = json_decode(b64url_decode($p[1]), true);
expect(($h["alg"] ?? "") === "RS256", "alg RS256");
expect(openssl_verify($p[0].".".$p[1], b64url_decode($p[2]), $pub, OPENSSL_ALGO_SHA256) === 1, "подпись сходится с публичным ключом");
expect($c["iss"] === "crm" && $c["aud"] === "courses" && $c["sub"] === "77" && $c["email"] === "a@b.ru", "claims: iss, aud = база, sub, email");
expect(is_string($c["jti"]) && strlen($c["jti"]) === 32, "jti: 128 бит");
expect($c["iat"] === $now && $c["exp"] - $c["iat"] === 300, "жизнь 300 с по умолчанию");
$c2 = json_decode(b64url_decode(explode(".", Core_sso_token("courses", "a@b.ru", 77, $now))[1]), true);
expect($c2["jti"] !== $c["jti"], "jti каждый раз новый");
$GLOBALS["__cfg"]["CORE_JWT_TTL"] = "900";
$c3 = json_decode(b64url_decode(explode(".", Core_sso_token("courses", "a@b.ru", 77, $now))[1]), true);
expect($c3["exp"] - $c3["iat"] === 300, "CORE_JWT_TTL больше 300 с срезается");
$GLOBALS["__cfg"]["CORE_JWT_TTL"] = "60";
$c4 = json_decode(b64url_decode(explode(".", Core_sso_token("courses", "a@b.ru", 77, $now))[1]), true);
expect($c4["exp"] - $c4["iat"] === 60, "меньший CORE_JWT_TTL уважается");

# возврат: только путь на ядре
expect(Core_sso_back("/courses/?a=1") === "/courses/?a=1", "back: путь пропущен");
foreach(array("https://evil.example/", "//evil.example", "/\evil.example", "evil", "javascript:alert(1)", "", "/a\r\nSet-Cookie: x=1", null, array("/x")) as $bad)
    expect(Core_sso_back($bad) === "/", "back: ".json_encode($bad)." -> /");

# адрес ядра: только https без пути
expect(Core_sso_url("https://ai.ideav.online") === "https://ai.ideav.online", "url: https-хост принят");
foreach(array("http://ai.ideav.online", "https://ai.ideav.online/x", "https://a.b@evil.example", "ai.ideav.online", "", null) as $bad)
    expect(Core_sso_url($bad) === "", "url: ".json_encode($bad)." отвергнут");

# страница: POST-форма, токен в теле, а не в адресе; значения экранированы
$page = Core_sso_page("https://ai.ideav.online", "courses", "TOKEN.X.Y", "/c/?q=\"><b>");
expect(strpos($page, 'method="post" action="https://ai.ideav.online/api/v1/courses/login/crm"') !== false, "форма: POST на /login/crm базы");
expect(strpos($page, 'name="token" value="TOKEN.X.Y"') !== false, "форма: токен в поле");
expect(strpos($page, "action=\"https://ai.ideav.online/api/v1/courses/login/crm\"") !== false && strpos($page, "login/crm?") === false, "токена нет в адресе формы");
expect(strpos($page, '"><b>') === false && strpos($page, "&quot;&gt;&lt;b&gt;") !== false, "back экранирован");
expect(strpos($page, 'name="referrer" content="no-referrer"') !== false, "referrer: no-referrer");

echo $failures ? "\nFAILED: $failures\n" : "\nOK\n";
exit($failures ? 1 : 0);
