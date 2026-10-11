<?php
# Мерка к issue #5131: агенту уходит токен ядра (core_token) того же пользователя.
# https://github.com/ideav/crm/issues/5131
#
# Запуск: php experiments/ai-agent-core-token-5131.test.php (в гейте — через одноимённый .test.js)
#
# Проводка /{db}/ai/agent берётся из index.php как есть, стабами заменены только XSRF, оплата
# и сеть. Проверяется:
#   1) задан CORE_JWT_PRIVATE_KEY — агенту уходит core_token: RS256-JWT, подпись сходится
#      с публичным ключом, claims username = пользователь, iss = crm, aud = база, жизнь ≤ 900 c;
#   2) ключ в одну строку с `\n` (как в env) работает так же;
#   3) CORE_JWT_ISS и CORE_JWT_TTL меняют iss и жизнь, TTL больше 900 c урезается до 900;
#   4) ключа нет или он битый — поля core_token нет, token CRM уходит как прежде.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

define("AI_AGENT_JOBS_MAX", 20);
define("AI_AGENT_JOBS_TTL", 24 * 3600);

class ApiDone extends Exception { public $json; function __construct($json){ $this->json=$json; parent::__construct("done"); } }
class ApiErr extends Exception { public $payload; function __construct($code,$payload){ $this->payload=$payload; parent::__construct("err",$code); } }

