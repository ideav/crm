<?php
# Мерка к issue #839: ИИ-агент работает под токеном текущего пользователя.
# https://github.com/ideav/python2node/issues/839
#
# Запуск: php experiments/ai-agent-user-rights-839.test.php (в гейте — через одноимённый .test.js)
#
# Проводка /{db}/ai/agent берётся из index.php как есть, стабами заменены только XSRF, оплата
# и сеть. Проверяется:
#   1) чат открыт ЛЮБОМУ вошедшему пользователю базы, а не только тому, чьё имя = имя базы;
#   2) агенту уходит токен этого пользователя — права наследуются от него, а не от admin;
#   3) не вошедший и guest получают 403;
#   4) единственное оставшееся ограничение — оплата: без неё 402 и для владельца, и для прочих;
#   5) ответ, собранный с правами одного пользователя, другому не виден (ни по id, ни «последний»).

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

$db = "acme839_".getmypid();
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

# 1–2) Обычный пользователь базы (имя ≠ имя базы) — чат работает, агенту уходит ЕГО токен.
as_user("petrov", "tok-petrov");
$r = run("POST", array(), array("message"=>"сколько у меня сделок?"));
expect($r["ok"], "#839: пользователь petrov в базе $db ставит задачу агенту (не 403)");
$petrovJob = $r["ok"] ? $r["data"]["job"]["id"] : "";
$cap = $GLOBALS["__capture"];
expect(is_array($cap) && isset($cap["token"]) && $cap["token"] === "tok-petrov",
    "#839: агенту передан токен petrov — агент работает с его правами");
expect(is_array($cap) && $cap["user"] === "petrov", "#839: агенту передано имя petrov");
expect(is_array($cap) && $cap["db"] === $db, "#839: агенту передана текущая база");

# Владелец базы по-прежнему работает — и тоже своим токеном.
as_user($db, "tok-owner");
$r = run("POST", array(), array("message"=>"привет"));
expect($r["ok"], "#839: владелец базы ставит задачу");
$ownerJob = $r["ok"] ? $r["data"]["job"]["id"] : "";
$cap = $GLOBALS["__capture"];
expect(is_array($cap) && isset($cap["token"]) && $cap["token"] === "tok-owner", "#839: владельцу — его собственный токен");

# 3) Не вошедший и guest — отказ, агент не вызывается.
foreach(array("" => "не вошедший", "guest" => "guest") as $u => $label){
    as_user($u, "gtuoeksetn");
    $r = run("POST", array(), array("message"=>"hi"));
    expect(!$r["ok"] && $r["code"] === 403, "#839: $label → 403 на POST");
    expect($GLOBALS["__capture"] === null, "#839: $label → агент не вызывается");
    $r = run("GET", array());
    expect(!$r["ok"] && $r["code"] === 403, "#839: $label → 403 на GET");
}

# 4) Оплата — единственное ограничение: без неё 402 любому пользователю.
$GLOBALS["__pay_ok"] = false;
foreach(array("petrov", $db) as $u){
    as_user($u, "tok-$u");
    $r = run("POST", array(), array("message"=>"hi"));
    expect(!$r["ok"] && $r["code"] === 402, "#839: без оплаты $u → 402");
    expect(isset($r["data"]["payUrl"]), "#839: в отказе по оплате для $u есть ссылка на оплату");
}
$GLOBALS["__pay_ok"] = true;

# 5) Ответ, собранный с правами одного, другому не виден.
as_user("petrov", "tok-petrov");
$r = run("GET", array("job"=>$petrovJob));
expect($r["ok"] && $r["data"]["job"]["id"] === $petrovJob, "#839: petrov видит свою задачу по id");
$r = run("GET", array());
expect($r["ok"] && $r["data"]["job"] && $r["data"]["job"]["id"] === $petrovJob,
    "#839: «последняя задача» для petrov — его, а не более поздняя задача владельца");
$r = run("GET", array("job"=>$ownerJob));
expect(!$r["ok"] && $r["code"] === 404, "#839: задача владельца для petrov — 404");

as_user("sidorov", "tok-sidorov");
$r = run("GET", array());
expect($r["ok"] && $r["data"]["job"] === null, "#839: у sidorov своих задач нет — «последняя» пуста");
$r = run("GET", array("job"=>$petrovJob));
expect(!$r["ok"] && $r["code"] === 404, "#839: задача petrov для sidorov — 404");

as_user(strtoupper("petrov"), "tok-petrov");
$r = run("GET", array("job"=>$petrovJob));
expect($r["ok"], "#839: имя пользователя сравнивается без учёта регистра");

@unlink(aiAgentJobsFile($db));

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
