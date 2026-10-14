<?php
/**
 * Issue #963: обрезанная выгрузка BKI роняла импорт фатально и молча теряла реквизиты.
 *
 * Файл из тикета (data_export (6).bki.txt, перенос запросов HR-базы в r7ohr) несёт в
 * хвосте, после строк данных, целую HTML-страницу: выгрузка оборвалась, браузер дописал
 * к файлу страницу логина. Разбор данных добирался до строки "<!DOCTYPE html>", считал
 * её типом, count($GLOBALS["imported"][0]) падал фатальным TypeError'ом - и импорт умирал
 * ДО финального флаша отложенного батча (Insert_batch копит реквизиты строк, флаш - одна
 * вставка в конце фазы). Результат на цели (r7ohr): строки-объекты созданы, а ВСЕ
 * значения реквизитов (Имя в отчете, Формула, Значение (от), Скрыть...) потеряны -
 * отчёт не компилируется, раннер падает "Cannot read properties of undefined".
 *
 * До правки разбор данных вычислял тип строки инлайново: строка без типа из схемы
 * файла проходила в count(null) и роняла PHP. Теперь тип строки опознаёт
 * Import_data_line_type() (include/import_reconcile.php) - тот же код, что исполняет
 * ядро, без копий, а неопознанная строка дает флаш батча и my_die с диагнозом
 * (index.php, фаза данных BKI).
 *
 * Запуск (модуль чистый, база не нужна):
 *   php experiments/issue-963-bki-truncated.test.php
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

echo "=== Import_data_line_type: формы строк данных BKI ===\n";

# Разобрать ПЕРВОЕ поле строки данных так, как это делает фаза данных ядра:
# строка уже порезана по ";", первое поле - до первого ":".
function first_field($line)
{
    $object = explode(";", HideDelimiters($line));
    return $object[0];
}

# 1. Обычная строка колонки отчёта из файла #963: тип в первом поле.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("28::2065;Подразделение;;;;;;;;;;;;;"))));
$isref = 999;
check(28, Import_data_line_type($typ, $isref), "28::2065 -> тип 28");
check(0, $isref, "28::2065 - не ссылочная запись");

# 2. Строка запроса с явным id из файла #963.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("22:27237:Пересмотр ЗП;;1;;;;;;;;;500;;;1;;"))));
check(22, Import_data_line_type($typ, $isref), "22:27237:Пересмотр ЗП -> тип 22");

# 3. Ссылочная запись «REF:СТРОКА:ЦЕЛЬ:значение» из файла #963: тип - ВТОРОЕ поле.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("104:63:75:MAX;\r\n"))));
check(63, Import_data_line_type($typ, $isref), "104:63:75:MAX -> тип 63 (второе поле, сдвиг)");
check(104, $isref, "104:63:75:MAX -> isref 104 (исходное первое поле)");

# 4. Ссылочная запись с экранированным значением.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("115:114:42:admin;\r\n"))));
check(114, Import_data_line_type($typ, 	$isref), "115:114:42:admin -> тип 114 (сдвиг)");

# 5. Строка шапки словаря (одна колонка) - обычная форма.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("63:MAX;;\r\n"))));
check(63, Import_data_line_type($typ, $isref), "63:MAX -> тип 63");

# 6. МУСОР из кейса #963: строка "<!DOCTYPE html>" (первое поле HTML-страницы в хвосте
#    файла). До правки это уходило в count(null) и роняло импорт фатально.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("<!DOCTYPE html>"))));
check(0, Import_data_line_type($typ, $isref), "<!DOCTYPE html> -> тип не опознан (0)");

# 7. Прочий мусор: текст без двоеточия и пустое первое поле.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("просто текст без двоеточия\r\n"))));
check(0, Import_data_line_type($typ, $isref), "текст без двоеточия -> 0");

$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field(";\r\n"))));
check(0, Import_data_line_type($typ, $isref), "пустое первое поле -> 0");

# 8. Четыре поля у ОБЫЧНОЙ строки: '22:169:MyRoleMenu' имеет три поля до ';', но строка
#    с экранированным двоеточием в имени тоже не должна сбить опознание: HideDelimiters
#    прячет "\:", поэтому имя с двоеточием не увеличивает число полей.
$typ = UnHideDelimiters(explode(":", HideDelimiters(first_field("22:16501:update\:v2;;1;;;;;;;;;;;;;;\r\n"))));
check(22, Import_data_line_type($typ, $isref), "экранированное ':' в имени не ломает опознание");

echo "\n";
echo $failed ? "ПРОВАЛЕНО: $failed\n" : "Все проверки прошли\n";
exit($failed ? 1 : 0);
