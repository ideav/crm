<?php
# python2node#849: callback ИИ-агента с ходом работы (status=progress) и структурным
# ответом (blocks). Харнесс — как в test-ai-agent-callback.php: настоящие
# handleAiAgentRequest / handleAiAgentCallback, стаб только сетевого слоя.
#   1) progress: задача остаётся processing, клиент видит последнюю строку хода;
#   2) progress после ответа ничего не меняет, а сам ответ не теряет blocks;
#   3) blocks: в задачу попадают только известные типы, разметка не трогается (её
#      экранирует клиент), ответ без blocks — как раньше;
#   4) защита progress та же, что у ответа: секрет задачи.

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
    "handleAiAgentRequest","aiAgentCurrentUser","aiAgentRequireUser","aiAgentJobIsOf",
    "aiAgentSubmitRequest","aiAgentStatusRequest",
    "handleAiAgentCallback","aiAgentCallbackUrl","collectAiAgentAttachments","aiAgentBlocksClean","aiAgentProgressClean",
    "aiAgentJobsFile","aiAgentJobId","aiAgentJobNew","aiAgentJobsAppend","aiAgentJobsFind",
    "aiAgentJobsLatest","aiAgentJobsPrune","aiAgentJobsApplyChanges","aiAgentJobsReplace",
    "aiAgentJobPublic","aiAgentJobsEncode","aiAgentJobsDecode","aiAgentJobsLoadRaw",
    "aiAgentJobsMutate","aiAgentJobCreate","aiAgentJobUpdate","aiAgentJobGet","aiAgentJobLatest"
);
foreach($fns as $fn) eval(extract_function_source($source, $fn));

$db = "bl".getmypid();
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

function public_job($id){ $r = status($id); return $r["data"]["job"]; }
function async_job($agentId){
    global $db;
    $GLOBALS["__ret"] = json_encode(array("job_id"=>$agentId,"status"=>"queued"));
    $r = submit("Покажи сделки Петрова");
    $id = $r["data"]["job"]["id"];
    return array($id, aiAgentJobGet($db, $id)["callbackSecret"]);
}

# 1) Ход работы.
list($jobId, $secret) = async_job("agent-p");
$r = callback(array("job_id"=>$jobId,"status"=>"progress","progress"=>"Читаю таблицу Сделки…"), $secret);
expect($r["ok"] && $r["data"]["status"]==="processing", "progress принят, задача в работе");
$job = public_job($jobId);
expect($job["status"]==="processing", "после progress задача остаётся processing");
expect(isset($job["progress"]) && $job["progress"]==="Читаю таблицу Сделки…", "клиент видит строку хода работы");
callback(array("job_id"=>$jobId,"status"=>"progress","progress"=>"Нашёл 37 сделок\x07\n, считаю…"), $secret);
$job = public_job($jobId);
expect($job["progress"]==="Нашёл 37 сделок , считаю…", "видна последняя строка, без управляющих символов (".$job["progress"].")");
callback(array("job_id"=>$jobId,"status"=>"progress","progress"=>str_repeat("я", 1000)), $secret);
expect(mb_strlen(public_job($jobId)["progress"], "UTF-8") <= 300, "строка хода обрезана");
$r = callback(array("job_id"=>$jobId,"status"=>"progress","progress"=>"x"), "wrong");
expect(!$r["ok"] && $r["code"]===403, "progress с чужим секретом — 403");
$r = callback(array("job_id"=>$jobId,"status"=>"progress","progress"=>"  "), $secret);
expect($r["ok"] && public_job($jobId)["status"]==="processing", "пустой progress не роняет задачу");

# 2) Ответ с blocks.
$blocks = array(
    array("type"=>"text","text"=>"Нашёл 3 сделки"),
    array("type"=>"table","columns"=>array("Сделка"),"rows"=>array(array("<b>Поставка</b>")),"more"=>"object/310/?F_U=1"),
    array("type"=>"records","items"=>array(array("t"=>310,"id"=>5001,"label"=>"Поставка"))),
    array("type"=>"actions","items"=>array(array("label"=>"Закрыть","message"=>"Закрой"))),
    array("type"=>"html","html"=>"<script>alert(1)</script>"),
    "мусор"
);
$r = callback(array("job_id"=>$jobId,"status"=>"done","content"=>"Нашёл 3 сделки","blocks"=>$blocks), $secret);
expect($r["ok"] && $r["data"]["status"]==="done", "ответ с blocks принят");
$job = public_job($jobId);
expect($job["result"]["assistant"]["content"]==="Нашёл 3 сделки", "content на месте для старого клиента");
$types = array_map(function($b){ return $b["type"]; }, $job["result"]["assistant"]["blocks"]);
expect($types === array("text","table","records","actions"), "в задаче только известные типы блоков (".implode(",", $types).")");
expect($job["result"]["assistant"]["blocks"][1]["rows"][0][0]==="<b>Поставка</b>", "текст ячеек хранится как есть, экранирует клиент");
expect(!isset($job["progress"]) || $job["progress"]===null, "у готовой задачи хода работы нет");

# Поздний progress после ответа ничего не меняет.
$r = callback(array("job_id"=>$jobId,"status"=>"progress","progress"=>"поздно"), $secret);
$job = public_job($jobId);
expect($r["ok"] && $job["status"]==="done" && count($job["result"]["assistant"]["blocks"])===4, "поздний progress не трогает готовый ответ");

# 3) Ответ без blocks и с blocks не-массивом — как раньше.
list($jobId2, $secret2) = async_job("agent-q");
callback(array("job_id"=>$jobId2,"status"=>"done","content"=>"В базе 12 таблиц","blocks"=>"<script>"), $secret2);
$job = public_job($jobId2);
expect($job["result"]["assistant"]["content"]==="В базе 12 таблиц" && !isset($job["result"]["assistant"]["blocks"]), "без годных blocks ответ — только content");

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
