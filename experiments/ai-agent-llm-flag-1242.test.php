<?php
# python2node#1242 (crm#5498): CRM сообщает агенту, что в «Настройке» базы задана своя модель
# (llm_configured), — агент читает 269 правами пользователя и без доступа её не увидит.
# Настоящие callIntegramAgent / aiAgentSettingsFromRows; стабы — сеть и чтение строк 269.
#   1) задан адрес своей модели — флаг есть, ключа в запросе нет;
#   2) строк нет / только ключ без адреса — флага нет.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s',$v,$m) ? $m[1] : $v; }
function aiConfigValue($names){ return in_array("INTEGRAM_AGENT_ENDPOINT", $names) ? "https://agent.example/agent" : ""; }
function validateAiProviderEndpoint($e){}
function aiChatPostJson($endpoint, $request, $headers, $timeout=60){
    $GLOBALS["__capture"] = $request;
    return '{"status":"queued","job_id":"j1"}';
}
function aiAgentSettingRows(){ return $GLOBALS["__rows"]; }
function Exec_sql($sql, $msg){ throw new Exception("SQL не ожидался: ".$msg); }

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
foreach(array("callIntegramAgent","aiAgentSettingKeys","aiAgentSettingsFromRows","extractAiProviderContent") as $fn)
    eval(extract_function_source($source, $fn));
$GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "token" => "tok_user");

function call(){
    $GLOBALS["__capture"] = null;
    callIntegramAgent("db1242", "вопрос", array(), array("status"=>"active","paidUntil"=>0), "j1",
        "https://crm.example/db1242/ai/agent/callback", "sec", array(), array());
    return $GLOBALS["__capture"];
}

$GLOBALS["__rows"] = array(
    array("id"=>"1", "val"=>"https://polza.ai/api/v1", "k"=>"AI_LLM_URL"),
    array("id"=>"2", "val"=>"pz-SECRET-1", "k"=>"AI_LLM_TOKEN"));
$req = call();
expect(isset($req["llm_configured"]) && $req["llm_configured"] === true, "адрес своей модели задан — флаг llm_configured");
expect(strpos(json_encode($req), "SECRET") === false, "ключ своей модели в запрос агенту не уходит");

$GLOBALS["__rows"] = array(array("id"=>"2", "val"=>"pz-SECRET-1", "k"=>"AI_LLM_TOKEN"));
expect(!isset(call()["llm_configured"]), "ключ без адреса — флага нет");
$GLOBALS["__rows"] = array();
expect(!isset(call()["llm_configured"]), "своя модель не задана — флага нет");

echo $failures ? "\n$failures FAILED\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
