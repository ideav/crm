<?php
# Issue #5637: остаток включённого объёма ИИ (ai_included_left), quota из callback агента, карта объёма по базам пользователя.
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
$code = "namespace inc5637;\n";
try {
    foreach(array("aiConfigValue", "billingAiUnitPrice", "evaluateAiAgentPayment", "aiAgentPaymentRaw", "aiAgentIncludedUnits",
        "billingAiUnitsUsed", "aiAgentIncluded", "aiAgentQuotaClean", "aiAgentJobPublic", "aiIncludedUnitsMap") as $fn)
        $code .= extract_function_source($source, $fn)."\n";
} catch(Exception $e){
    echo "FAIL: ".$e->getMessage()."\n";
    exit(1);
}
eval('namespace inc5637;
const DATABASE = 271;
function t9n($s){ return $s; }
function mysqli_real_escape_string($c, $s){ return addslashes($s); }
function mysqli_query($c, $sql){ $GLOBALS["__q"][] = $sql; return $GLOBALS["__res"]; }
function mysqli_fetch_assoc($r){ if($r === TRUE) return $GLOBALS["__row"]; if(is_array($r)) return array_shift($GLOBALS["__res"]) ?: NULL; return NULL; }
function fetchAiAgentPaymentReport($db){ return false; }
'.$code);
$GLOBALS["__q"] = array();
putenv("BILLING_AI_TOKENS_TYPE=239405");
function pay($amount, $db = "incdb"){
    $f = sys_get_temp_dir()."/ai_agent_pay_".$db.".json";
    if($amount === null){ @unlink($f); return; }
    file_put_contents($f, json_encode(array(array("Paid" => (string)time(), "Payment" => (string)$amount))));
}
function used($ord){ $GLOBALS["__res"] = TRUE; $GLOBALS["__row"] = $ord === null ? false : array("ord" => (string)$ord); }
$c = new stdClass();

pay(5950); used(100);
expect(\inc5637\aiAgentIncluded($c, "incdb") === 1552, "осталось 1652-100 = 1552");
used(1652);
expect(\inc5637\aiAgentIncluded($c, "incdb") === 0, "исчерпано: 0 (не FALSE)");
used(5000);
expect(\inc5637\aiAgentIncluded($c, "incdb") === 0, "перерасход: не меньше 0");
$GLOBALS["__res"] = false;
expect(!\inc5637\aiAgentIncluded($c, "incdb") && \inc5637\aiAgentIncluded($c, "incdb") !== 0, "ошибка чтения: нет значения (поле не шлётся)");
pay(null); used(5);
expect(!\inc5637\aiAgentIncluded($c, "incdb") && \inc5637\aiAgentIncluded($c, "incdb") !== 0, "нет оплаты: нет значения");
pay(null);

$ok = array("included_left" => 12, "rate_limit" => 3, "rate_left" => 1, "rate_reset" => "2026-11-22T14:05:00Z");
expect(\inc5637\aiAgentQuotaClean($ok) === $ok, "корректная quota проходит как есть");
$nul = array("included_left" => null, "rate_limit" => null, "rate_left" => null, "rate_reset" => null);
expect(\inc5637\aiAgentQuotaClean($nul) === null, "все null: показывать нечего, quota не хранится");
expect(\inc5637\aiAgentQuotaClean(array("included_left" => 7)) === array("included_left" => 7, "rate_limit" => null, "rate_left" => null, "rate_reset" => null), "пропущенные поля — null");
expect(\inc5637\aiAgentQuotaClean(null) === null && \inc5637\aiAgentQuotaClean("x") === null && \inc5637\aiAgentQuotaClean(array()) === null, "нет quota / не массив / пусто — null");
$bad = \inc5637\aiAgentQuotaClean(array("included_left" => -1, "rate_limit" => "3", "rate_left" => 1.5, "rate_reset" => "<b>".str_repeat("x", 50)));
expect($bad === null, "всё невалидное — quota отбрасывается целиком");
$mix = \inc5637\aiAgentQuotaClean(array("included_left" => "9", "rate_left" => 2, "rate_reset" => str_repeat("1", 41)));
expect($mix["included_left"] === null && $mix["rate_left"] === 2 && $mix["rate_reset"] === null, "строгие типы: строка и длинный reset — null, валидное остаётся");
expect(\inc5637\aiAgentQuotaClean(array("included_left" => true, "rate_left" => 2))["included_left"] === null, "bool — не int");

$pub = \inc5637\aiAgentJobPublic(array("id" => "a", "status" => "done", "result" => array("assistant" => array("content" => "x"), "quota" => $ok)));
expect($pub["quota"] === $ok, "aiAgentJobPublic отдаёт quota");
$pub = \inc5637\aiAgentJobPublic(array("id" => "a", "status" => "done", "result" => array("assistant" => array("content" => "x"))));
expect(array_key_exists("quota", $pub) && $pub["quota"] === null, "старый агент: quota = null");
$pub = \inc5637\aiAgentJobPublic(array("id" => "a", "status" => "processing"));
expect($pub["quota"] === null, "не готовая задача: quota = null");

pay(5950, "dbone"); pay(12500, "dbtwo"); pay(null, "dbthree");
$GLOBALS["__q"] = array();
$GLOBALS["__res"] = array(array("val" => "dbone"), array("val" => "dbtwo"), array("val" => "dbthree"));
$map = \inc5637\aiIncludedUnitsMap($c, 42);
expect($map === array("dbone" => 1652, "dbtwo" => 3472, "dbthree" => 0), "карта объёма по базам пользователя");
$sql = $GLOBALS["__q"][0];
expect(strpos($sql, "up=42") !== false && strpos($sql, "t=271") !== false, "выбираются только базы пользователя (up=42)");
$GLOBALS["__q"] = array();
$GLOBALS["__res"] = array();
expect(\inc5637\aiIncludedUnitsMap($c, "42; DROP") === array() && count($GLOBALS["__q"]) === 0, "нечисловой user — пусто, без запроса");
expect(\inc5637\aiIncludedUnitsMap($c, 0) === array(), "гость (0) — пусто");
pay(null, "dbone"); pay(null, "dbtwo");
echo $failures === 0 ? "ALL PASS\n" : "$failures FAILED\n";
exit($failures === 0 ? 0 : 1);
