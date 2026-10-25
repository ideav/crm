<?php
# Мерка к ai2o#92: функция колонки RECURSIVE ходит по ребру в одну сторону;
# RECBOTH=1 включает обход в обе стороны (порт двунаправленной гирлянды vecmory).
# Без RECBOTH сгенерированный SQL обязан совпадать с прежним байт-в-байт.
# https://git.ai2o.ru/triit/ai2o/issues/92
#
# Запуск: php experiments/recursive-recboth.test.php (в гейте — через одноимённый .test.js)
#
# Проверяется РЕАЛЬНЫЙ фрагмент index.php (приём main-template-renders-5231):
# блок генерации WITH RECURSIVE вырезается из исходника по якорям и исполняется
# eval-ом с подготовленным окружением — тест краснеет при дрейфе фрагмента.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

$src = file_get_contents(__DIR__."/../index.php");
$start = strpos($src, "\t\t\$rec_limit = \"LIMIT \".DDLIST_ITEMS;");
$endMark = "\" SELECT DISTINCT id \$name FROM c\";";
$first = strpos($src, $endMark, $start);
$end = $first === false ? false : strpos($src, $endMark, $first + 1);
if($start === false || $end === false){ echo "FAIL: фрагмент RECURSIVE не найден по якорям (дрейф index.php)\n"; exit(1); }
# Якорь конца встречается в ОБЕИХ ветках (if и else) — берём ВТОРОЕ вхождение,
# иначе во фрагмент попадает только ветка самоссылки, а else отрезается.
$fragment = substr($src, $start, $end + strlen($endMark) - $start);

if(!defined("DDLIST_ITEMS")) define("DDLIST_ITEMS", 80);

# run_fragment($selfRef, $both): подготовить окружение, исполнить фрагмент, вернуть SQL.
# Фрагмент использует: $id, $z, $typ, $cond, $name, $_REQUEST, $GLOBALS["STORED_REPS"].
function run_fragment($selfRef, $both){
    $fragment = $GLOBALS['__fragment'];
    $GLOBALS["STORED_REPS"] = [];
    $id = 42; $z = "rep"; $typ = 7; $cond = " AND id IS NOT NULL"; $name = "'Колонка'";
    $GLOBALS["STORED_REPS"][$id] = ["types" => [null, $typ]];
    if($selfRef) $GLOBALS["STORED_REPS"][$id]["references"][$typ][$typ] = "230";
    $_REQUEST = $both ? ["RECBOTH" => "1"] : [];
    eval($fragment);
    return $GLOBALS["STORED_REPS"][$id]["sql"];
}
$GLOBALS['__fragment'] = $fragment;

# 1. Легаси-поведение (без RECBOTH) — SQL байт-в-байт прежний.
$sql = run_fragment(true, false);
expect(
    $sql === " WITH RECURSIVE c AS (SELECT id, 0 t FROM rep WHERE t=7 AND up!=0 AND t!=up  AND id IS NOT NULL"
        ."  UNION SELECT ref.up id, ref.t FROM rep ref INNER JOIN c ON c.id=ref.t WHERE ref.val='230' LIMIT 80)"
        ." SELECT DISTINCT id 'Колонка' FROM c",
    "без RECBOTH самоссылка: SQL байт-в-байт прежний"
);

$sql = run_fragment(false, false);
expect(
    $sql === " WITH RECURSIVE c AS (SELECT id, 0 t FROM rep WHERE t=7 AND up!=0 AND t!=up AND val!=''  AND id IS NOT NULL"
        ."  UNION SELECT ref.id id, ref.t FROM rep ref INNER JOIN c ON c.id=ref.up WHERE ref.t=7 LIMIT 80)"
        ." SELECT DISTINCT id 'Колонка' FROM c",
    "без RECBOTH дерево: SQL байт-в-байт прежний"
);

# 2. RECBOTH=1 — ребро в обе стороны: самоссылка добавляет исходящие рёбра,
#    дерево — подъём к родителям.
$sql = run_fragment(true, true);
expect(
    strpos($sql, "CASE WHEN ref.t=c.id THEN ref.up ELSE ref.t END id") !== false
        && strpos($sql, "ON c.id=ref.t OR c.id=ref.up") !== false,
    "RECBOTH самоссылка: CASE по обоим концам ребра + исходящие в join"
);

$sql = run_fragment(false, true);
expect(
    strpos($sql, "CASE WHEN c.id=ref.up THEN ref.id ELSE ref.up END id") !== false
        && strpos($sql, "ON c.id=ref.up OR c.id=ref.id") !== false,
    "RECBOTH дерево: CASE вниз и вверх + оба направления в join"
);

exit($failures ? 1 : 0);
