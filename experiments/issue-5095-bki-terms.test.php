<?php
/**
 * Issue #5095: импорт BKI не подменял id терминов (реквизитов) в колонках отчётов
 * и id записей-значений справочников в литералах «Значение (от/до)» и WHERE.
 *
 * При переносе запросов между инстансами (кейс #5084) колонка отчёта (тип 28) несёт
 * val = id термина ИСХОДНОЙ базы. Свод структуры находит каждому реквизиту аналог по
 * подписи, но связку «данные -> структура» никто не применял: реквизит, существующий
 * в цели под другим id, терялся - отчёт падал или молча считал не то. Сверх того,
 * subst-строки заголовка вообще не разбирались: разбор спотыкался о IsOccupied("subst")
 * и умирал на SQL-ошибке, так что файл с колонками отчётов не импортировался вовсе.
 *
 * Запуск (модуль чистый, база не нужна):
 *   php experiments/test-issue-5095-bki-terms.php
 *
 * Проверяемые функции берутся из include/import_reconcile.php - того же кода, что
 * исполняет ядро, без копий.
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
function check_true($cond, $message) { check(true, (bool)$cond, $message); }

# Разобрать строку файла так, как это делает импорт: спрятать экранированные разделители,
# резать по настоящим, снять экранирование полей. Возвращает
# [поля строки (unhidden), raw-поля ПЕРВОГО поля (hidden) - как их держит разбор ядра].
function parse_line($line)
{
    $object = explode(";", HideDelimiters($line));
    array_pop($object);                     # пустой элемент после последнего ";"
    $typ = explode(":", $object[0]);
    $unhidden = array();
    foreach ($object as $value)
        $unhidden[] = UnHideDelimiters($value);
    return array($unhidden, $typ);
}

echo "=== Import_map_terms: связка терминов файла с местными реквизитами ===\n";

# Схема файла: «Распределение» (5770) и «Табельный номер» (2062) из кейса #5084.
# local_types - то, что оставляет свод структуры: [<тип файла>][<позиция>] = местный реквизит.
# В цели «Занятость» живёт под 16408, «С» - 16410, «По» - 16412, «Сотрудник» - 16415;
# совпавшие реквизиты (Проект 13869, Статус найма 6388) - под своими id.
$imported = array();
foreach (array(
    "5770:Распределение:SIGNED:unique;Занятость:SIGNED;С:DATE;По:DATE;ref:13869:13868;Проект:SIGNED;",
    "2062:Табельный номер:SHORT:unique;Сотрудник:SHORT;СНИЛС:CHARS;Дата приема:DATE:\:KEY\:;ref:6388:6387;Статус найма:SIGNED;",
) as $line) {
    list($fields, ) = parse_line($line);
    $obj = explode(":", HideDelimiters($line))[0];
    foreach ($fields as $order => $value)
        $imported[explode(":", $obj)[0]][$order] = $value;
}
$local_types = array(
    5770 => array(1 => 16408, 2 => 16410, 3 => 16412, 4 => 13869, 5 => 13869),
    2062 => array(1 => 16415, 2 => 2068, 3 => 34990, 4 => 6388, 5 => 6388),
);

# subst-строки заголовка; в imported_terms попадают raw-поля - ровно как в патче разбора
$subst_lines = array(
    "subst:13871:5770:Занятость:SIGNED;",
    "subst:16498:5770:С:DATE;",
    "subst:16500:5770:По:DATE;",
    "subst:13869:5770:ref:13869:13868;",
    "subst:2063:2062:Сотрудник:SHORT;",
    "subst:2069:2062:Дата приема:DATE:\:KEY\:;",
    "subst:6388:2062:ref:6388:6387;",
    "subst:16408:13867:ref:16408:16407;",
    "subst:9999:5770:Нет такого:SIGNED;",
);
$terms = array();
foreach ($subst_lines as $line) {
    list(, $typ) = parse_line($line);
    $terms[] = $typ;
}

$warning = "";
$local_struct = array("subst" => array());
Import_map_terms($terms, $imported, $local_types, $local_struct, $warning);

$subst = $local_struct["subst"];
check(16408, $subst[13871], "13871 Занятость -> местный 16408");
check(16410, $subst[16498], "16498 С -> местный 16410");
check(16412, $subst[16500], "16500 По -> местный 16412");
check(13869, $subst[13869], "13869 Проект (ссылка, id совпали) -> 13869");
check(16415, $subst[2063],  "2063 Сотрудник -> местный 16415");
check(34990, $subst[2069],  "2069 Дата приема (атрибуты за экранированным :) -> местный 34990");
check(6388,  $subst[6388],  "6388 Статус найма (ссылка, id совпали) -> 6388");
check_true(!isset($subst[16408]), "термин без владельца в файле (16408) не связывается");
check_true(strpos($warning, "9999") !== false, "ненайденный термин - в warnings (id 9999)");
check_true(strpos($warning, "16408") !== false, "термин без владельца - в warnings");
check(2, substr_count($warning, "<br>"), "предупреждений ровно два: 9999 и бесхозяйный 16408");

# Подмена однократная: в subst лежит ГОТОВЫЙ местный id, цепочки не раскрываются.
# 13869 - одновременно термин файла и исходный id другого реквизита: дважды подменять нельзя.
$local_struct2 = array("subst" => array());
$terms2 = array();
foreach (array("subst:100:5770:Занятость:SIGNED;", "subst:13869:5770:ref:13869:13868;") as $line) {
    list(, $typ) = parse_line($line);
    $terms2[] = $typ;
}
$local_types2 = array(5770 => array(1 => 13869, 4 => 13869));
$w2 = "";
Import_map_terms($terms2, $imported, $local_types2, $local_struct2, $w2);
check(13869, $local_struct2["subst"][100], "подмена однократная: 100 -> 13869 без раскрытия цепочек");

echo "\n=== Import_lit_fields: разметка полей-литералов ===\n";

$imported3 = array();
foreach (array(
    "22:Запрос:SHORT:unique;arr:28;Интерактивный:BOOLEAN;Если пусто, вернуть:CHARS;URL:CHARS;URL_POST:CHARS;URL_HEADER:CHARS;arr:44;WHERE:CHARS;HAVING:CHARS;ORDER BY:CHARS;LIMIT:SHORT;",
    "28:Колонки запроса:REPORT_COLUMN;Имя в отчете:SHORT;Формула:CHARS;Значение (от):CHARS;Значение (до):CHARS;Функция:SHORT;",
) as $line) {
    list($fields, ) = parse_line($line);
    $obj = explode(":", HideDelimiters($line))[0];
    foreach ($fields as $order => $value)
        $imported3[explode(":", $obj)[0]][$order] = $value;
}
$lit = Import_lit_fields($imported3);
check_true(isset($lit[28][3]) && isset($lit[28][4]), "28: Значение (от)/(до) - литеральные (позиции 3,4)");
check_true(isset($lit[22][8]) && isset($lit[22][9]), "22: WHERE/HAVING - литеральные (позиции 8,9)");
check_true(!isset($lit[28][2]), "28: Формула - не литеральная (там имена, не id)");
check_true(!isset($lit[22][10]), "22: ORDER BY - не литеральный");

echo "\n=== Import_subst_literals: подмена значений справочников в IN() ===\n";

$subst_map = array(6406 => 77001);                 # Вакансия уехала под другим id
$exists = function($id) { return $id === 6804; };  # 6804 Работает есть в базе под своим id
$w4 = "";
check("IN(77001,6804)", Import_subst_literals("IN(6406,6804)", $subst_map, $exists, 10, $w4),
    "IN(6406,6804) -> IN(77001,6804)");
check_true($w4 === "", "найденные значения - без предупреждений");

$w4 = "";
check("IN(6406,6804)", Import_subst_literals("IN(6406,6804)", array(),
    function($id){ return in_array($id, array(6406, 6804)); }, 10, $w4),
    "без карты совпавший id остаётся");
check_true($w4 === "", "существующий в базе id - без предупреждений");

$w4 = "";
check("IN(6406,9999)", Import_subst_literals("IN(6406,9999)", array(), function(){ return false; }, 10, $w4),
    "неизвестное значение остаётся как есть");
check_true(strpos($w4, "9999") !== false, "неизвестное значение - в warnings");

check("IN('Вакансия','Работает')",
    Import_subst_literals("IN('Вакансия','Работает')", array(), $exists, 10, $w4),
    "имена в IN() не трогаются");
check("Работает", Import_subst_literals("Работает", $subst_map, $exists, 10, $w4), "значение-имя не трогается");
check("%", Import_subst_literals("%", $subst_map, $exists, 10, $w4), "шаблон не трогается");
check(">[TODAY]", Import_subst_literals(">[TODAY]", $subst_map, $exists, 10, $w4), "макрос не трогается");
check("IN()", Import_subst_literals("IN()", $subst_map, $exists, 10, $w4), "пустой IN() не трогается");
check("a1.val>5 AND a2.val IN(77001,6804)",
    Import_subst_literals("a1.val>5 AND a2.val IN(6406,6804)", $subst_map, $exists, 10, $w4),
    "числа вне списка IN() не трогаются - список внутри подменяется");
check("IN( 77001,6804 )", Import_subst_literals("IN( 6406 , 6804 )", $subst_map, $exists, 10, $w4),
    "пробелы по краям списка сохраняются, внутренние нормируются");

echo "\n=== Разбор заголовка: subst-строка опознаётся до IsOccupied ===\n";
# Раньше subst-строка уходила в IsOccupied("subst") и роняла импорт на SQL-ошибке.
# Патч разбора обязан узнавать её до того, как строка попадёт в imported.
$buf = "subst:13871:5770:Занятость:SIGNED;\r\n";
list(, $typ) = parse_line($buf);
check("subst", $typ[0], "первое поле subst-строки - маркер subst");
check_true((int)$typ[1] > 0 && (int)$typ[2] > 0, "за маркером идут ТЕРМИН и ВЛАДЕЛЕЦ");
check("Занятость:SIGNED", UnHideDelimiters(implode(":", array_slice($typ, 3))),
    "подпись термина восстанавливается из raw-полей");

echo "\n";
echo $failed ? "ПРОВАЛЕНО: $failed\n" : "Все проверки прошли\n";
exit($failed ? 1 : 0);
