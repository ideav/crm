<?php
/**
 * Issue #5226: повторный BKI-импорт дублировал ссылки существующей записи.
 *
 * Фаза данных BKI вставляла каждую ссылку из файла, не глядя на ссылки, которые у записи
 * уже есть: партия 7001 со втулкой 5003 после трёх импортов того же файла выгружалась как
 * «5003,5003,5003,5003». Правило владельца для ссылочного реквизита:
 *
 *   - ссылка, которая уже есть в наборе записи, повторно не вставляется (и повтор внутри
 *     поля файла — тоже одна ссылка);
 *   - переданный набор заменяет старый: лишние ссылки удаляются, общие остаются той же
 *     строкой (id строки-ссылки не меняется);
 *   - пустое поле — ссылки не трогаются (до разбора ссылок дело не доходит);
 *   - пробел " " — все ссылки записи по реквизиту удаляются (как в табличном импорте).
 *
 * Решение «что удалить, что вставить» принимает Import_ref_set_plan() из
 * include/import_reconcile.php — её же зовёт ядро (index.php и
 * experiments/index_integram.io.php) через Import_ref_set().
 *
 * Запуск (база не нужна):
 *   php experiments/issue-5226-bki-ref-set.test.php
 */

mb_internal_encoding("UTF-8");

$GLOBALS['z'] = "testdb";
function t9n($s) { return $s; }

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

if (!function_exists('Import_ref_set_plan')) {
    echo "  FAIL Import_ref_set_plan() нет в include/import_reconcile.php\n";
    exit(1);
}

# Набор после применения плана: строки базы минус удалённые, плюс вставленные цели.
# $have — id строки-ссылки => id цели. Новым строкам даём id 900+.
function apply_plan($have, $plan)
{
    foreach ($plan["delete"] as $rowId)
        unset($have[$rowId]);
    $next = 900;
    foreach ($plan["insert"] as $target)
        $have[$next++] = $target;
    return $have;
}

function targets($have)
{
    $v = array_values($have);
    sort($v);
    return $v;
}

echo "=== Таблица случаев: было в базе × пришло в файле → стало ===\n";

$cases = array(
    # [было: строка => цель], [цели из файла], [стало, отсортировано], описание
    array(array(11 => 5003),             array(5003),             array(5003),       "{5003} × 5003 → {5003}"),
    array(array(11 => 5003),             array(5003, 5002),       array(5002, 5003), "{5003} × 5003,5002 → {5003,5002}"),
    array(array(11 => 5003, 12 => 5002), array(5002),             array(5002),       "{5003,5002} × 5002 → {5002}"),
    array(array(),                       array(5003, 5003),       array(5003),       "новая запись × 5003,5003 → {5003}"),
    array(array(11 => 5003),             array(),                 array(),           "{5003} × пробел → {}"),
    array(array(11 => 5003, 12 => 5003, 13 => 5003), array(5003), array(5003),       "дубли прошлых импортов × 5003 → {5003}"),
    array(array(11 => 5003),             array(0, 5002),          array(5002),       "нулевой id в файле не ссылка"),
);
foreach ($cases as $c) {
    list($have, $incoming, $expected, $label) = $c;
    check($expected, targets(apply_plan($have, Import_ref_set_plan($have, $incoming))), $label);
}

echo "\n=== Общие ссылки остаются той же строкой ===\n";

$plan = Import_ref_set_plan(array(11 => 5003, 12 => 5002), array(5003, 5001));
check(array(12), $plan["delete"], "удаляется только строка лишней цели 5002");
check(array(5001), $plan["insert"], "вставляется только новая цель 5001");

$plan = Import_ref_set_plan(array(11 => 5003, 12 => 5003), array(5003));
check(array(12), $plan["delete"], "из дублей остаётся первая строка (11), вторая удаляется");
check(array(), $plan["insert"], "имеющаяся цель не вставляется повторно");

$plan = Import_ref_set_plan(array(11 => 5003), array(5003, 5003, 5003));
check(array(), $plan["delete"], "повторный импорт того же файла ничего не удаляет");
check(array(), $plan["insert"], "повторный импорт того же файла ничего не вставляет");

$plan = Import_ref_set_plan(array(), array(5004, 5002, 5004, 5003));
check(array(5004, 5002, 5003), $plan["insert"], "новая запись: порядок файла, без повторов");

echo "\n";
echo $failed ? "ПРОВАЛЕНО: $failed\n" : "Все проверки прошли\n";
exit($failed ? 1 : 0);
