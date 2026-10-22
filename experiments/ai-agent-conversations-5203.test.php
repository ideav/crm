<?php
# Мерка к crm#5203: раздельные диалоги ИИ-чата.
# https://github.com/ideav/crm/issues/5203
#
# Запуск: php experiments/ai-agent-conversations-5203.test.php (в гейте — через одноимённый .test.js)
#
# Проводка /{db}/ai/agent и callback берутся из index.php как есть, стабами заменены только
# XSRF, оплата и сеть. Проверяется:
#   1) у каждого диалога своя лента: вопрос и ответ (callback) попадают в ленту своего диалога;
#   2) агенту уходит conversation_id диалога — у каждого диалога своя сессия агента;
#   3) список диалогов — свежие сверху, название по первому вопросу;
#   4) история переживает хранилище задач (TTL 24 ч во временном каталоге);
#   5) чужие диалоги не видны и не удаляются; удаление своего;
#   6) запрос без диалога (старый клиент) — как раньше: без conversation_id и без истории;
#   7) мусорный id диалога — 400, агент не вызывается;
#   8) диалога нет (новый чат без вопросов, удалённый, чужой; latest без диалогов) — 200 и
#      conversation: null, а не 404: это штатное состояние, ошибки нет (python2node#1059).

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
foreach(array("AI_AGENT_CHATS_MAX", "AI_AGENT_CHAT_TURNS_MAX", "AI_AGENT_CHAT_TITLE_LEN") as $const)
    if(!defined($const) && preg_match('/define\("'.$const.'",\s*(\d+)\)/', $source, $cm))
        define($const, (int)$cm[1]);
function aiAgentRawInput(){ return $GLOBALS["__raw"]; }

if(!function_exists("aiAgentChatsFile")){
    echo "FAIL: в index.php нет хранилища диалогов (aiAgentChatsFile)\n";
    exit(1);
}

$db = "acme5203_".getmypid();
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
function ask($conversation, $message){
    $r = run("POST", array(), array("message"=>$message, "conversation"=>$conversation));
    return $r["ok"] ? $r["data"]["job"]["id"] : "";
}
function turns($conversation){
    $r = run("GET", array("conversation"=>$conversation));
    if(!$r["ok"] || !is_array($r["data"]["conversation"])) return null;
    $out = array();
    foreach($r["data"]["conversation"]["turns"] as $t)
        $out[] = $t["message"]." => ".($t["status"] === "done" ? $t["result"]["assistant"]["content"] : $t["status"]);
    return $out;
}

$c1 = "aaaa1111aaaa1111aaaa1111aaaa1111";
$c2 = "bbbb2222bbbb2222bbbb2222bbbb2222";
as_user("petrov", "tok-petrov");
@unlink(aiAgentChatsFile($db, "petrov"));
@unlink(aiAgentChatsFile($db, "sidorov"));

# 1–2) два диалога, у каждого своя лента и своя сессия агента.
$j1 = ask($c1, "Сколько сделок у Петрова?");
expect($j1 !== "" && is_array($GLOBALS["__capture"]) && isset($GLOBALS["__capture"]["conversation_id"])
    && $GLOBALS["__capture"]["conversation_id"] === $c1, "#5203: агенту уходит conversation_id первого диалога");
callback($db, $j1, array("status"=>"done", "content"=>"12 сделок"));
$j2 = ask($c2, "Добавь таблицу Склад");
expect(is_array($GLOBALS["__capture"]) && isset($GLOBALS["__capture"]["conversation_id"]) && $GLOBALS["__capture"]["conversation_id"] === $c2,
    "#5203: второй диалог — свой conversation_id");
$j3 = ask($c1, "А закрытых?");
callback($db, $j3, array("status"=>"done", "content"=>"5 закрытых"));

expect(turns($c1) === array("Сколько сделок у Петрова? => 12 сделок", "А закрытых? => 5 закрытых"),
    "#5203: лента первого диалога — только его вопросы и ответы: ".json_encode(turns($c1), JSON_UNESCAPED_UNICODE));
expect(turns($c2) === array("Добавь таблицу Склад => processing"),
    "#5203: во втором диалоге — свой вопрос, ответ ещё в работе: ".json_encode(turns($c2), JSON_UNESCAPED_UNICODE));
callback($db, $j2, array("status"=>"done", "content"=>"Таблица создана"));
expect(turns($c2) === array("Добавь таблицу Склад => Таблица создана"), "#5203: ответ из callback дописан в ленту своего диалога");

