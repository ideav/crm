<?php
# Мерка к python2node#846: план до записи, подтверждение и отмена действий ИИ-агента.
# https://github.com/ideav/python2node/issues/846
#
# Запуск: php experiments/ai-agent-plan-846.test.php (в гейте — через одноимённый .test.js)
#
# Проводка /{db}/ai/agent и callback берутся из index.php как есть, стабами заменены только
# XSRF, оплата и сеть. Проверяется:
#   1) кнопка «Применить» / «Отменить» уходит агенту действием (action + plan_id) того же
#      пользователя и его токеном, а в ленте — как реплика пользователя;
#   2) неизвестное действие и действие без плана — 400, агент не вызывается;
#   3) «Отменить» доступна и без оплаты (вернуть базу как была), «Применить» — только с оплатой;
#   4) план из callback агента доходит до клиента в задаче (result.plan), без лишних полей;
#   5) ответ на действие обновляет план и в исходной задаче — старые кнопки гаснут.

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

$db = "acme846_".getmypid();
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

# Обычный вопрос: агент отвечает планом (callback с полем plan).
$r = run("POST", array(), array("message"=>"закрой все сделки Петрова"));
$askJob = $r["ok"] ? $r["data"]["job"]["id"] : "";
expect($askJob !== "", "#846: вопрос агенту принят");
expect(is_array($GLOBALS["__capture"]) && !isset($GLOBALS["__capture"]["action"]),
    "#846: обычный вопрос уходит агенту без action");
$plan = array("id"=>$askJob, "status"=>"pending", "summary"=>array("Изменю 3 записи таблицы «Сделка»: Статус → «Закрыта»"),
              "undo"=>false, "expires_at"=>time()+86400, "ops"=>array(array("kind"=>"set")), "secret"=>"x");
$c = callback($db, $askJob, array("status"=>"done", "content"=>"Закрою 3 сделки. ПЛАН — база пока не изменена", "plan"=>$plan));
expect($c["ok"], "#846: callback с планом принят");
$r = run("GET", array("job"=>$askJob));
$pub = $r["ok"] ? $r["data"]["job"]["result"]["plan"] : null;
expect(is_array($pub) && $pub["id"] === $askJob && $pub["status"] === "pending",
    "#846: план доходит до клиента в result.plan со статусом pending");
expect(is_array($pub) && $pub["summary"] === $plan["summary"], "#846: описание плана доходит до клиента");
expect(is_array($pub) && !isset($pub["ops"]) && !isset($pub["secret"]), "#846: в клиент уходят только поля плана для кнопок");

# 1) «Применить» — действие тем же токеном, реплика пользователя — подпись кнопки.
$r = run("POST", array(), array("action"=>"apply", "plan"=>$askJob));
expect($r["ok"], "#846: «Применить» принят");
$applyJob = $r["ok"] ? $r["data"]["job"]["id"] : "";
$cap = $GLOBALS["__capture"];
expect(is_array($cap) && $cap["action"] === "apply" && $cap["plan_id"] === $askJob,
    "#846: агенту уходит action=apply и plan_id исходного плана");
expect(is_array($cap) && $cap["token"] === "tok-petrov" && $cap["user"] === "petrov",
    "#846: действие идёт токеном и от имени того же пользователя");
expect($r["ok"] && $r["data"]["job"]["message"] === "Применить план", "#846: в ленте — «Применить план»");

# 5) Ответ на «Применить» обновляет план в исходной задаче.
$applied = array("id"=>$askJob, "status"=>"applied", "summary"=>$plan["summary"], "undo"=>true, "undo_until"=>time()+86400);
callback($db, $applyJob, array("status"=>"done", "content"=>"Готово: выполнено команд — 3.", "plan"=>$applied));
$r = run("GET", array("job"=>$applyJob));
expect($r["ok"] && $r["data"]["job"]["result"]["plan"]["status"] === "applied" && $r["data"]["job"]["result"]["plan"]["undo"] === true,
    "#846: ответ на «Применить» несёт план applied с отменой");
$r = run("GET", array("job"=>$askJob));
expect($r["ok"] && $r["data"]["job"]["result"]["plan"]["status"] === "applied",
    "#846: в исходной задаче план тоже стал applied — кнопки «Применить» больше нет");
expect($r["ok"] && strpos($r["data"]["job"]["result"]["assistant"]["content"], "ПЛАН") !== false,
    "#846: текст исходного ответа не тронут");

# 3) «Отменить» без оплаты работает, «Применить» без оплаты — 402.
$GLOBALS["__pay_ok"] = false;
$r = run("POST", array(), array("action"=>"undo", "plan"=>$askJob));
expect($r["ok"] && $GLOBALS["__capture"]["action"] === "undo", "#846: «Отменить» без оплаты уходит агенту");
$r = run("POST", array(), array("action"=>"cancel", "plan"=>$askJob));
expect($r["ok"] && $GLOBALS["__capture"]["action"] === "cancel", "#846: отказ от плана без оплаты уходит агенту");
$r = run("POST", array(), array("action"=>"apply", "plan"=>$askJob));
expect(!$r["ok"] && $r["code"] === 402, "#846: «Применить» без оплаты — 402");
$GLOBALS["__pay_ok"] = true;

# 2) Мусор — 400, агент не вызывается.
foreach(array(array("action"=>"drop", "plan"=>$askJob), array("action"=>"apply", "plan"=>""),
              array("action"=>"apply", "plan"=>"../../x"), array("action"=>"undo")) as $bad){
    $r = run("POST", array(), $bad);
    expect(!$r["ok"] && $r["code"] === 400 && $GLOBALS["__capture"] === null,
        "#846: 400 и без вызова агента на ".json_encode($bad));
}

# Чужой план не трогается: callback с планом, id которого — задача другого пользователя.
as_user("sidorov", "tok-sidorov");
$r = run("POST", array(), array("message"=>"привет"));
$sidJob = $r["data"]["job"]["id"];
callback($db, $sidJob, array("status"=>"done", "content"=>"ok", "plan"=>array("id"=>$askJob, "status"=>"cancelled", "summary"=>array())));
as_user("petrov", "tok-petrov");
$r = run("GET", array("job"=>$askJob));
expect($r["ok"] && $r["data"]["job"]["result"]["plan"]["status"] === "applied",
    "#846: ответ задачи sidorov не меняет план задачи petrov");

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
