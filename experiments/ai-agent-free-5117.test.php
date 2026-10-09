<?php
# Issue #5117: ИИ-агент открыт всем без оплаты, пока не включено требование оплаты.
# https://github.com/ideav/crm/issues/5117
#
# checkAiAgentPayment():
#  1) без AI_AGENT_PAYMENT_REQUIRED — ok/free для любой базы, оплату не запрашивает;
#  2) AI_AGENT_PAYMENT_REQUIRED=1 — прежняя проверка: нет оплаты -> not_paid, оплата -> active.

$failures = 0;
function check($cond, $name){
    global $failures;
    echo ($cond ? "PASS: " : "FAIL: ").$name."\n";
    if(!$cond)
        $failures++;
}
function t9n($value){
    if(preg_match('/^\[RU\](.*?)\[EN\]/s', $value, $m))
        return $m[1];
    return $value;
}
$GLOBALS["__config"] = array();
function aiConfigValue($names){
    foreach($names as $name)
        if(isset($GLOBALS["__config"][$name]) && trim((string)$GLOBALS["__config"][$name]) !== "")
            return trim((string)$GLOBALS["__config"][$name]);
    return "";
}
# Источник оплаты подменён: считаем обращения и отдаём заданную строку.
$GLOBALS["__fetches"] = 0;
$GLOBALS["__report"] = "[]";
function fetchAiAgentPaymentReport($db){
    $GLOBALS["__fetches"]++;
    return $GLOBALS["__report"];
}
function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false)
        throw new Exception("Function not found: ".$name);
    $depth = 0;
    for($i = strpos($source, "{", $start); $i < strlen($source); $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}" && --$depth === 0)
            return substr($source, $start, $i - $start + 1);
    }
    throw new Exception("Function body is not closed: ".$name);
}
$source = file_get_contents(__DIR__."/../index.php");
foreach(array("checkAiAgentPayment", "evaluateAiAgentPayment") as $fn)
    eval(extract_function_source($source, $fn));

$db = "e2e5117test".getmypid();
@unlink(sys_get_temp_dir()."/ai_agent_pay_".$db.".json");

# 1) Требование оплаты не включено — доступ открыт, источник оплаты не опрашивается.
$GLOBALS["__config"] = array();
$res = checkAiAgentPayment($db);
check(!empty($res["ok"]), "без оплаты и без флага — доступ открыт");
check($res["status"] === "free", "статус free");
check($GLOBALS["__fetches"] === 0, "оплата не запрашивается");

# 2) Требование оплаты включено — прежнее поведение.
$GLOBALS["__config"] = array("AI_AGENT_PAYMENT_REQUIRED" => "1");
$res = checkAiAgentPayment($db);
check(empty($res["ok"]) && $res["status"] === "not_paid", "флаг 1, оплаты нет -> not_paid");
@unlink(sys_get_temp_dir()."/ai_agent_pay_".$db.".json");
$GLOBALS["__report"] = json_encode(array(array("Paid" => (string)(time() - 3600), "Payment" => "5950")));
$res = checkAiAgentPayment($db);
check(!empty($res["ok"]) && $res["status"] === "active", "флаг 1, оплата есть -> active");
@unlink(sys_get_temp_dir()."/ai_agent_pay_".$db.".json");

echo "\n";
if($failures){
    echo "FAILED: $failures check(s) failed\n";
    exit(1);
}
echo "ALL TESTS PASSED\n";
