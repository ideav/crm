<?php
/**
 * Значение фильтра F_/FR_/TO_ не должно попадать в SQL без экранирования.
 *
 * Запуск (проверяет ОБА ядра):
 *   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/filter_sqli.test.php
 * Одно ядро:
 *   … php experiments/filter_sqli.test.php index.php
 *
 * Тест берёт Escape_Filter_Val() и Construct_WHERE() ИЗ САМИХ ЯДЕР, а не из копии,
 * поэтому не расходится с кодом. Каждое ядро проверяется отдельным процессом —
 * иначе вторая копия Construct_WHERE() не объявится.
 *
 * Найдено на живой базе upsound 31.07.2026: имя артиста "Yan Pol' Musique" из выгрузки
 * роняло запрос — «You have an error in your SQL syntax … near 'Pol' Musique».
 * Значение, ВНУТРИ которого есть апостроф, освобождалось от экранирования целиком,
 * а фильтр F_ приходит из адресной строки. В index.php так же не экранировались
 * числовые колонки и даты: F_{колонка}=' OR '1'='1 давало vals.val='' OR '1'='1'.
 */

$cores = array('index.php', 'experiments/index_upsound_260723.fixed.php');
$root  = dirname(__DIR__);

if ($argc < 2) { # запуск без аргументов — прогоняем каждое ядро своим процессом
    $failed = 0;
    foreach ($cores as $core) {
        echo "═══ $core ═══\n";
        $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . escapeshellarg($core);
        passthru($cmd, $code);
        if ($code !== 0) { $failed++; }
        echo "\n";
    }
    echo $failed ? "ПРОВАЛЕНО ядер: $failed\n" : "Оба ядра проверены успешно\n";
    exit($failed ? 1 : 0);
}

$core_path = $root . '/' . $argv[1];
if (!file_exists($core_path)) { die("нет файла $core_path\n"); }

mb_internal_encoding("UTF-8");
define("VAL_LIM", 127);
$z = "testdb";

# ---- заглушки того, на что опирается Construct_WHERE ----
function trace($m) {}
function t9n($s) { return $s; }
function die_info($s) { throw new Exception("die_info: $s"); }
function BuiltIn($v) { return $v; }
function checkInjection($v) { return $v; }
function Format_Val($t, $v) { return $v; }
function Exec_sql($s, $m) { return false; }
function validateInList($v) { return $v; }

# ---- достаём проверяемые функции из ядра ----
$core = file_get_contents($core_path);
$src  = '';
foreach (array('Escape_Filter_Val', 'Construct_WHERE') as $fn) {
    $start = strpos($core, "\nfunction $fn(");
    if ($start === false) {
        die("  В ядре $argv[1] нет функции $fn — экранирование фильтра не на месте\n");
    }
    $end = strpos($core, "\n}", strpos($core, "\n{", $start));
    $src .= substr($core, $start, $end - $start + 3);
}
eval($src);

$failed = 0;
function check($expected, $actual, $message)
{
    global $failed;
    if ($expected === $actual) { echo "  OK   $message\n"; return; }
    $failed++;
    echo "  FAIL $message\n";
    echo "       ожидалось: " . var_export($expected, true) . "\n";
    echo "       получено:  " . var_export($actual, true) . "\n";
}

/** Условие WHERE для фильтра по значению первой колонки таблицы заданного типа. */
function where_for($value, $base_type = 'SHORT', $filter = null)
{
    $key = 10869;
    $GLOBALS["where"] = $GLOBALS["join"] = $GLOBALS["distinct"] = "";
    $GLOBALS["REV_BT"] = array($key => $base_type);
    $GLOBALS["REF_typs"] = array();
    $GLOBALS["MULTI"] = array();
    $GLOBALS["BT"] = array($base_type => 3);
    Construct_WHERE($key, $filter ? $filter : array("F" => $value), $key, FALSE, TRUE);
    return $GLOBALS["where"];
}

/** Кавычки парны — значит литерал не разорван и из него ничего не вышло. */
function quotes_balanced($sql)
{
    $n = 0;
    for ($i = 0; $i < strlen($sql); $i++) {
        if ($sql[$i] === '\\') { $i++; continue; }
        if ($sql[$i] === "'") { $n++; }
    }
    return $n % 2 === 0;
}

echo "1. Escape_Filter_Val: данные экранируются, плейсхолдеры отчётов — нет\n";
check("Yan Pol\\' Musique", Escape_Filter_Val("Yan Pol' Musique"), 'апостроф экранируется');
check('[VAL]', Escape_Filter_Val('[VAL]'), 'плейсхолдер отчёта остаётся как есть');
check('Bogdi Bi & ayowhykee', Escape_Filter_Val('Bogdi Bi & ayowhykee'), 'обычное значение не меняется');
check("a\\\\b", Escape_Filter_Val('a\\b'), 'обратный слэш экранируется');

echo "\n2. Инъекция обезврежена на КАЖДОМ типе колонки\n";
# именно числа и даты были дырой в index.php: они идут прямой подстановкой, минуя $search_val
foreach (array('SHORT', 'CHARS', 'MEMO', 'NUMBER', 'DATE', 'DATETIME') as $bt) {
    foreach (array("' OR '1'='1", "x' OR 1=1 -- ", "'; DROP TABLE t; -- ") as $payload) {
        $sql = where_for($payload, $bt);
        check(true, quotes_balanced($sql), "$bt: кавычки парные для " . trim($payload));
    }
}

echo "\n3. Имя с апострофом ищется, а не роняет запрос\n";
$sql = where_for("Yan Pol' Musique");
check(true, quotes_balanced($sql), 'кавычки парные');
check(true, strpos($sql, "Yan Pol\\' Musique") !== FALSE, 'значение попало экранированным');

echo "\n4. Обычные значения ищутся по-прежнему\n";
check(true, strpos(where_for('COLDLEEN'), "'COLDLEEN'") !== FALSE, 'точное совпадение без изменений');
check(true, strpos(where_for('COLD%'), 'LIKE') !== FALSE, 'шаблон с % остаётся LIKE-условием');
check(true, strpos(where_for('%'), 'NULL') !== FALSE, 'одиночный % — условие на непустое значение');

echo "\n" . ($failed ? "  ПРОВАЛЕНО проверок: $failed\n" : "  Все проверки пройдены\n");
exit($failed ? 1 : 0);
