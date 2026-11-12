<?php
# crm#5498: GET /{db}/ai/agent/settings — окно шестерёнки ИИ-чата. Настоящие
# handleAiAgentRequest / aiAgentSettingsRequest; стабы — чтение строк «Настройки» и доступ роли к
# таблице (Grant_1level ядра: admin — WRITE, иначе явный грант на таблицу).
#   1) ключ прокси во фронт не уходит: только hasToken и id строк;
#   2) режим custom — только когда заданы и адрес, и ключ;
#   3) права — по доступу роли к таблице 269: нет доступа — ни значений, ни id;
#      READ — значения без права правки; WRITE и admin — canEdit;
#   4) гость — отказ 403.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
class ApiDone extends Exception { public $json; function __construct($json){ $this->json=$json; parent::__construct("done"); } }
class ApiErr extends Exception { public $payload; function __construct($code,$payload){ $this->payload=$payload; parent::__construct("err",$code); } }
function api_dump($json, $name="api.json"){ throw new ApiDone($json); }
function aiAgentError($message, $code=400, $extra=array()){ throw new ApiErr($code, array("error"=>$message)); }
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s',$v,$m) ? $m[1] : $v; }
function Exec_sql($sql, $msg){ throw new Exception("SQL не ожидался: ".$msg); }
function aiAgentSettingRows(){ return $GLOBALS["__rows"]; }
function Grant_1level($id){
    if($GLOBALS["GLOBAL_VARS"]["user"] == "admin") return "WRITE";
    return isset($GLOBALS["GRANTS"][$id]) ? $GLOBALS["GRANTS"][$id] : FALSE;
}

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
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
foreach(array("handleAiAgentRequest","aiAgentCurrentUser","aiAgentRequireUser","aiAgentSettingKeys",
               "aiAgentSettingsFromRows","aiAgentSettingsRequest") as $fn)
    eval(extract_function_source($source, $fn));
$GLOBALS["z"] = "db5498";

function settings($user, $grants){
    $GLOBALS["GLOBAL_VARS"] = array("user" => $user);
    $GLOBALS["GRANTS"] = $grants;
    $_SERVER["REQUEST_METHOD"] = "GET"; $_GET = array(); $_POST = array();
    try { handleAiAgentRequest(array("", "db5498", "ai", "agent", "settings")); }
    catch(ApiDone $d){ return array("ok"=>true, "raw"=>$d->json, "data"=>json_decode($d->json, true)); }
    catch(ApiErr $e){ return array("ok"=>false, "code"=>$e->getCode()); }
    return array("ok"=>false, "code"=>0);
}

$GLOBALS["__rows"] = array(
    array("id"=>"501", "val"=>"https://openrouter.ai/api/v1", "k"=>"AI_LLM_URL"),
    array("id"=>"502", "val"=>"sk-or-SECRET-777", "k"=>"AI_LLM_TOKEN"),
    array("id"=>"503", "val"=>"openai/gpt-4o-mini", "k"=>"AI_LLM_MODEL"),
    array("id"=>"504", "val"=>"openrouter", "k"=>"AI_LLM_PROVIDER"),
    array("id"=>"505", "val"=>"https://github.com/x/y", "k"=>"GIT"),
);

$r = settings("petrov", array(269 => "WRITE"));
expect($r["ok"], "WRITE: ответ есть");
expect(strpos($r["raw"], "SECRET") === false, "ключ прокси не уходит во фронт");
expect($r["data"]["hasToken"] === true, "hasToken = true");
expect($r["data"]["mode"] === "custom", "адрес + ключ = свой прокси");
expect($r["data"]["url"] === "https://openrouter.ai/api/v1" && $r["data"]["model"] === "openai/gpt-4o-mini"
    && $r["data"]["provider"] === "openrouter", "адрес, модель, прокси — как в «Настройке»");
expect($r["data"]["ids"] == array("AI_LLM_URL"=>"501","AI_LLM_TOKEN"=>"502","AI_LLM_MODEL"=>"503","AI_LLM_PROVIDER"=>"504"),
    "id строк AI_LLM_* для правки, чужие строки не попадают");
expect($r["data"]["canEdit"] === true && $r["data"]["canRead"] === true, "WRITE: можно править");

$r = settings("ivanov", array(269 => "READ"));
expect($r["data"]["canRead"] === true && $r["data"]["canEdit"] === false, "READ: видно, править нельзя");

$r = settings("sidorov", array(270 => "WRITE"));
expect($r["data"]["canRead"] === false && $r["data"]["canEdit"] === false, "нет доступа к 269: ни читать, ни править");
expect(!isset($r["data"]["url"]) && !isset($r["data"]["ids"]), "нет доступа к 269: ни значений, ни id");

$r = settings("admin", array());
expect($r["data"]["canEdit"] === true, "admin правит всегда");

$GLOBALS["__rows"] = array(array("id"=>"501", "val"=>"https://x.example/v1", "k"=>"AI_LLM_URL"));
$r = settings("petrov", array(269 => "WRITE"));
expect($r["data"]["mode"] === "ours" && $r["data"]["hasToken"] === false, "адрес без ключа = наш агент");
$GLOBALS["__rows"] = array();
$r = settings("petrov", array(269 => "WRITE"));
expect($r["data"]["mode"] === "ours" && $r["data"]["url"] === "", "строк нет = наш агент");

$r = settings("guest", array(269 => "WRITE"));
expect(!$r["ok"] && $r["code"] === 403, "гость: 403");

echo $failures ? "\n$failures FAILED\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
