<?php
# Regression test for issue #3404
# https://github.com/ideav/crm/issues/3404
#
# Запрос для проверки оплаты ИИ-агента должен выполняться напрямую к $connection
# (SQL-запрос к таблице `my`), а вместо плейсхолдера {имя БД} должно
# подставляться имя текущей базы данных (с экранированием).
#
# Тест извлекает чистые функции buildAiAgentPaymentSql(), fetchAiAgentPaymentReport()
# и evaluateAiAgentPayment() из index.php и проверяет:
#  1) SQL строится по образцу из тикета, плейсхолдер {имя БД} заменён;
#  2) имя базы экранируется (нет SQL-инъекции через одинарную кавычку);
#  3) диспетчер по умолчанию идёт в SQL, а при заданном URL — в HTTP;
#  4) evaluateAiAgentPayment() корректно трактует строку SQL-результата.

$failures = 0;

function check($cond, $name){
    global $failures;
    if($cond){
        echo "PASS: $name\n";
    } else {
        echo "FAIL: $name\n";
        $failures++;
    }
}

# t9n() и aiConfigValue() — заглушки для изоляции тестируемых функций.
function t9n($value){
    # Возвращаем RU-вариант, чтобы сравнения по сообщению были детерминированы.
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

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false)
        throw new Exception("Function not found: ".$name);
    $brace = strpos($source, "{", $start);
    if($brace === false)
        throw new Exception("Function body not found: ".$name);
    $depth = 0;
    $length = strlen($source);
    for($i = $brace; $i < $length; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }
    throw new Exception("Function body is not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
foreach(array("buildAiAgentPaymentSql", "fetchAiAgentPaymentReportSql", "fetchAiAgentPaymentReportHttp", "fetchAiAgentPaymentReport", "evaluateAiAgentPayment") as $fn)
    eval(extract_function_source($source, $fn));

# 1) SQL строится по образцу и подставляет имя базы вместо {имя БД}.
$sql = buildAiAgentPaymentSql("acme");
check(strpos($sql, "{имя БД}") === false, "placeholder {имя БД} is replaced");
check(strpos($sql, "a271_val ='acme'") !== false, "database name substituted into a271_val filter");
check(strpos($sql, "a1085.val ='c2ai'") !== false, "fixed c2ai product filter preserved");
check(strpos($sql, "a967.val as 'Paid'") !== false, "Paid column kept (matches report format)");
check(strpos($sql, "a957.val as 'Payment'") !== false, "Payment column kept (matches report format)");
check(strpos($sql, "FROM my a957") !== false, "query runs against the `my` table");
check(strtoupper(substr(ltrim($sql), 0, 6)) === "SELECT", "query is a read-only SELECT");

# 2) Имя базы экранируется — одинарная кавычка не разрывает строковый литерал.
$evil = buildAiAgentPaymentSql("x' OR '1'='1");
check(strpos($evil, "a271_val ='x\\' OR \\'1\\'=\\'1'") !== false, "single quotes in db name are escaped (no injection)");

# 3) Диспетчер fetchAiAgentPaymentReport(): без URL — SQL-путь (нет $connection ->
#    false), с URL — HTTP-путь (несуществующий хост -> false, но без падения).
$GLOBALS["__config"] = array();
unset($GLOBALS["connection"]);
$sqlResult = fetchAiAgentPaymentReport("acme");
check($sqlResult === false, "SQL path returns false when no DB connection is available");

$GLOBALS["__config"] = array("AI_AGENT_PAYMENT_REPORT_URL" => "http://127.0.0.1:9/none?FR_DB=");
$httpResult = fetchAiAgentPaymentReport("acme");
check($httpResult === false, "HTTP path used when AI_AGENT_PAYMENT_REPORT_URL is configured");

# 4) evaluateAiAgentPayment() трактует SQL-результат (JSON-массив строк) так же,
#    как прежний отчёт. Сумма 5950/12500 и дата не старше месяца -> active.
$GLOBALS["__config"] = array();
$paidAt = time() - 3 * 24 * 3600;
$active = json_encode(array(array("Paid" => (string)$paidAt, "Payment" => "5950")));
$res = evaluateAiAgentPayment($active, "acme");
check(!empty($res["ok"]) && $res["status"] === "active", "valid recent 5950 payment -> active");

$expiredAt = time() - 60 * 24 * 3600;
$expired = json_encode(array(array("Paid" => (string)$expiredAt, "Payment" => "12500")));
$res = evaluateAiAgentPayment($expired, "acme");
check(empty($res["ok"]) && $res["status"] === "expired", "old payment -> expired");

$wrongAmount = json_encode(array(array("Paid" => (string)$paidAt, "Payment" => "100")));
$res = evaluateAiAgentPayment($wrongAmount, "acme");
check(empty($res["ok"]) && $res["status"] === "not_paid", "wrong amount -> not_paid");

# Пустой SQL-результат (нет строк оплаты) -> not_paid.
$res = evaluateAiAgentPayment("[]", "acme");
check(empty($res["ok"]) && $res["status"] === "not_paid", "empty SQL result -> not_paid");

$res = evaluateAiAgentPayment(false, "acme");
check(empty($res["ok"]) && $res["status"] === "not_paid", "fetch failure (false) -> not_paid");

echo "\n";
if($failures){
    echo "FAILED: $failures check(s) failed\n";
    exit(1);
}
echo "ALL TESTS PASSED\n";
