<?php
# Значения из адреса вызова запроса (report/<id>?…) не несут в SQL ничего, кроме данных:
#  - WHERE=  — только сравнения колонок с литералами: подзапросы, вызовы функций вне белого
#              списка, переменные @, обратные кавычки, версионные комментарии /*!…*/ — отказ;
#  - SELECT= — формула колонки разбирается тем же белым списком; функция колонки (id:FUNC) —
#              только имя-идентификатор;
#  - _request_.X в формулах/фильтрах/JOIN/ORDER/GROUP: внутри кавычек шаблона — экранированное
#              значение, вне кавычек — число как есть, остальное — строка в кавычках.
#
# Функции берутся из ядра как есть: index.php (ideav.ru) или путь из аргумента от корня репо
# (integram.io/index.php — ядро integram.io, p2n#1420).
# Прогон: php experiments/report-sql-request-1140.test.php [integram.io/index.php]
# Отказ — только exit(1): die("…") выходит с кодом 0 и обёртка засчитала бы PASS.

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) return null;
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    return null;
}

class Refused extends Exception {}
function t9n($s){ return $s; }
function die_info($msg){ throw new Refused($msg); }

$core = isset($argv[1]) ? $argv[1] : "index.php";
$source = file_get_contents(__DIR__."/../".$core);
$missing = array();
foreach(array("Sql_escape", "Report_sql_expr", "Report_request_where", "Report_request_subst", "Report_request_func") as $name){
    $fn = extract_function_source($source, $name);
    if($fn === null) $missing[] = $name;
    else eval($fn);
}
if(count($missing)){
    fwrite(STDERR, "FAIL: в $core нет ".implode(", ", $missing)."() — значения из адреса идут в SQL сырыми\n\nFAILED: 1 check(s) failed\n");
    exit(1);
}

$failures = 0;
function check($cond, $label){
    global $failures;
    if($cond) echo "  ok  $label\n";
    else { echo "FAIL  $label\n"; $failures++; }
}
function refused($f){
    try { $f(); return false; }
    catch(Refused $e){ return true; }
}
function where_of($w){
    try { return Report_request_where($w); }
    catch(Refused $e){ return null; }
}

echo "1. WHERE: подзапросы и обходы чёрного списка — отказ\n";
foreach(array(
    "a.id IN (SELECT id FROM other.t)",
    "a.id=(SELECT 1)",
    "a.id IN (/*!99999select*/ id /*!99999from*/ t)",
    "a.val=SLEEP(5)",
    "a.val=BENCHMARK(1000000,MD5(1))",
    "a.val=@@version",
    "a.val=@x",
    "`a`.val=1",
    "a.val=0x41",
    "a.val=1 UNION SELECT 1",
    "EXISTS(SELECT 1)",
    "a.val=LOAD_FILE('/etc/passwd')",
    "a.val=1 INTO OUTFILE '/tmp/x'",
    "a.pwd=1",
    "information_schema.tables",
) as $attack)
    check(where_of($attack) === null, "отказ: $attack");

echo "2. WHERE: законные условия проходят без изменений\n";
foreach(array(
    "a.val LIKE '%x%'",
    "a12.id IN (1,2,3)",
    "a12_34.val IS NOT NULL",
    "DATE(a5.val) BETWEEN '2026-01-01' AND '2026-02-01'",
    "a.val='SELECT * FROM t' OR a.up=-1.5",
    "NOT (a.ord>=2 AND a.t<>3)",
) as $ok)
    check(where_of($ok) === $ok, "проходит: $ok");

echo "3. SELECT: формула колонки\n";
check(!refused(function(){ Report_sql_expr("a1.val*2", "SELECT"); }), "a1.val*2");
check(!refused(function(){ Report_sql_expr("CONCAT([THIS], ' шт')", "SELECT"); }), "CONCAT([THIS], ' шт')");
check(!refused(function(){ Report_sql_expr(":12:/:13:", "SELECT"); }), ":12:/:13:");
check(!refused(function(){ Report_sql_expr("ROUND(CAST(a1.val AS DOUBLE), 2)", "SELECT"); }), "ROUND(CAST(… AS DOUBLE), 2)");
check(refused(function(){ Report_sql_expr("(SELECT val FROM t LIMIT 1)", "SELECT"); }), "отказ: подзапрос");
check(refused(function(){ Report_sql_expr("/*!99999select*/ 1", "SELECT"); }), "отказ: версионный комментарий");
check(refused(function(){ Report_sql_expr("1), (2", "SELECT"); }), "отказ: лишняя скобка");
check(refused(function(){ Report_sql_expr("USER()", "SELECT"); }), "отказ: функция вне белого списка");

echo "4. SELECT: функция колонки — только имя\n";
check(Report_request_func("sum") === "SUM", "sum → SUM");
check(Report_request_func("abn_ID") === "ABN_ID", "abn_ID → ABN_ID (как раньше strtoupper)");
check(refused(function(){ Report_request_func("SUM(1) x,(SELECT"); }), "отказ: SUM(1) x,(SELECT");
check(refused(function(){ Report_request_func("x' OR '1"); }), "отказ: кавычка");
check(refused(function(){ Report_request_func("SLEEP"); }), "отказ: функция вне белого списка");
check(Report_request_func("") === "", "пусто — пусто (колонка без функции)");

echo "5. _request_ подставляется данными\n";
$_REQUEST = array("q" => "a' OR '1", "n" => "1 OR 1=1", "k" => "42", "f" => "-1.5", "arr" => array("1"), "s" => "x\\");
check(Report_request_subst("a.val='_request_.q'") === "a.val='a\\' OR \\'1'", "в кавычках — экранировано");
check(Report_request_subst("a.val LIKE \"%_request_.q%\"") === "a.val LIKE \"%a\\' OR \\'1%\"", "в двойных кавычках — экранировано");
check(Report_request_subst("a.id=_request_.n") === "a.id='1 OR 1=1'", "без кавычек, не число — строкой в кавычках");
check(Report_request_subst("a.id=_request_.k") === "a.id=42", "без кавычек, число — как есть");
check(Report_request_subst("a.id>_request_.f") === "a.id>-1.5", "дробное отрицательное — как есть");
$_REQUEST["ids"] = "1, 2,3"; $_REQUEST["ids2"] = "1,2) OR (1";
check(Report_request_subst("a.id IN(_request_.ids)") === "a.id IN(1, 2,3)", "список чисел для IN — как есть");
check(Report_request_subst("a.id IN(_request_.ids2)") === "a.id IN('1,2) OR (1')", "список с хвостом — строкой");
check(Report_request_subst("a.id=_request_.arr") === "a.id=''", "массив — пустая строка");
check(Report_request_subst("a.val='_request_.s' AND a.id=_request_.k") === "a.val='x\\\\' AND a.id=42", "обратная косая не съедает кавычку");
check(Report_request_subst("a.val='_request_.none'") === "a.val='_request_.none'", "незаданный параметр остаётся текстом (как раньше)");
check(Report_request_subst("a.val='it''s' AND a.id=_request_.n") === "a.val='it''s' AND a.id='1 OR 1=1'", "удвоенная кавычка шаблона не сбивает контекст");
check(Report_request_subst(array("x" => "a.id=_request_.n", "y" => "'_request_.q'")) === array("x" => "a.id='1 OR 1=1'", "y" => "'a\\' OR \\'1'"), "массив фрагментов — по каждому, ключи сохранены");

if($failures){ fwrite(STDERR, "FAILED: $failures check(s) failed\n"); exit(1); }
echo "\nALL PASSED\n";
