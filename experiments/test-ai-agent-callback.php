<?php
# Regression test: async ИИ-агент через callback (вариант B1).
# Контекст — продолжение #3410 (см. docs/ai-agent-endpoint.md).
#
# Проверяем серверную проводку B1 целиком, с реальными callIntegramAgent /
# aiAgentSubmitRequest / handleAiAgentCallback и стабом только сетевого слоя:
#   1) в запрос к агенту попадают job_id / callback_url / callback_secret;
#   2) async-ack агента (202 {status:queued}) -> задача остаётся processing;
#   3) callback с верным секретом -> задача done с content; идемпотентность;
#   4) callback status=error -> задача error;
#   5) защита: неверный секрет 403, неизвестная задача 404, нет job_id/пустой
#      content 400;
#   6) синхронный ответ агента ({content}) по-прежнему даёт сразу done.

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
function checkAiAgentPayment($db){ return array("ok"=>true,"status"=>"active","paidUntil"=>time()+1000,"payUrl"=>"https://pay"); }
function validateAiProviderEndpoint($e){}

# Конфиг: endpoint задан => callIntegramAgent идёт по HTTP-пути; callback-URL из base.
$GLOBALS["__cfg"] = array(
    "INTEGRAM_AGENT_ENDPOINT" => "https://agent.example/agent",
    "AI_AGENT_CALLBACK_BASE_URL" => "https://crm.example"
);
function aiConfigValue($names){
    foreach($names as $n)
        if(isset($GLOBALS["__cfg"][$n]) && trim((string)$GLOBALS["__cfg"][$n]) !== "")
            return trim((string)$GLOBALS["__cfg"][$n]);
    return "";
}
# Стаб сетевого вызова: запоминаем запрос, возвращаем заданное тело.
function aiChatPostJson($endpoint, $request, $headers, $timeout=60){
    $GLOBALS["__capture"] = $request;
    return $GLOBALS["__ret"];
}
# Стаб тела callback-запроса.
function aiAgentRawInput(){ return isset($GLOBALS["__body"]) ? $GLOBALS["__body"] : ""; }

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
$fns = array(
    "callIntegramAgent","extractAiProviderContent",
    "handleAiAgentRequest","aiAgentRequireOwner","aiAgentSubmitRequest","aiAgentStatusRequest",
    "handleAiAgentCallback","aiAgentCallbackUrl","collectAiAgentAttachments",
    "aiAgentJobsFile","aiAgentJobId","aiAgentJobNew","aiAgentJobsAppend","aiAgentJobsFind",
    "aiAgentJobsLatest","aiAgentJobsPrune","aiAgentJobsApplyChanges","aiAgentJobsReplace",
    "aiAgentJobPublic","aiAgentJobsEncode","aiAgentJobsDecode","aiAgentJobsLoadRaw",
    "aiAgentJobsMutate","aiAgentJobCreate","aiAgentJobUpdate","aiAgentJobGet","aiAgentJobLatest"
);
foreach($fns as $fn) eval(extract_function_source($source, $fn));

$db = "cb".getmypid();
$GLOBALS["z"] = $db;
$GLOBALS["GLOBAL_VARS"] = array("user"=>$db);
@unlink(aiAgentJobsFile($db));

