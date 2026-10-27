<?php
# Условие WHERE из адреса вызова запроса (report/<id>?WHERE=...) встаёт в выборку как
# «AND (<условие>)» и только сужает её: выйти из скобок и снять ограничители запроса
# (фильтр [USER_ID] и т.п.) через OR нельзя. Строка, закрывающая лишнюю скобку, с
# незакрытыми скобками или кавычками, с «;» или комментарием вне кавычек — отказ.
#
# Функция берётся из index.php как есть.
# Прогон: php experiments/report-request-where.test.php
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

$source = file_get_contents(__DIR__."/../index.php");
$fn = extract_function_source($source, "Report_request_where");
if($fn === null){
    fwrite(STDERR, "FAIL: в index.php нет Report_request_where() — WHERE из адреса вклеивается без скобок\n\nFAILED: 1 check(s) failed\n");
    exit(1);
}
eval($fn);

$failures = 0;
function check($cond, $label){
    global $failures;
    if($cond) echo "  ok  $label\n";
    else { echo "FAIL  $label\n"; $failures++; }
}
# Фрагмент выборки так, как его собирает Compile_Report; null — вызов отклонён.
function filter_for($where){
    try { return " AND (".Report_request_where($where).")"; }
    catch(Refused $e){ return null; }
}

echo "1. выйти из скобок нельзя — отказ\n";
foreach(array(
    "1) OR (1",
    "1=1) OR (1=1",
    "a.val=1)) OR ((1",
    "1=1 OR (1",
    "(1=1",
    "1=1; DELETE",
    "1=1 -- ",
    "1=1 # x",
    "1=1 /* x",
    "a.val='x",
    "a.val=\"x",
) as $attack)
    check(filter_for($attack) === null, "отказ: $attack");

echo "2. OR внутри скобок остаётся внутри\n";
check(filter_for("1=1 OR 1=1") === " AND (1=1 OR 1=1)", "OR 1=1 не снимает ограничители");
check(filter_for("OR 1=1") === " AND (OR 1=1)", "ведущий OR остаётся в скобках (ошибка SQL, а не расширение выборки)");

echo "3. законные условия проходят\n";
check(filter_for("a.val='Новый' OR a.val='В работе'") === " AND (a.val='Новый' OR a.val='В работе')", "OR в скобках");
check(filter_for("AND a.up=12") === " AND (a.up=12)", "ведущий AND снимается");
check(filter_for("and(a.up=12)") === " AND ((a.up=12))", "ведущий and( снимается");
check(filter_for("(a.up=1 OR a.up=2) AND a.val>0") === " AND ((a.up=1 OR a.up=2) AND a.val>0)", "свои скобки");
check(filter_for("a.val='a) OR (b'") === " AND (a.val='a) OR (b')", "скобки в кавычках не считаются");
check(filter_for("a.val='it\\'s; -- #'") === " AND (a.val='it\\'s; -- #')", "экранированная кавычка, ; и комментарии внутри строки");
check(filter_for("a.val='A' AND b.val=\"B\"") === " AND (a.val='A' AND b.val=\"B\")", "двойные кавычки");

if($failures){ fwrite(STDERR, "FAILED: $failures check(s) failed\n"); exit(1); }
echo "\nALL PASSED\n";
