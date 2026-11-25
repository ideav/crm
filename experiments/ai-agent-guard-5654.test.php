<?php
# Мерка к ideav/crm#5654: переключатель «Страж данных» в ИИ-чате.
# https://github.com/ideav/crm/issues/5654
#
# Запуск: php experiments/ai-agent-guard-5654.test.php (в гейте — через одноимённый .test.js)
#
# Проводка /{db}/ai/agent берётся из index.php как есть (обвязка — как в ai-agent-auto-apply-5118.test.php).
# Проверяется: GET /{db}/ai/agent/guard спрашивает сервис агента (GET <endpoint>/../guard?db=,
# Bearer агента) и отдаёт только available/toggle/topics/action; ответ кешируется; без адреса
# агента и при сбое — available=false. Вопрос с guard=1 уходит агенту с guard=true; без
# переключателя, с мусором и в действии над планом — без поля.

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
function checkAiAgentPayment($db){
    return array("ok"=>true,"status"=>"active","paidUntil"=>time()+1000,"payUrl"=>"https://pay");
}
$GLOBALS["__cfg"] = array(
    "INTEGRAM_AGENT_ENDPOINT" => "https://agent.example/agent/chat",
    "INTEGRAM_AGENT_TOKEN" => "agent-bearer",
    "AI_AGENT_CALLBACK_BASE_URL" => "https://crm.example"
);
function aiConfigValue($names){
    foreach($names as $n)
        if(isset($GLOBALS["__cfg"][$n]) && trim((string)$GLOBALS["__cfg"][$n]) !== "")
            return trim((string)$GLOBALS["__cfg"][$n]);
    return "";
}
function aiChatPostJson($endpoint, $request, $headers, $timeout=60){
    $GLOBALS["__capture"] = $request;
    return json_encode(array("job_id"=>"agent-1","status"=>"queued"));
}
# Сервис агента: ответ на GET /agent/guard задаётся тестом, вызовы считаются.
$GLOBALS["__guard_calls"] = array();
function aiAgentGuardFetch($url, $headers){
    $GLOBALS["__guard_calls"][] = array("url" => $url, "headers" => $headers);
    return $GLOBALS["__guard_reply"];
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
$skip = array("aiAgentError", "aiAgentRawInput", "checkAiAgentPayment", "aiAgentGuardFetch");
preg_match_all('/^function\s+((?:handleAiAgent|aiAgent|callIntegramAgent|collectAiAgent)\w*)\s*\(/m', $source, $m);
foreach(array_unique($m[1]) as $fn)
    if(!in_array($fn, $skip, true))
        eval(extract_function_source($source, $fn));
eval(extract_function_source($source, "extractAiProviderContent"));

$db = "acme5654_".getmypid();
$GLOBALS["z"] = $db;
$GLOBALS["GLOBAL_VARS"] = array("user"=>"petrov", "token"=>"tok-petrov");
@unlink(aiAgentJobsFile($db));
array_map("unlink", glob(sys_get_temp_dir()."/ai_agent_guard_".$db."_*.json"));

function run($method, $com, $post=array()){
    $_SERVER["REQUEST_METHOD"] = $method;
    $_GET = array(); $_POST = $post; $_FILES = array();
    $GLOBALS["__capture"] = null;
    try { handleAiAgentRequest($com); }
    catch(ApiDone $d){ return array("ok"=>true, "code"=>200, "data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false, "code"=>$e->getCode(), "data"=>$e->payload); }
    catch(Throwable $e){ return array("ok"=>false, "code"=>0, "data"=>$e->getMessage()); }
    return array("ok"=>false, "code"=>0, "data"=>null);
}
$guardCom = array("", $db, "ai", "agent", "guard");

# 1. Страж настроен: сервис спрошен по адресу /agent/guard с Bearer, наружу — только 4 поля.
$GLOBALS["__guard_reply"] = json_encode(array("available"=>true, "toggle"=>true, "topics"=>array("hr", "<b>x</b>"),
    "action"=>"mask", "fields"=>array("Секрет")));
$r = run("GET", $guardCom);
expect($r["ok"] && $r["data"] === array("available"=>true, "toggle"=>true, "topics"=>array("hr"), "action"=>"mask"),
    "#5654: настроенный страж — available/toggle/topics/action, лишнее отброшено");
$call = isset($GLOBALS["__guard_calls"][0]) ? $GLOBALS["__guard_calls"][0] : null;
expect($call && $call["url"] === "https://agent.example/agent/guard?db=".rawurlencode($db),
    "#5654: адрес сервиса — /agent/guard рядом с /agent/chat");
expect($call && in_array("Authorization: Bearer agent-bearer", $call["headers"], true), "#5654: запрос с Bearer агента");

# 2. Повтор — из кеша, сервис не спрашивается.
$r = run("GET", $guardCom);
expect($r["ok"] && $r["data"]["available"] === true && count($GLOBALS["__guard_calls"]) === 1, "#5654: ответ кешируется");

# 3. Сбой сервиса — available=false (переключателя нет), сбой не кешируется.
array_map("unlink", glob(sys_get_temp_dir()."/ai_agent_guard_".$db."_*.json"));
$GLOBALS["__guard_reply"] = false;
$r = run("GET", $guardCom);
expect($r["ok"] && $r["data"] === array("available"=>false), "#5654: сервис не ответил — available=false");
$GLOBALS["__guard_reply"] = "<html>502</html>";
$r = run("GET", $guardCom);
expect($r["ok"] && $r["data"] === array("available"=>false) && count($GLOBALS["__guard_calls"]) === 3,
    "#5654: мусор от сервиса — available=false, без кеша");

# 4. Нет адреса агента — сервис не спрашивается.
$saved = $GLOBALS["__cfg"]["INTEGRAM_AGENT_ENDPOINT"];
$GLOBALS["__cfg"]["INTEGRAM_AGENT_ENDPOINT"] = "";
$n = count($GLOBALS["__guard_calls"]);
$r = run("GET", $guardCom);
expect($r["ok"] && $r["data"] === array("available"=>false) && count($GLOBALS["__guard_calls"]) === $n,
    "#5654: без INTEGRAM_AGENT_ENDPOINT — available=false без запроса");
$GLOBALS["__cfg"]["INTEGRAM_AGENT_ENDPOINT"] = $saved;

# 5. guest — отказ, как у всего ИИ-агента.
$GLOBALS["GLOBAL_VARS"] = array("user"=>"guest", "token"=>"");
$r = run("GET", $guardCom);
expect(!$r["ok"] && $r["code"] === 403, "#5654: guest — 403");
$GLOBALS["GLOBAL_VARS"] = array("user"=>"petrov", "token"=>"tok-petrov");

# 6. Переключатель включён — агенту уходит guard=true; иначе поля нет.
$r = run("POST", array(), array("message"=>"найди клиента", "guard"=>"1"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && isset($cap["guard"]) && $cap["guard"] === true, "#5654: переключатель включён — guard=true");
$askJob = $r["ok"] ? $r["data"]["job"]["id"] : "";
$r = run("POST", array(), array("message"=>"найди клиента"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && !array_key_exists("guard", $cap), "#5654: переключатель выключен — guard не передаётся");
$r = run("POST", array(), array("message"=>"найди клиента", "guard"=>"yes"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && !array_key_exists("guard", $cap), "#5654: guard только «1»");
$r = run("POST", array(), array("action"=>"cancel", "plan"=>$askJob, "guard"=>"1"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && $cap["action"] === "cancel" && !array_key_exists("guard", $cap),
    "#5654: действие над планом идёт без guard");

@unlink(aiAgentJobsFile($db));
array_map("unlink", glob(sys_get_temp_dir()."/ai_agent_guard_".$db."_*.json"));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
