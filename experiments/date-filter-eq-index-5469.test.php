<?php
/**
 * Фильтр отчёта/таблицы по ОДНОЙ дате должен идти по индексу (t,val) — issue #5469.
 *
 * val — строковая колонка. Условие a<key>.val=20200102 (число без кавычек) MySQL считает
 * через приведение типа и читает всю таблицу: на стенде hlt (1 млн строк) день = 55.9 с,
 * а два дня диапазоном — 0.38 с. Дата хранится строкой YYYYMMDD фиксированной ширины,
 * поэтому сравнение строк с литералом в кавычках даёт тот же результат и идёт по индексу.
 *
 * Правило: при фильтре по колонке DATE КАЖДОЕ условие на val сравнивает со строковым
 * литералом — одна граница, обе границы, >=/<=/>/<, главное значение и реквизит.
 *
 * Запуск (оба ядра, каждое своим процессом):
 *   php experiments/date-filter-eq-index-5469.test.php
 */

$cores = array('index.php', 'integram.io/index.php');
$root  = dirname(__DIR__);

if ($argc < 2) {
    $failed = 0;
    foreach ($cores as $core) {
        echo "═══ $core ═══\n";
        passthru(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($core), $code);
        if ($code !== 0) { $failed++; }
    }
    echo $failed ? "ПРОВАЛЕНО ядер: $failed\n" : "Оба ядра проверены успешно\n";
    exit($failed ? 1 : 0);
}

$core_path = $root . '/' . $argv[1];
if (!file_exists($core_path)) { die("нет файла $core_path\n"); }

mb_internal_encoding("UTF-8");
define("VAL_LIM", 127);
$z = "testdb";
$GLOBALS["blocks"] = array();

function trace($m) {}
function t9n($s) { return $s; }
function die_info($s) { throw new Exception("die_info: $s"); }
function my_die($s) { throw new Exception("my_die: $s"); }
function BuiltIn($v) { return $v; }
function checkInjection($v) { return $v; }
function Exec_sql($s, $m) { return false; }
function validateInList($v) { return $v; }
# Format_Val ядра для DATE приводит дд.мм.гггг к ггггммдд; здесь — то же для теста
function Format_Val($t, $v) {
    return preg_match('/^(\d\d)\.(\d\d)\.(\d{4})$/', $v, $m) ? $m[3] . $m[2] . $m[1] : $v;
}

$core = file_get_contents($core_path);
$src  = '';
foreach (array('Escape_Filter_Val', 'Construct_WHERE') as $fn) {
    $start = strpos($core, "\nfunction $fn(");
    if ($start === false) {
        if ($fn === 'Construct_WHERE') { die("  В ядре $argv[1] нет Construct_WHERE\n"); }
        continue;
    }
    $end = strpos($core, "\n}", strpos($core, "\n{", $start));
    $src .= substr($core, $start, $end - $start + 3);
}
eval($src);

$failed = 0;
function check($ok, $message, $sql)
{
    global $failed;
    if ($ok) { echo "  OK   $message\n"; return; }
    $failed++;
    echo "  FAIL $message\n       WHERE: $sql\n";
}

/** WHERE для фильтра $filter по колонке DATE: реквизит (key != cur_typ) или главное значение. */
function where_for($filter, $own)
{
    $key = 10869;
    $cur = $own ? $key : 500;
    $GLOBALS["where"] = $GLOBALS["join"] = $GLOBALS["distinct"] = "";
    $GLOBALS["REV_BT"] = array($key => 'DATE');
    $GLOBALS["REF_typs"] = array();
    $GLOBALS["MULTI"] = array();
    $GLOBALS["BT"] = array('DATE' => 9);
    Construct_WHERE($key, $filter, $cur, 1);
    return $GLOBALS["where"];
}

/** Все сравнения val с датой — строковые литералы; число без кавычек = мимо индекса. */
function val_literals_quoted($sql)
{
    return preg_match_all("/\.val\s*(=|!=|>=|<=|>|<)\s*(\S+)/", $sql, $m) > 0
        && count(array_filter($m[2], function ($v) { return $v[0] !== "'"; })) === 0;
}

$cases = array(
    'одна дата FR (FR=TO свёрнуто ядром)' => array('FR' => '02.01.2020'),
    'одна дата TO'                        => array('TO' => '02.01.2020'),
    'одна дата F'                         => array('F' => '02.01.2020'),
    'диапазон FR..TO'                     => array('FR' => '01.01.2020', 'TO' => '02.01.2020'),
    'F=>=дата'                            => array('F' => '>=01.01.2020'),
    'F=<дата'                             => array('F' => '<01.01.2020'),
);
foreach (array(false => 'реквизит a<key>.val', true => 'главное значение vals.val') as $own => $where) {
    echo "\n$where\n";
    foreach ($cases as $name => $filter) {
        $sql = where_for($filter, $own);
        check(val_literals_quoted($sql) && strpos($sql, '2020010') !== false, "$name — дата строковым литералом", $sql);
    }
}

echo "\n" . ($failed ? "  ПРОВАЛЕНО проверок: $failed\n" : "  Все проверки пройдены\n");
exit($failed ? 1 : 0);