function api_dump($json, $name="api.json"){ throw new ApiDone($json); }
function aiAgentError($message, $code=400, $extra=array()){
    throw new ApiErr($code, array_merge(array("error"=>$message), is_array($extra)?$extra:array()));
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s',$v,$m) ? $m[1] : $v; }
function check(){}
function validateAiProviderEndpoint($e){}
$GLOBALS["__pay_ok"] = true;
function checkAiAgentPayment($db){
    if(empty($GLOBALS["__pay_ok"]))
        return array("ok"=>false,"status"=>"not_paid","message"=>"нужна оплата","payUrl"=>"https://pay");
    return array("ok"=>true,"status"=>"active","paidUntil"=>time()+1000,"payUrl"=>"https://pay");
}
$GLOBALS["__cfg"] = array(
    "INTEGRAM_AGENT_ENDPOINT" => "https://agent.example/agent/chat",
    "AI_AGENT_CALLBACK_BASE_URL" => "https://crm.example"
);
function aiConfigValue($names){
    foreach($names as $n)
        if(isset($GLOBALS["__cfg"][$n]) && trim((string)$GLOBALS["__cfg"][$n]) !== "")
            return trim((string)$GLOBALS["__cfg"][$n]);
    return "";
}
# Сеть: запоминаем запрос к агенту, агент принимает задачу в очередь (вариант B1).
function aiChatPostJson($endpoint, $request, $headers, $timeout=60){
    $GLOBALS["__capture"] = $request;
    return json_encode(array("job_id"=>"agent-1","status"=>"queued"));
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

# Все функции ИИ-агента из ядра: от диспетчера до хранилища задач. Набор берётся по префиксу,
# чтобы мерка не зависела от того, как разложены проверки доступа.
$source = file_get_contents(__DIR__."/../index.php");
$skip = array("aiAgentError", "aiAgentRawInput", "checkAiAgentPayment");
preg_match_all('/^function\s+((?:handleAiAgent|aiAgent|callIntegramAgent|collectAiAgent)\w*)\s*\(/m', $source, $m);
foreach(array_unique($m[1]) as $fn)
    if(!in_array($fn, $skip, true))
        eval(extract_function_source($source, $fn));
eval(extract_function_source($source, "extractAiProviderContent"));


$db = "acme5131_".getmypid();
$GLOBALS["z"] = $db;
@unlink(aiAgentJobsFile($db));

function b64url_decode($s){ return base64_decode(strtr($s, "-_", "+/").str_repeat("=", (4 - strlen($s) % 4) % 4)); }
function post_as($user){
    $GLOBALS["GLOBAL_VARS"] = array("user"=>$user, "token"=>"tok-".$user);
    $_SERVER["REQUEST_METHOD"] = "POST";
    $_GET = array(); $_POST = array("message"=>"покажи мои задачи"); $_FILES = array();
    $GLOBALS["__capture"] = null;
    try { handleAiAgentRequest(array()); }
    catch(ApiDone $d){}
    catch(ApiErr $e){ echo "ApiErr ".$e->getCode()." ".json_encode($e->payload, JSON_UNESCAPED_UNICODE)."\n"; }
    return $GLOBALS["__capture"];
}
# Разобрать и проверить core_token публичным ключом: claims или null.
function core_claims($cap, $publicPem){
    if(!is_array($cap) || !isset($cap["core_token"]) || !is_string($cap["core_token"])) return null;
    $parts = explode(".", $cap["core_token"]);
    if(count($parts) !== 3) return null;
    $header = json_decode(b64url_decode($parts[0]), true);
    if(!is_array($header) || ($header["alg"] ?? "") !== "RS256") return null;
    if(openssl_verify($parts[0].".".$parts[1], b64url_decode($parts[2]), $publicPem, OPENSSL_ALGO_SHA256) !== 1) return null;
    return json_decode(b64url_decode($parts[1]), true);
}

$key = openssl_pkey_new(array("private_key_bits"=>2048, "private_key_type"=>OPENSSL_KEYTYPE_RSA));
openssl_pkey_export($key, $privatePem);
$publicPem = openssl_pkey_get_details($key)["key"];

# 1) Ключ задан — core_token подписан, claims те, что ждёт ядро.
$GLOBALS["__cfg"]["CORE_JWT_PRIVATE_KEY"] = $privatePem;
$before = time();
$cap = post_as("petrov");
$c = core_claims($cap, $publicPem);
expect(is_array($c), "#5131: агенту передан core_token — RS256, подпись сходится с публичным ключом");
expect(is_array($c) && ($c["username"] ?? null) === "petrov", "#5131: username = пользователь чата");
expect(is_array($c) && ($c["iss"] ?? null) === "crm", "#5131: iss = crm по умолчанию");
expect(is_array($c) && ($c["aud"] ?? null) === $db, "#5131: aud = текущая база");
expect(is_array($c) && is_int($c["iat"] ?? null) && $c["iat"] >= $before && $c["iat"] <= time(), "#5131: iat — сейчас");
expect(is_array($c) && is_int($c["exp"] ?? null) && $c["exp"] - $c["iat"] === 900, "#5131: жизнь по умолчанию 900 c");
expect(is_array($c) && !array_key_exists("token", $c), "#5131: token CRM в JWT ядра не кладётся");
expect(is_array($cap) && $cap["token"] === "tok-petrov", "#5131: token CRM уходит как прежде");

# 2) Ключ в одну строку с `\n` — как его кладут в env.
$GLOBALS["__cfg"]["CORE_JWT_PRIVATE_KEY"] = str_replace("\n", "\\n", trim($privatePem));
$c = core_claims(post_as("sidorov"), $publicPem);
expect(is_array($c) && ($c["username"] ?? null) === "sidorov", "#5131: ключ с `\\n` в одну строку работает");

# 3) Издатель и жизнь настраиваются; жизнь больше 900 c урезается.
$GLOBALS["__cfg"]["CORE_JWT_ISS"] = "crm-ideav";
$GLOBALS["__cfg"]["CORE_JWT_TTL"] = "120";
$c = core_claims(post_as("petrov"), $publicPem);
expect(is_array($c) && ($c["iss"] ?? null) === "crm-ideav", "#5131: CORE_JWT_ISS меняет iss");
expect(is_array($c) && $c["exp"] - $c["iat"] === 120, "#5131: CORE_JWT_TTL меняет жизнь");
$GLOBALS["__cfg"]["CORE_JWT_TTL"] = "86400";
$c = core_claims(post_as("petrov"), $publicPem);
expect(is_array($c) && $c["exp"] - $c["iat"] === 900, "#5131: CORE_JWT_TTL больше 900 c урезается до 900");
unset($GLOBALS["__cfg"]["CORE_JWT_ISS"], $GLOBALS["__cfg"]["CORE_JWT_TTL"]);

# 4) Нет ключа или он битый — поля нет, чат работает как прежде.
unset($GLOBALS["__cfg"]["CORE_JWT_PRIVATE_KEY"]);
$cap = post_as("petrov");
expect(is_array($cap) && !array_key_exists("core_token", $cap), "#5131: без ключа core_token не передаётся");
expect(is_array($cap) && $cap["token"] === "tok-petrov", "#5131: без ключа token CRM уходит как прежде");
$GLOBALS["__cfg"]["CORE_JWT_PRIVATE_KEY"] = "not a key";
$cap = @post_as("petrov");
expect(is_array($cap) && !array_key_exists("core_token", $cap), "#5131: битый ключ — core_token не передаётся, агент вызван");
unset($GLOBALS["__cfg"]["CORE_JWT_PRIVATE_KEY"]);

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
