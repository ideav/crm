<?php
# Issue #5633: цена единицы ИИ (₽) — в одном месте, BILLING_AI_UNIT_PRICE, по умолчанию 0,36.
# Реальные функции из index.php; значение уходит в {_global_.ai_unit_price} (отчёт 5431, ЛК).
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
$code = "namespace aiprice5633;\n";
try {
    foreach(array("aiConfigValue", "billingAiUnitPrice") as $fn)
        $code .= extract_function_source($source, $fn)."\n";
} catch(Exception $e){
    echo "FAIL: ".$e->getMessage()."\n";
    exit(1);
}
eval($code);
function price($v){
    putenv($v === null ? "BILLING_AI_UNIT_PRICE" : "BILLING_AI_UNIT_PRICE=$v");
    return \aiprice5633\billingAiUnitPrice();
}
expect(price(null) === "0.36", "default 0.36");
expect(price("0.5") === "0.5", "env 0.5");
expect(price("0,45") === "0.45", "comma decimal accepted");
expect(price("abc") === "0.36", "junk -> default");
expect(price("0") === "0.36", "zero -> default");
expect(price("-1") === "0.36", "negative -> default");
expect(price("1e3") === "0.36", "exponent -> default");
expect(strpos($source, '$GLOBALS["GLOBAL_VARS"]["ai_unit_price"]') !== false, "exposed as _global_.ai_unit_price");
echo $failures === 0 ? "ALL PASS\n" : "$failures FAILED\n";
exit($failures === 0 ? 0 : 1);
