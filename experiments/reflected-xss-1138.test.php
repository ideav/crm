<?php
# Мерка: текст из запроса в HTML/JSON-ответах ядра и трассировка TRACE_IT (python2node#1138).
#
# Запуск: php experiments/reflected-xss-1138.test.php (в гейте — через одноимённый .test.js)
#
# Правила:
#   1) сообщение my_die() в HTML-ответе экранировано: <script>, атрибуты, кавычки — текстом;
#      разметка ядра <br/> и <b> остаётся, готовые сущности (&laquo;) не удваиваются;
#   2) my_die(…, TRUE) отдаёт готовый HTML ядра как есть (ссылки «используется в отчётах»);
#   3) JSON-ответ my_die() и Json_die() не содержит символов < > — браузер, показав его
#      как HTML, не найдёт разметки; значение после разбора JSON то же;
#   4) трассировку включает только администратор базы (admin или владелец), аноним и
#      обычный пользователь — нет.
namespace Test1138;

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function extract_function_source($source, $name){
    $start = strpos($source, "\nfunction ".$name."(");
    if($start === false) return NULL;
    $end = strpos($source, "\nfunction ", $start + 1);
    return substr($source, $start, ($end === false ? strlen($source) : $end) - $start);
}

class Died extends \Exception {}
function test_die($out = ""){ throw new Died((string)$out); }
function Report_tx_rollback(){}
function header($h){}
function InBatchOp(){ return FALSE; }
class IntegramOpError extends \Exception {}
$API = FALSE;
function isApi(){ global $API; return $API; }
function api_dump($json, $name = "api.json"){ test_die($json); }

$src = file_get_contents(__DIR__."/../index.php");
foreach(array("Safe_msg_html", "Json_die", "my_die", "Trace_allowed") as $fn){
    $code = extract_function_source($src, $fn);
    if($code === NULL){ echo "MISSING: $fn\n"; continue; }
    # die() завершает процесс — в мерке он бросает исключение с выводом
    eval("namespace ".__NAMESPACE__.";".preg_replace('/\bdie\(/', 'test_die(', $code));
}

function out_of($fn){
    try { $fn(); } catch(Died $e){ return $e->getMessage(); }
    return NULL;
}

$evil = '<script>alert(1)</script><img src=x onerror="alert(2)">';

# 1. my_die в HTML
$API = FALSE;
$html = out_of(function() use($evil){ my_die("Значение должно быть числом: t1 = ".$evil); });
expect($html !== NULL && stripos($html, "<script") === false && stripos($html, "<img") === false,
    "my_die HTML: тег из значения не проходит (".$html.")");
expect($html !== NULL && strpos($html, "&lt;script&gt;") !== false, "my_die HTML: значение видно текстом");
$core = out_of(function(){ my_die("Неверный токен CSRF<br/>в <b>базе</b> &laquo;x&raquo;"); });
expect($core === "Неверный токен CSRF<br/>в <b>базе</b> &laquo;x&raquo;", "my_die HTML: <br/>, <b> и &laquo; ядра как были (".$core.")");

# 2. Готовый HTML ядра
$link = '<a href="/db/object/22/?F_28=5">отчетах</a>';
expect(out_of(function() use($link){ my_die($link, "", TRUE); }) === $link, "my_die(…, TRUE): ссылка ядра как есть");

# 3. JSON
$API = TRUE;
$json = out_of(function() use($evil){ my_die($evil); });
expect($json !== NULL && strpbrk($json, "<>") === false, "my_die JSON: нет < > в ответе (".$json.")");
$dec = json_decode((string)$json, TRUE);
expect(isset($dec[0]["error"]) && $dec[0]["error"] === $evil, "my_die JSON: после разбора то же сообщение");
$API = FALSE;
$raw = json_encode(array("a" => $evil, "b" => "x\\<y"), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$jd = function_exists(__NAMESPACE__."\\Json_die") ? out_of(function() use($raw){ Json_die($raw); }) : $raw;
expect(strpbrk($jd, "<>") === false, "Json_die: нет < > в ответе (".$jd.")");
expect(json_decode($jd, TRUE) === array("a" => $evil, "b" => "x\\<y"), "Json_die: после разбора те же значения");

# 4. TRACE_IT
$allowed = function($user){
    $GLOBALS["GLOBAL_VARS"] = array("user" => $user);
    return function_exists(__NAMESPACE__."\\Trace_allowed") ? Trace_allowed("db") : TRUE;  # на main трассировка — всем
};
expect($allowed("") === FALSE, "TRACE_IT: аноним — нет");
expect($allowed("ivan") === FALSE, "TRACE_IT: обычный пользователь — нет");
expect($allowed("admin") === TRUE, "TRACE_IT: admin — да");
expect($allowed("db") === TRUE, "TRACE_IT: владелец базы — да");

echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
