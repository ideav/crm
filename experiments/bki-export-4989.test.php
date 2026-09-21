<?php
/**
 * issue #4989 — выгрузка BKI заканчивается данными, а не HTML-страницей.
 *
 * Прогон: php experiments/bki-export-4989.test.php
 * В гейт заходит через experiments/bki-export-4989.test.js (на CI php есть,
 * локально без php — громкий SKIP).
 *
 * Симптом (#4989): в файле data_export.bki после валидных строк шла целая HTML-страница
 * приложения. Причина: ветка BKI в index.php (случай &uni_obj_pages) печатала данные и
 * НЕ ЗАВЕРШАЛА ответ — ветки CSV и JSON кончаются die(), а эта падала дальше по
 * index.php, и страница дорисовывалась в файл выгрузки.
 *
 * Тест берёт exportHeader() и DataExportBki() ИЗ САМОГО ЯДРА (index.php), как
 * experiments/filter_sqli.test.php, а поведение проверяет в ОТДЕЛЬНОМ процессе: выгрузка
 * обязана дописать ровно заголовок + DATA + строки и ЗАВЕРШИТЬ вывод — эхо после вызова
 * не должно попасть в выдачу.
 */

$root = dirname(__DIR__);
$core_path = $root . '/index.php';
$child = ($argc > 1 && $argv[1] === 'child');

# ---- достаём проверяемые функции из ядра ----
$core = file_get_contents($core_path);
$src = '';
foreach (array('exportHeader', 'DataExportBki') as $fn) {
	$start = strpos($core, "\nfunction $fn(");
	if ($start === false)
		die("В ядре index.php нет функции $fn — выгрузка BKI не вынесена из ветки &uni_obj_pages, завершение ответа не проверить (issue #4989)\n");
	$end = strpos($core, "\n}", $start);   # первый } без отступа: у обеих функций внутренние скобки с отступом
	$src .= substr($core, $start, $end - $start + 3) . "\n";
}
eval($src);

# ---- заглушка транспорта: имя файла выгрузки фиксируем, ничего не шлём ----
$GLOBALS["download_name"] = "";
function Download_send_headers($filename) { $GLOBALS["download_name"] = $filename; }

if ($child) {
	$GLOBALS["local_struct"] = array(
		42 => array("Роль", "SHORT"),
		151 => array("Меню:SHORT", "Адрес:CHARS"),
	);
	DataExportBki(array("42:145:admin;;;;\r\n", "151:Таблицы;tables;;\r\n"));
	echo "AFTER-EXPORT-SENTINEL";   # в выдачу попасть не должно: DataExportBki завершает ответ
	exit(0);
}

# ---- родитель: прогоняем ребёнка и проверяем выдачу ----
$cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' child 2>&1';
$out = shell_exec($cmd);

$failed = 0;
function check($condition, $message){
	global $failed;
	if ($condition) { echo "  OK   $message\n"; return; }
	$failed++;
	echo "  FAIL $message\n";
}

check(strpos($out, "В ядре index.php нет функции") === false, "обе функции найдены в ядре");
check(strpos($out, "AFTER-EXPORT-SENTINEL") === false,
	"после данных выгрузка ЗАВЕРШАЕТ ответ — хвост за die() в файл не попадает (#4989)");
check(strpos($out, "<!DOCTYPE") === false && stripos($out, "<html") === false,
	"в выдаче нет HTML-страницы приложения");
check(strpos($out, "Роль;SHORT") !== false, "заголовок структуры на месте (exportHeader)");
check(strpos($out, "DATA\r\n") !== false, "секция DATA на месте");
check(strpos($out, "42:145:admin;;;;") !== false && strpos($out, "151:Таблицы;tables;;") !== false,
	"строки данных выгружаются как есть");

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nВыгрузка BKI чистая: данные и только данные\n";
exit($failed ? 1 : 0);
