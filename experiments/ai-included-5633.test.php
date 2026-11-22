<?php
# Issue #5633: ИИ, включённый в оплату базы: 10% суммы c2ai / цена единицы; ai_included для агента,
# пока счётчик базы меньше; 429 агента — чистый текст и код 429. Реальные функции из index.php.
$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $depth = 0; $len = strlen($source);
    for($i = strpos($source, "{", $start); $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}
$source = file_get_contents(__DIR__."/../index.php");
$code = "namespace inc5633;\n";
try {
    foreach(array("aiConfigValue", "billingAiUnitPrice", "evaluateAiAgentPayment", "aiAgentPaymentRaw", "aiAgentIncludedUnits",
        "billingAiUnitsUsed", "aiAgentIncluded", "extractAiProviderError", "aiProviderErrorMessage", "aiChatHttpError") as $fn)
        $code .= extract_function_source($source, $fn)."\n";
} catch(Exception $e){
    echo "FAIL: ".$e->getMessage()."\n";
    exit(1);
}
eval('namespace inc5633;
const DATABASE = 271;
function t9n($s){ return preg_replace("/^\[RU\](.*)\[EN\].*$/su", "$1", $s); }
function mysqli_real_escape_string($c, $s){ return addslashes($s); }
function mysqli_query($c, $sql){ $GLOBALS["__q"][] = $sql; return $GLOBALS["__res"]; }
function mysqli_fetch_assoc($r){ return $r === TRUE ? $GLOBALS["__row"] : NULL; }
function fetchAiAgentPaymentReport($db){ return false; }
class Exception extends \Exception {}
'.$code);
$GLOBALS["__q"] = array();
putenv("BILLING_AI_TOKENS_TYPE=239405");
putenv("AI_AGENT_PAYMENT_REQUIRED"); # как на проде: не задано
$tmp = sys_get_temp_dir();
function pay($amount, $db = "incdb"){
    $f = sys_get_temp_dir()."/ai_agent_pay_".$db.".json";
    if($amount === null){ @unlink($f); return; }
    file_put_contents($f, json_encode(array(array("Paid" => (string)time(), "Payment" => (string)$amount))));
}
function used($ord){ $GLOBALS["__res"] = TRUE; $GLOBALS["__row"] = $ord === null ? false : array("ord" => (string)$ord); }
$c = new stdClass();

pay(5950);
expect(\inc5633\aiAgentIncludedUnits("incdb") === 1652, "5950 ₽ -> floor(595/0.36) = 1652");
pay(12500);
expect(\inc5633\aiAgentIncludedUnits("incdb") === 3472, "12500 ₽ -> 3472");
pay(777);
expect(\inc5633\aiAgentIncludedUnits("incdb") === 0, "посторонняя сумма — не оплата, 0");
pay(null);
expect(\inc5633\aiAgentIncludedUnits("incdb") === 0, "нет оплаты — 0");
putenv("BILLING_AI_UNIT_PRICE=0.5"); pay(5950);
expect(\inc5633\aiAgentIncludedUnits("incdb") === 1190, "цена из BILLING_AI_UNIT_PRICE");
putenv("BILLING_AI_UNIT_PRICE");

pay(5950);
used(100);
expect(\inc5633\aiAgentIncluded($c, "incdb") === true, "расход 100 < 1652: ai_included");
expect(strpos(end($GLOBALS["__q"]), "c.t=239405") !== false && stripos(end($GLOBALS["__q"]), "SELECT") === 0, "читает счётчик SELECT-ом по типу");
used(1652);
expect(\inc5633\aiAgentIncluded($c, "incdb") === false, "расход = объёму: не включено");
used(null);
expect(\inc5633\aiAgentIncluded($c, "incdb") === true, "строки счётчика нет — расход 0");
$GLOBALS["__res"] = false;
expect(\inc5633\aiAgentIncluded($c, "incdb") === false, "ошибка SQL — не включено");
used(5);
putenv("BILLING_AI_TOKENS_TYPE");
expect(\inc5633\aiAgentIncluded($c, "incdb") === false, "тип счётчика не задан — не включено");
putenv("BILLING_AI_TOKENS_TYPE=239405");
pay(null);
expect(\inc5633\aiAgentIncluded($c, "incdb") === false, "нет оплаты — не включено");
pay(null);

$e = \inc5633\aiChatHttpError(429, '{"error":"Лимит: 3 запроса в час. Обновится в 14:05"}', "https://agent.test/x");
expect($e->getCode() === 429 && $e->getMessage() === "Лимит: 3 запроса в час. Обновится в 14:05", "429: чистый текст и код 429");
$e = \inc5633\aiChatHttpError(429, "", "https://agent.test/x");
expect($e->getCode() === 429 && $e->getMessage() !== "", "429 без тела: код 429, запасной текст");
$e = \inc5633\aiChatHttpError(500, '{"error":"boom"}', "https://agent.test/x");
expect($e->getCode() === 502 && strpos($e->getMessage(), "HTTP 500") !== false, "прочие ошибки — по-старому 502");
echo $failures === 0 ? "ALL PASS\n" : "$failures FAILED\n";
exit($failures === 0 ? 0 : 1);
