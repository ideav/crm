<?php
# Мерка к ideav/crm#5118 (python2node#869): галка «Применить автоматически».
# https://github.com/ideav/crm/issues/5118
#
# Запуск: php experiments/ai-agent-auto-apply-5118.test.php (в гейте — через одноимённый .test.js)
#
# Проводка /{db}/ai/agent берётся из index.php как есть (обвязка — как в ai-agent-plan-846.test.php).
# Проверяется: вопрос с auto_apply=1 уходит агенту с auto_apply=true; без галки и с мусорным
# значением — без поля; действие над планом не передаёт auto_apply, даже если он пришёл.

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
        return array("ok"=>false,"status"=>"not_paid","message"=>"нужна оплата","payUrl"=>"https://pay","paidUntil"=>0);
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

$source = file_get_contents(__DIR__."/../index.php");
$skip = array("aiAgentError", "aiAgentRawInput", "checkAiAgentPayment");
preg_match_all('/^function\s+((?:handleAiAgent|aiAgent|callIntegramAgent|collectAiAgent)\w*)\s*\(/m', $source, $m);
foreach(array_unique($m[1]) as $fn)
    if(!in_array($fn, $skip, true))
        eval(extract_function_source($source, $fn));
eval(extract_function_source($source, "extractAiProviderContent"));
# Тело callback подаётся сюда вместо php://input.
function aiAgentRawInput(){ return $GLOBALS["__raw"]; }

$db = "acme5118_".getmypid();
$GLOBALS["z"] = $db;
@unlink(aiAgentJobsFile($db));

function as_user($user, $token){
    $GLOBALS["GLOBAL_VARS"] = array("user"=>$user, "token"=>$token);
}
function run($method, $get=array(), $post=array()){
    $_SERVER["REQUEST_METHOD"] = $method;
    $_GET = $get; $_POST = $post; $_FILES = array();
    $GLOBALS["__capture"] = null;
    try { handleAiAgentRequest(array()); }
    catch(ApiDone $d){ return array("ok"=>true, "code"=>200, "data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false, "code"=>$e->getCode(), "data"=>$e->payload); }
    return array("ok"=>false, "code"=>0, "data"=>null);
}
function callback($db, $jobId, $payload){
    $job = aiAgentJobGet($db, $jobId);
    $_SERVER["REQUEST_METHOD"] = "POST";
    $_SERVER["HTTP_X_AGENT_SECRET"] = $job ? $job["callbackSecret"] : "";
    $GLOBALS["__raw"] = json_encode(array_merge(array("job_id"=>$jobId), $payload), JSON_UNESCAPED_UNICODE);
    try { handleAiAgentCallback($db); }
    catch(ApiDone $d){ return array("ok"=>true, "data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false, "code"=>$e->getCode(), "data"=>$e->payload); }
    return array("ok"=>false);
}


as_user("petrov", "tok-petrov");

$r = run("POST", array(), array("message"=>"удали дубли", "auto_apply"=>"1"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && $cap["auto_apply"] === true,
    "#5118: галка стоит — агенту уходит auto_apply=true");
$askJob = $r["ok"] ? $r["data"]["job"]["id"] : "";

$r = run("POST", array(), array("message"=>"удали дубли"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && !array_key_exists("auto_apply", $cap),
    "#5118: галка снята — auto_apply не передаётся");

$r = run("POST", array(), array("message"=>"удали дубли", "auto_apply"=>"yes"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && !array_key_exists("auto_apply", $cap),
    "#5118: auto_apply только «1», прочее игнорируется");

$r = run("POST", array(), array("action"=>"cancel", "plan"=>$askJob, "auto_apply"=>"1"));
$cap = $GLOBALS["__capture"];
expect($r["ok"] && is_array($cap) && $cap["action"] === "cancel" && !array_key_exists("auto_apply", $cap),
    "#5118: действие над планом идёт без auto_apply");

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