function submit($message){
    $_SERVER["REQUEST_METHOD"]="POST"; $_GET=array(); $_POST=array("message"=>$message); $_FILES=array();
    try { handleAiAgentRequest(array()); }
    catch(ApiDone $d){ return array("ok"=>true,"data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false,"code"=>$e->getCode(),"data"=>$e->payload); }
}
function status($jobId){
    $_SERVER["REQUEST_METHOD"]="GET"; $_GET=array("job"=>$jobId); $_POST=array();
    try { handleAiAgentRequest(array()); }
    catch(ApiDone $d){ return array("ok"=>true,"data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false,"code"=>$e->getCode(),"data"=>$e->payload); }
}
function callback($body, $secret){
    global $db;
    $_SERVER["REQUEST_METHOD"]="POST";
    $_SERVER["HTTP_X_AGENT_SECRET"]= $secret;
    $GLOBALS["__body"] = is_string($body) ? $body : json_encode($body);
    try { handleAiAgentCallback($db); }
    catch(ApiDone $d){ return array("ok"=>true,"data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false,"code"=>$e->getCode(),"data"=>$e->payload); }
}

# 1) Async submit: агент отвечает 202 {status:queued}.
$GLOBALS["__ret"] = json_encode(array("job_id"=>"agent-1","status"=>"queued"));
$r = submit("долгий запрос");
expect($r["ok"] && isset($r["data"]["job"]), "async submit returns a job");
$job = $r["data"]["job"];
$jobId = $job["id"];
expect($job["status"] === "processing", "async job stays in processing (ждём callback)");
expect(!isset($job["result"]) || $job["result"]===null, "no result yet on processing job");

# Запрос к агенту содержит callback-поля.
$cap = $GLOBALS["__capture"];
expect($cap["job_id"] === $jobId, "agent request carries our job_id");
expect($cap["callback_url"] === "https://crm.example/".$db."/ai/agent/callback", "agent request carries callback_url");
expect(isset($cap["callback_secret"]) && strlen($cap["callback_secret"]) >= 16, "agent request carries callback_secret");

# agentJobId сохранён во внутренней задаче, в публичном виде не светится.
$internal = aiAgentJobGet($db, $jobId);
expect($internal["agentJobId"] === "agent-1", "agent job_id stored internally");
$secret = $internal["callbackSecret"];
expect(!isset($job["callbackSecret"]), "callbackSecret NOT exposed in public job");

# 2) Защита callback.
$r = callback(array("job_id"=>$jobId,"status"=>"done","content"=>"x"), "wrong-secret");
expect(!$r["ok"] && $r["code"]===403, "callback with wrong secret -> 403");
$r = callback(array("job_id"=>"deadbeef","status"=>"done","content"=>"x"), $secret);
expect(!$r["ok"] && $r["code"]===404, "callback for unknown job -> 404");
$r = callback(array("status"=>"done","content"=>"x"), $secret);
expect(!$r["ok"] && $r["code"]===400, "callback without job_id -> 400");
$r = callback(array("job_id"=>$jobId,"status"=>"done","content"=>"   "), $secret);
expect(!$r["ok"] && $r["code"]===400, "callback with empty content -> 400");

# 3) Успешный callback -> задача done с content.
$r = callback(array("job_id"=>$jobId,"status"=>"done","content"=>"итоговый ответ"), $secret);
expect($r["ok"] && $r["data"]["status"]==="done", "valid callback acknowledged");
$r = status($jobId);
expect($r["ok"] && $r["data"]["job"]["status"]==="done", "job is done after callback");
expect($r["data"]["job"]["result"]["assistant"]["content"]==="итоговый ответ", "callback content delivered to client");

# Идемпотентность: повторный callback не ломает завершённую задачу.
$r = callback(array("job_id"=>$jobId,"status"=>"done","content"=>"другое"), $secret);
expect($r["ok"], "duplicate callback acknowledged (idempotent)");
$r = status($jobId);
expect($r["data"]["job"]["result"]["assistant"]["content"]==="итоговый ответ", "duplicate callback does not overwrite result");

# 4) Callback с ошибкой.
$GLOBALS["__ret"] = json_encode(array("job_id"=>"agent-2","status"=>"queued"));
$r = submit("второй");
$jobId2 = $r["data"]["job"]["id"];
$secret2 = aiAgentJobGet($db, $jobId2)["callbackSecret"];
$r = callback(array("job_id"=>$jobId2,"status"=>"error","error"=>"агент не смог"), $secret2);
expect($r["ok"] && $r["data"]["status"]==="error", "error callback acknowledged");
$r = status($jobId2);
expect($r["data"]["job"]["status"]==="error", "job marked error after error callback");

# 5) Синхронный ответ агента ({content}) -> сразу done, без callback.
$GLOBALS["__ret"] = json_encode(array("content"=>"быстрый ответ"));
$r = submit("быстрый");
expect($r["ok"] && $r["data"]["job"]["status"]==="done", "sync agent answer -> job done immediately");
expect($r["data"]["job"]["result"]["assistant"]["content"]==="быстрый ответ", "sync content delivered");

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
