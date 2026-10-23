<?php
/**
 * Issue #5236: повторный BKI-импорт дублировал скалярные реквизиты существующей записи.
 *
 * Фаза данных BKI вставляла каждый скаляр из файла новой строкой, не глядя на то, что у
 * записи уже есть: у записи 7001 после каждого импорта того же файла прибавлялось по строке
 * реквизита «Остаток, м». Правило — как у табличного импорта (#4140) и ссылок (#5226):
 *
 *   - значение совпало — строка не трогается;
 *   - отличается — обновляется имеющаяся строка, новая не вставляется;
 *   - пустое поле — не трогается (до сверки дело не доходит);
 *   - пробел " " (у BOOLEAN ещё false/-1) — значение удаляется;
 *   - дубли прошлых импортов: остаётся первая строка со значением из файла, прочие удаляются;
 *   - новая запись — вставка, как прежде.
 *
 * Решение принимает Import_req_set_plan() из include/import_reconcile.php, применяет -
 * Import_req_set(); их зовёт ядро (index.php и integram.io/index.php).
 *
 * Запуск (база не нужна):
 *   php experiments/issue-5236-bki-req-set.test.php
 */

mb_internal_encoding("UTF-8");

$GLOBALS['z'] = "testdb";
function t9n($s) { return $s; }

# Заглушки операций ядра: журнал вызовов вместо базы
$ops = array();
function Insert_batch($up, $ord, $t, $val, $message) { global $ops; $ops[] = array("insert", $up, $t, $val); }
function Update_Val($id, $val) { global $ops; $ops[] = array("update", $id, $val); }
function Delete($id) { global $ops; $ops[] = array("delete", $id); }

require_once __DIR__ . '/../include/delimiters.php';
require_once __DIR__ . '/../include/import_reconcile.php';

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

foreach (array('Import_req_set_plan', 'Import_req_set') as $fn)
    if (!function_exists($fn)) {
        echo "  FAIL $fn() нет в include/import_reconcile.php\n";
        exit(1);
    }

# Строки реквизита после плана: id строки => значение. Новой строке даём id 900.
function apply_plan($have, $plan)
{
    foreach ($plan["delete"] as $rowId)
        unset($have[$rowId]);
    if ($plan["update"] !== NULL)
        $have[$plan["update"][0]] = $plan["update"][1];
    if ($plan["insert"] !== NULL)
        $have[900] = $plan["insert"];
    return $have;
}

echo "=== Таблица случаев: было в базе × пришло в файле → стало ===\n";

$cases = array(
    # [было: строка => значение], значение из файла, очистка?, [стало], описание
    array(array(11 => "120"),                          "120", FALSE, array(11 => "120"),  "совпало → та же строка"),
    array(array(11 => "120"),                          "95",  FALSE, array(11 => "95"),   "изменилось → обновлена та же строка"),
    array(array(11 => "120"),                          " ",   TRUE,  array(),             "пробел → значение удалено"),
    array(array(11 => "X"),                            "false", TRUE, array(),            "BOOLEAN false → значение удалено"),
    array(array(11 => "120", 12 => "120", 13 => "7"),  "120", FALSE, array(11 => "120"),  "дубли прошлых импортов → одна строка"),
    array(array(11 => "5", 12 => "120"),               "120", FALSE, array(11 => "120"),  "дубли с разными значениями → первая строка, значение из файла"),
    array(array(),                                     "120", FALSE, array(900 => "120"), "значения не было → вставка"),
    array(array(),                                     " ",   TRUE,  array(),             "значения не было, пробел → ничего"),
);
foreach ($cases as $c) {
    list($have, $value, $clear, $expected, $label) = $c;
    check($expected, apply_plan($have, Import_req_set_plan($have, $value, $clear)), $label);
}

echo "\n=== Повторный импорт того же значения ничего не пишет ===\n";

$plan = Import_req_set_plan(array(11 => "120"), "120", FALSE);
check(array("delete" => array(), "update" => NULL, "insert" => NULL), $plan, "план пуст");

echo "\n=== Import_req_set: операции над базой ===\n";

$ops = array();
$have = array(11 => "120", 12 => "120");
Import_req_set(7001, 8456, "120", FALSE, $have, "Import req");
check(array(array("delete", 12)), $ops, "существующая запись с дублем: удалён дубль, вставок нет");
check(array(11 => "120"), $have, "набор строк записи обновлён");

$ops = array();
Import_req_set(7001, 8456, "120", FALSE, $have, "Import req");
check(array(), $ops, "тот же файл ещё раз: ни одной операции");

$ops = array();
Import_req_set(7001, 8456, "95", FALSE, $have, "Import req");
check(array(array("update", 11, "95")), $ops, "новое значение: Update_Val имеющейся строки");

$ops = array();
$none = NULL;
Import_req_set(7002, 8456, "120", FALSE, $none, "Import req");
check(array(array("insert", 7002, 8456, "120")), $ops, "новая запись (набор NULL): вставка, как прежде");

echo "\n";
echo $failed ? "ПРОВАЛЕНО: $failed\n" : "Все проверки прошли\n";
exit($failed ? 1 : 0);