# 3) список: свежие сверху (c1 — последний вопрос), название — по первому вопросу.
$r = run("GET", array("conversations"=>"1"));
$list = $r["ok"] ? $r["data"]["conversations"] : array();
expect(count($list) === 2 && $list[0]["id"] === $c1 && $list[1]["id"] === $c2, "#5203: в списке два диалога, последний активный — сверху");
expect(count($list) === 2 && $list[0]["title"] === "Сколько сделок у Петрова?" && !isset($list[0]["turns"][0]),
    "#5203: название — первый вопрос, ленты в списке нет");
$r = run("GET", array("conversation"=>"latest"));
expect($r["ok"] && $r["data"]["conversation"]["id"] === $c1, "#5203: conversation=latest — последний активный диалог");

# 4) хранилище задач очищено (истёк TTL) — история осталась.
@unlink(aiAgentJobsFile($db));
expect(turns($c1) === array("Сколько сделок у Петрова? => 12 сделок", "А закрытых? => 5 закрытых"),
    "#5203: история диалога переживает хранилище задач");

# 5) sidorov не видит и не удаляет диалоги petrov.
as_user("sidorov", "tok-sidorov");
$r = run("GET", array("conversations"=>"1"));
expect($r["ok"] && $r["data"]["conversations"] === array(), "#5203: у другого пользователя список пуст");
$r = run("GET", array("conversation"=>$c1));
expect($r["ok"] && $r["data"]["conversation"] === null, "#5203: чужой диалог по id не виден — пустой диалог");
run("POST", array(), array("action"=>"delete_conversation", "conversation"=>$c1));
as_user("petrov", "tok-petrov");
expect(turns($c1) !== null, "#5203: удаление чужим пользователем диалог не трогает");
$r = run("POST", array(), array("action"=>"delete_conversation", "conversation"=>$c1));
expect($r["ok"] && $r["data"]["deleted"] === true && $GLOBALS["__capture"] === null, "#5203: свой диалог удаляется, агент не вызывается");
$r = run("GET", array("conversation"=>$c1));
expect($r["ok"] && $r["data"]["conversation"] === null, "#5203: удалённый диалог — пустой диалог");
$r = run("GET", array("conversations"=>"1"));
expect($r["ok"] && count($r["data"]["conversations"]) === 1 && $r["data"]["conversations"][0]["id"] === $c2, "#5203: в списке остался второй диалог");

# 6) старый клиент без диалога — по-старому.
$r = run("POST", array(), array("message"=>"привет"));
expect($r["ok"] && is_array($GLOBALS["__capture"]) && !array_key_exists("conversation_id", $GLOBALS["__capture"]),
    "#5203: без диалога агенту не уходит conversation_id");
$r = run("GET", array("latest"=>"1"));
expect($r["ok"] && $r["data"]["job"]["message"] === "привет", "#5203: последняя задача без диалога видна по ?latest, как раньше");
$r = run("GET", array("conversations"=>"1"));
expect($r["ok"] && count($r["data"]["conversations"]) === 1, "#5203: вопрос без диалога в историю не пишется");

# 7) мусорный id — 400.
foreach(array("../../etc", "ZZZZ", "abc", str_repeat("a", 65)) as $bad){
    $r = run("POST", array(), array("message"=>"x", "conversation"=>$bad));
    expect(!$r["ok"] && $r["code"] === 400 && $GLOBALS["__capture"] === null, "#5203: 400 без вызова агента на id ".json_encode($bad));
}

# 8) python2node#1059: панель открывает новый чат (id выдал клиент, вопросов не было) —
# сервер отвечает пустым диалогом, а не 404 «Диалог не найден».
as_user("ivanov", "tok-ivanov");
$r = run("GET", array("conversation"=>"4d4ff184f0cca5efdeeca6bd8bbd1216"));
expect($r["ok"] && $r["code"] === 200 && array_key_exists("conversation", $r["data"]) && $r["data"]["conversation"] === null,
    "#1059: новый чат без вопросов — 200 и conversation: null");
$r = run("GET", array("conversation"=>"latest"));
expect($r["ok"] && $r["data"]["conversation"] === null, "#1059: latest без диалогов — 200 и conversation: null");
$r = run("GET", array("conversation"=>"ZZZZ"));
expect($r["ok"] && $r["data"]["conversation"] === null, "#1059: мусорный id в GET — пустой диалог, без ошибки");

@unlink(aiAgentJobsFile($db));
@unlink(aiAgentChatsFile($db, "petrov"));
@unlink(aiAgentChatsFile($db, "sidorov"));
@unlink(aiAgentChatsFile($db, "ivanov"));
@rmdir(dirname(aiAgentChatsFile($db, "petrov")));

echo "\n";
if($failures){ fwrite(STDERR, "FAILED: $failures check(s) failed\n"); exit(1); }
echo "ALL TESTS PASSED\n";
