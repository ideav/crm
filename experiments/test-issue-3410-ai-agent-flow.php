<?php
# Regression test for issue #3410 (HTTP-контракт маршрута /{db}/ai/agent)
# https://github.com/ideav/crm/issues/3410
#
# Проверяем проводку диспетчера и job-модель целиком, со стаб-заглушками внешних
# зависимостей (XSRF, оплата, вызов агента):
#   • POST владельцем -> создаётся job, ответ {job:{status:done,result:...}};
#   • GET ?job=ID и GET ?latest возвращают ту же задачу;
#   • не-владелец -> 403; нет оплаты -> 402; пустой запрос -> 400;
#   • сбой агента -> 502, а задача сохраняется со статусом error.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

define("AI_AGENT_JOBS_MAX", 20);
define("AI_AGENT_JOBS_TTL", 24 * 3600);

# --- Заглушки внешних зависимостей index.php ---
class ApiDone extends Exception { public $json; function __construct($json){ $this->json=$json; parent::__construct("done"); } }
class ApiErr extends Exception { public $payload; function __construct($code,$payload){ $this->payload=$payload; parent::__construct("err",$code); } }

function api_dump($json, $name="api.json"){ throw new ApiDone($json); }
function aiAgentError($message, $code=400, $extra=array()){
    throw new ApiErr($code, array_merge(array("error"=>$message), is_array($extra)?$extra:array()));
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s',$v,$m) ? $m[1] : $v; }
function check(){ /* XSRF — noop в тесте */ }

# Управляемые из тестов заглушки оплаты и вызова агента.
$GLOBALS["__pay_ok"] = true;
$GLOBALS["__agent_throw"] = false;
function checkAiAgentPayment($db){
    if(empty($GLOBALS["__pay_ok"]))
        return array("ok"=>false,"status"=>"not_paid","message"=>"нужна оплата","payUrl"=>"https://pay");
    return array("ok"=>true,"status"=>"active","paidUntil"=>time()+1000,"payUrl"=>"https://pay");
}
function callIntegramAgent($db,$message,$attachments,$payment){
    if(!empty($GLOBALS["__agent_throw"]))
        throw new Exception("агент упал", 502);
    return array("assistant"=>array("content"=>"ОТВЕТ"),"status"=>"pending_api","payment"=>array("status"=>$payment["status"]));
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("Function not found: ".$name);
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
    "handleAiAgentRequest","aiAgentRequireOwner","aiAgentSubmitRequest","aiAgentStatusRequest",
    "collectAiAgentAttachments",
    "aiAgentJobsFile","aiAgentJobId","aiAgentJobNew","aiAgentJobsAppend","aiAgentJobsFind",
    "aiAgentJobsLatest","aiAgentJobsPrune","aiAgentJobsApplyChanges","aiAgentJobsReplace",
    "aiAgentJobPublic","aiAgentJobsEncode","aiAgentJobsDecode","aiAgentJobsLoadRaw",
    "aiAgentJobsMutate","aiAgentJobCreate","aiAgentJobUpdate","aiAgentJobGet","aiAgentJobLatest"
);
foreach($fns as $fn) eval(extract_function_source($source, $fn));

# Окружение «владельца базы».
$db = "flow3410_".getmypid();
$GLOBALS["z"] = $db;
$GLOBALS["GLOBAL_VARS"] = array("user"=>$db);
@unlink(aiAgentJobsFile($db));

function run($method, $get=array(), $post=array()){
    $_SERVER["REQUEST_METHOD"] = $method;
    $_GET = $get; $_POST = $post; $_FILES = array();
    try { handleAiAgentRequest(array()); }
    catch(ApiDone $d){ return array("ok"=>true, "data"=>json_decode($d->json,true)); }
    catch(ApiErr $e){ return array("ok"=>false, "code"=>$e->getCode(), "data"=>$e->payload); }
    return array("ok"=>false, "code"=>0, "data"=>null);
}

# 1) POST владельцем -> job done с результатом.
$r = run("POST", array(), array("message"=>"посчитай заказы"));
expect($r["ok"] && isset($r["data"]["job"]), "POST owner returns a job");
$job = $r["data"]["job"];
expect($job["status"] === "done", "submitted job resolves to done (instant stub)");
expect($job["result"]["assistant"]["content"] === "ОТВЕТ", "job result carries the agent answer");
expect($job["message"] === "посчитай заказы", "job keeps the user message");
$jobId = $job["id"];

# 2) GET ?job=ID -> та же задача.
$r = run("GET", array("job"=>$jobId));
expect($r["ok"] && $r["data"]["job"]["id"] === $jobId, "GET ?job returns the same job by id");
expect($r["data"]["job"]["status"] === "done", "GET ?job shows done status");

# 3) GET latest -> последняя задача.
$r = run("GET", array());
expect($r["ok"] && $r["data"]["job"]["id"] === $jobId, "GET latest returns the most recent job");

# 4) Не-владелец -> 403.
$GLOBALS["GLOBAL_VARS"]["user"] = "someoneelse";
$r = run("POST", array(), array("message"=>"hi"));
expect(!$r["ok"] && $r["code"] === 403, "non-owner POST is rejected with 403");
$r = run("GET", array());
expect(!$r["ok"] && $r["code"] === 403, "non-owner GET is rejected with 403");
$GLOBALS["GLOBAL_VARS"]["user"] = $db;

# 5) Нет оплаты -> 402 + payUrl.
$GLOBALS["__pay_ok"] = false;
$r = run("POST", array(), array("message"=>"hi"));
expect(!$r["ok"] && $r["code"] === 402, "unpaid POST is rejected with 402");
expect(isset($r["data"]["payUrl"]) && $r["data"]["payUrl"] === "https://pay", "402 includes a payment link");
$GLOBALS["__pay_ok"] = true;

# 6) Пустой запрос -> 400.
$r = run("POST", array(), array("message"=>"   "));
expect(!$r["ok"] && $r["code"] === 400, "empty message is rejected with 400");

# 7) Сбой агента -> 502, задача сохранена как error.
$GLOBALS["__agent_throw"] = true;
$r = run("POST", array(), array("message"=>"ломай"));
expect(!$r["ok"] && $r["code"] === 502, "agent failure surfaces as 502");
expect(isset($r["data"]["jobId"]), "502 response carries the jobId for polling");
$failedId = isset($r["data"]["jobId"]) ? $r["data"]["jobId"] : "";
$GLOBALS["__agent_throw"] = false;
$r = run("GET", array("job"=>$failedId));
expect($r["ok"] && $r["data"]["job"]["status"] === "error", "failed job is stored with status error");

# 8) GET несуществующей задачи -> 404.
$r = run("GET", array("job"=>"deadbeef"));
expect(!$r["ok"] && $r["code"] === 404, "GET of unknown job id -> 404");

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
