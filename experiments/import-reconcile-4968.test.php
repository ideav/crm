<?php
/**
 * issue #4968 — разрешение конфликтов при импорте: сведение реквизита архива с реквизитом базы
 * (include/import_reconcile.php).
 *
 * Прогон: php experiments/import-reconcile-4968.test.php
 * В гейт заходит через experiments/import-reconcile-4968.test.js, который запускает этот файл.
 */

require_once __DIR__ . "/../include/delimiters.php";
require_once __DIR__ . "/../include/import_reconcile.php";

$checks = 0;
$failed = array();

function same($expected, $actual, $message){
	global $checks, $failed;
	$checks++;
	if($expected !== $actual)
		$failed[] = $message." — ожидалось ".var_export($expected, true).", получено ".var_export($actual, true);
}

# Структура местного типа: ключ 0 — заголовок, остальные — реквизиты.
$local = array(
	0    => "1076:Заказы:SHORT:unique",
	1077 => "Дата:DATETIME",
	1078 => "Дата отгрузки:DATE:".MaskDelimiters(":KEY:"),
	1079 => "ref:1079:9001:".MaskDelimiters(":MULTI:"),
	1080 => "arr:1090",
	1081 => "Комментарий:MEMO"
);

# ---------------------------------------------------------------------------
# 1. Базовый тип — часть подписи, а не приписка к ней
# ---------------------------------------------------------------------------
# "Дата:DATE" — префикс местной "Дата:DATETIME". Поиск по префиксу сводил колонку даты
# с колонкой даты-времени: значения архива уезжали в чужой реквизит.
same(0, ImportMatchLocalReq("Дата:DATE", $local), "DATE не сводится с DATETIME");
same(1077, ImportMatchLocalReq("Дата:DATETIME", $local), "DATETIME сводится сам с собой");
same(0, ImportMatchLocalReq("Комментарий:SHORT", $local), "SHORT не сводится с MEMO");
same(1081, ImportMatchLocalReq("Комментарий:MEMO", $local), "MEMO сводится сам с собой");
# Имя-префикс чужого имени тоже не совпадение
same(0, ImportMatchLocalReq("Дата отгрузки:DATETIME", $local), "имя-префикс не даёт совпадения по чужому типу");
same(1078, ImportMatchLocalReq("Дата отгрузки:DATE", $local), "реквизит с атрибутами сводится по подписи без атрибутов");
# Заголовок типа в кандидаты не попадает
same(0, ImportMatchLocalReq("1076:Заказы", $local), "заголовок типа не считается реквизитом");
same(0, ImportMatchLocalReq("", $local), "пустая подпись ни с чем не сводится");

# ---------------------------------------------------------------------------
# 2. Подпись ссылки: реквизит и строка-посредник разделены двоеточием
# ---------------------------------------------------------------------------
# Без разделителя подпись "ref:10799001" не совпадала ни с чем, и повторный импорт
# того же архива каждый раз шёл дорогой создания ссылки заново.
same("ref:1079:9001", ImportReqSignature(array("ref", "1079", "9001")), "подпись ссылки разделена двоеточиями");
same(1079, ImportMatchLocalReq(ImportReqSignature(array("ref", "1079", "9001")), $local), "ссылка сводится сама с собой");
same(0, ImportMatchLocalReq(ImportReqSignature(array("ref", "1079", "9002")), $local), "ссылка на другую строку не сводится");
same(0, ImportMatchLocalReq(ImportReqSignature(array("ref", "10799", "001")), $local), "склейка идентификаторов не даёт совпадения");
# Замены идентификаторов, найденные раньше по ходу импорта, входят в подпись
$subst = array("2001" => "1079", "8001" => "9001");
same("ref:1079:9001", ImportReqSignature(array("ref", "2001", "8001"), $subst), "подпись ссылки учитывает замены");
same(1079, ImportMatchLocalReq(ImportReqSignature(array("ref", "2001", "8001"), $subst), $local), "ссылка сводится через замены");

# ---------------------------------------------------------------------------
# 3. Подписи обычного реквизита и подтаблицы
# ---------------------------------------------------------------------------
same("Дата:DATETIME", ImportReqSignature(array("Дата", "DATETIME")), "подпись обычного реквизита — имя и базовый тип");
same("arr:1090", ImportReqSignature(array("arr", "1090")), "подпись подтаблицы — тип записей");
same(1080, ImportMatchLocalReq(ImportReqSignature(array("arr", "1090")), $local), "подтаблица сводится сама с собой");
same("arr:1090", ImportReqSignature(array("arr", "3090"), array("3090" => "1090")), "подпись подтаблицы учитывает замену");

# ---------------------------------------------------------------------------
# 4. Имя из файла сравнивается с базой в снятом виде
# ---------------------------------------------------------------------------
# В файле имя экранировано, а разбор строки прячет экранированные разделители в маркеры.
# Поиск типа по такому имени не находил существующий и заводил дубль, а в имя нового
# типа уезжали служебные символы.
$name = "Цена: с НДС; итого";
$inFile = HideDelimiters(MaskDelimiters($name));
same($name, ImportDbName($inFile), "имя из файла возвращается в виде, в каком лежит в базе");
same($name, ImportDbName(MaskDelimiters($name)), "снятие экранирования работает и без маркеров");
same("Обычное имя", ImportDbName("Обычное имя"), "имя без разделителей не меняется");

# ---------------------------------------------------------------------------
if(count($failed)){
	echo "ПРОВАЛЕНО ".count($failed)." из $checks проверок:\n";
	foreach($failed as $message)
		echo "  - $message\n";
	exit(1);
}
echo "import-reconcile-4968: $checks проверок пройдено\n";
