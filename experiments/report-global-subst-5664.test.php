<?php
# Значения _global_.X в формулах и фильтрах запроса — данные, а не SQL (issue #5664):
#  - _global_.action и _global_.id берутся из пути адреса как есть, поэтому внутри кавычек
#    шаблона подставляется экранированное значение, вне кавычек — число или слово из букв,
#    цифр и подчёркивания как есть, остальное — строкой в кавычках;
#  - проверка служебных слов SQL (from/select/table) смотрит на текст запроса вне строковых
#    литералов: слово внутри кавычек — значение, а не часть запроса.
#
# Боевой случай: отчёт solseo базы solutions фильтрует колонку slug по '_global_.action';
# на /solutions/table/473 значение table роняло страницу отказом «Найдено: table», а адрес
# /solutions/zzz'or'1'='1 выдавал все решения (кавычка из пути закрывала литерал).
#
# Функции берутся из index.php как есть.
# Прогон: php experiments/report-global-subst-5664.test.php
# rules: none (defect #5664)

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

$source = file_get_contents(__DIR__."/../index.php");
$missing = array();
foreach(array("Sql_escape", "Report_global_subst", "Report_sql_outside_literals") as $name){
    $fn = extract_function_source($source, $name);
    if($fn === null) $missing[] = $name;
    else eval($fn);
}
if(count($missing)){
    fwrite(STDERR, "FAIL: в index.php нет ".implode(", ", $missing)."() — _global_ идёт в SQL сырым\n\nFAILED: 1 check(s) failed\n");
    exit(1);
}

$failures = 0;
function check($cond, $label){
    global $failures;
    if($cond) echo "  ok  $label\n";
    else { echo "FAIL  $label\n"; $failures++; }
}
# та же проверка, что в Compile_Report перед выполнением запроса
function keyword_hit($sql){
    return preg_match("/(\b(from|select|table)\b|\/\*!)/i", Report_sql_outside_literals($sql), $m) ? $m[0] : "";
}

echo "1. _global_ в кавычках — экранированное значение\n";
$GLOBALS["GLOBAL_VARS"] = array("action" => "zzz'or'1'='1", "id" => "1--", "user_id" => "42",
    "user" => "O'Brien", "z" => "solutions", "uri" => "/a b", "s" => "x\\", "user_idx" => "7");
check(Report_global_subst("a.val='_global_.action'") === "a.val='zzz\\'or\\'1\\'=\\'1'", "кавычка из пути не закрывает литерал");
check(Report_global_subst("a.val=\"_global_.user\"") === "a.val=\"O\\'Brien\"", "двойные кавычки");
check(Report_global_subst("a.val='_global_.s' AND a.id=_global_.user_id") === "a.val='x\\\\' AND a.id=42", "обратная косая не съедает кавычку");
check(Report_global_subst("a.val='it''s _global_.z'") === "a.val='it''s solutions'", "удвоенная кавычка шаблона не сбивает контекст");

echo "2. _global_ без кавычек\n";
check(Report_global_subst("a.id=_global_.user_id") === "a.id=42", "число — как есть");
check(Report_global_subst("a.t=_global_.z") === "a.t=solutions", "слово — как есть");
check(Report_global_subst("a.id=_global_.id AND a.pub=1") === "a.id='1--' AND a.pub=1", "1-- — строкой, хвост фильтра не закомментирован");
check(Report_global_subst("a.val=_global_.uri") === "a.val='/a b'", "прочее — строкой в кавычках");
check(Report_global_subst("a.id=_global_.user_idx") === "a.id=7", "имя целиком: user_idx не путается с user_id");
check(Report_global_subst("a.id=_global_.none") === "a.id=_global_.none", "незаданная переменная остаётся текстом (как раньше)");
check(Report_global_subst("a.id=_GLOBAL_.user_id") === "a.id=42", "регистр префикса не важен (как раньше)");
check(Report_global_subst(array("x" => "a.id=_global_.user_id", "y" => "'_global_.action'")) === array("x" => "a.id=42", "y" => "'zzz\\'or\\'1\\'=\\'1'"), "массив — по каждому, ключи сохранены");

echo "3. служебные слова SQL ищутся вне литералов\n";
$GLOBALS["GLOBAL_VARS"]["action"] = "table";
check(keyword_hit(Report_global_subst("a914.val='_global_.action'")) === "", "действие table в литерале — не отказ (боевой случай)");
check(keyword_hit("CONCAT(a.val, ' from ')") === "", "слово в литерале формулы — не отказ");
check(keyword_hit("(SELECT val FROM t)") !== "", "подзапрос — отказ");
check(keyword_hit("a.val='x' OR a.id IN (SELECT 1)") !== "", "подзапрос после литерала — отказ");
check(keyword_hit("a.val='it\\'s' OR 1 IN (SELECT 1)") !== "", "экранированная кавычка не продлевает литерал");
check(keyword_hit("a.val='it''s' OR 1 IN (SELECT 1)") !== "", "удвоенная кавычка не продлевает литерал");
check(keyword_hit("a.val='/*!' select 1") !== "", "/*! в литерале не скрывает слово снаружи");
check(keyword_hit("a.val=1 -- '\n select 1 '") !== "", "комментарий -- : литералы не вырезаются");
check(keyword_hit("a.val=1 # '\n select 1 '") !== "", "комментарий # : литералы не вырезаются");
check(keyword_hit("a.val=1 /* ' */ select 1 '") !== "", "комментарий /* : литералы не вырезаются");
check(keyword_hit("a.val='select") !== "", "незакрытый литерал — проверяется весь текст");

if($failures){ fwrite(STDERR, "FAILED: $failures check(s) failed\n"); exit(1); }
echo "\nALL PASSED\n";
