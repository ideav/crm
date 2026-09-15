<?php
/**
 * issue #4968 — JSON-архив таблицы: поведение чистого слоя формата (include/json_archive.php)
 * и обратимость экранирования разделителей (include/delimiters.php).
 *
 * Прогон: php experiments/json-archive-4968.test.php
 * В гейт заходит через experiments/json-archive-4968.test.js, который запускает этот файл.
 */

require_once __DIR__ . "/../include/json_archive.php";

$checks = 0;
$failed = array();

function ok($condition, $message){
	global $checks, $failed;
	$checks++;
	if(!$condition)
		$failed[] = $message;
}
function same($expected, $actual, $message){
	global $checks, $failed;
	$checks++;
	if($expected !== $actual)
		$failed[] = $message." — ожидалось ".var_export($expected, true).", получено ".var_export($actual, true);
}
function throws($fn, $message){
	global $checks, $failed;
	$checks++;
	try{
		$fn();
	}
	catch(JsonArchiveError $e){
		return;
	}
	$failed[] = $message." — исключения не было";
}

# ---------------------------------------------------------------------------
# 1. Экранирование разделителей обратимо
# ---------------------------------------------------------------------------
# Значение с текстом "%3B" внутри (обычное дело для URL) не должно превращаться в ";".
$urly = "https://host/path?a=1%3Bb&c=2%3Ad";
same($urly, UnMaskDelimiters(MaskDelimiters($urly)), "URL-кодированное значение переживает Mask/UnMask");
same($urly, UnHideDelimiters(HideDelimiters($urly)), "URL-кодированное значение переживает Hide/UnHide");
foreach(array("a;b", "a:b", "a\\b", "a,b", "a\\;b", "x%2Cy", "%5C", "обычное") as $sample)
	same($sample, UnMaskDelimiters(MaskDelimiters($sample)), "Mask/UnMask обратимы для ".var_export($sample, true));

# Разбор по-прежнему режет только настоящие разделители
$masked = MaskDelimiters("a;b").";".MaskDelimiters("c:d").";";
$fields = UnHideDelimiters(explode(";", HideDelimiters($masked)));
same(3, count($fields), "экранированный ';' не делит поле");
same("a;b", UnMaskDelimiters($fields[0]), "первое поле собрано обратно");
same("c:d", UnMaskDelimiters($fields[1]), "второе поле собрано обратно");

# ---------------------------------------------------------------------------
# 2. Разбор строк локальной структуры
# ---------------------------------------------------------------------------
$head = JsonArchiveParseTypeHead("1076:".MaskDelimiters("Заказы: 2026").":SHORT:unique");
same(1076, $head["id"], "id типа");
same("Заказы: 2026", $head["name"], "имя типа с двоеточием разобрано");
same("SHORT", $head["base"], "базовый тип");
ok($head["unique"], "признак уникальности");

$field = JsonArchiveParseReq(1077, MaskDelimiters("Цена; руб").":NUMBER:".MaskDelimiters(":KEY:"));
same("field", $field["kind"], "обычный реквизит");
same("Цена; руб", $field["name"], "имя реквизита с точкой с запятой");
same("NUMBER", $field["base"], "база реквизита");
same(":KEY:", $field["attrs"], "attrs реквизита");

$ref = JsonArchiveParseReq(1078, "ref:1078:9001:".MaskDelimiters(":MULTI:"));
same("ref", $ref["kind"], "ссылочный реквизит");
same(9001, $ref["refRow"], "строка-ссылка");
same(":MULTI:", $ref["attrs"], "attrs ссылки");

$arr = JsonArchiveParseReq(1079, "arr:1090:");
same("arr", $arr["kind"], "подчинённая таблица");
same(1090, $arr["type"], "тип подчинённой таблицы");

# ---------------------------------------------------------------------------
# 3. Колонки типа
# ---------------------------------------------------------------------------
# local_struct в том виде, в каком его строит constructHeader
$struct = array(
	1076 => array(
		0 => "1076:Заказы:SHORT:unique",
		1077 => "Дата:DATE:".MaskDelimiters(":KEY:"),
		1081 => "Дата:DATETIME",
		1078 => "ref:1078:9001:".MaskDelimiters(":MULTI:"),
		1082 => "ref:1082:9002:".MaskDelimiters(":ALIAS=Менеджер:"),
		1079 => "arr:1090:"
	),
	9001 => array(0 => "9001:2001"),
	2001 => array(0 => "2001:Цвет:SHORT"),
	9002 => array(0 => "9002:18"),
	18 => array(0 => "18:Пользователь:SHORT"),
	1090 => array(0 => "1090:Строки заказа:SHORT")
);
$columns = JsonArchiveColumnsFromStruct($struct, 1076);
same(5, count($columns), "колонок у типа");
same(array(1077, 1081, 1078, 1082, 1079), array_map(function($c){ return $c["id"]; }, $columns)
	, "порядок колонок совпадает с порядком local_struct");
same("Дата", $columns[0]["name"], "имя обычной колонки");
ok($columns[0]["key"], "колонка с :KEY: — ключевая");
same("Цвет", $columns[2]["name"], "имя ссылочной колонки берётся у целевого типа");
same(2001, $columns[2]["type"], "цель ссылки");
ok($columns[2]["multi"], "мульти-ссылка");
same("Менеджер", $columns[3]["name"], "алиас перекрывает имя цели");
same("Пользователь", $columns[3]["target"], "имя целевой таблицы остаётся под алиасом");
same("Строки заказа", $columns[4]["name"], "имя подчинённой таблицы");

# Ключ колонки: одноимённые колонки уточняются номером
same("Дата#1077", JsonArchiveColumnKey($columns[0], $columns), "одноимённые колонки уточняются id");
same("Дата#1081", JsonArchiveColumnKey($columns[1], $columns), "вторая одноимённая колонка");
same("Цвет", JsonArchiveColumnKey($columns[2], $columns), "уникальное имя не уточняется");

# ---------------------------------------------------------------------------
# 4. Сведение колонок: DATE не должен попадать в DATETIME
# ---------------------------------------------------------------------------
$want = array("kind" => "field", "name" => "Дата", "base" => "DATE");
same(1077, JsonArchiveMatchColumn($want, $columns), "DATE сводится со своей колонкой");
$want = array("kind" => "field", "name" => "Дата", "base" => "DATETIME");
same(1081, JsonArchiveMatchColumn($want, $columns), "DATETIME сводится со своей колонкой, а не с DATE");
$want = array("kind" => "field", "name" => "Дата", "base" => "MEMO");
same(0, JsonArchiveMatchColumn($want, $columns), "колонки с другой базой нет — создавать новую");
$want = array("kind" => "field", "name" => "Нет такой", "base" => "SHORT");
same(0, JsonArchiveMatchColumn($want, $columns), "неизвестная колонка не сводится");
# id колонки — подсказка, но род и форма всё равно проверяются
$want = array("id" => 1077, "kind" => "field", "name" => "Переименована", "base" => "DATE");
same(1077, JsonArchiveMatchColumn($want, $columns), "совпадение по id при том же базовом типе");
$want = array("id" => 1077, "kind" => "ref", "name" => "Цвет", "type" => 2001);
same(1078, JsonArchiveMatchColumn($want, $columns), "id от чужого рода не мешает свести ссылку по цели");
$want = array("kind" => "ref", "name" => "Цвет", "type" => 777);
same(1078, JsonArchiveMatchColumn($want, $columns), "id типов у разных баз свои — решает имя цели");
# Ссылка под алиасом: подпись колонки своя, а свести её должно по имени целевой таблицы
$want = array("kind" => "ref", "name" => "Ответственный", "target" => "Пользователь", "type" => 4242);
same(1082, JsonArchiveMatchColumn($want, $columns), "ссылка под другим алиасом сводится по целевой таблице");
$want = array("kind" => "ref", "name" => "Менеджер", "target" => "Отдел", "type" => 9002);
same(0, JsonArchiveMatchColumn($want, $columns), "совпадение подписи при другой цели ссылку не сводит");

# ---------------------------------------------------------------------------
# 5. Чтение документа
# ---------------------------------------------------------------------------
$doc = JsonArchiveDecode(JsonArchiveEncode(array(
	"format" => JSON_ARCHIVE_FORMAT, "version" => 1, "table" => 1076,
	"types" => array("1076" => array("id" => 1076, "name" => "Заказы", "base" => "SHORT", "reqs" => array(
		array("id" => 1077, "kind" => "field", "name" => "Дата", "base" => "DATE")
	))),
	"rows" => array(array("val" => "Заказ", "fields" => array("Дата" => "2026-09-01")))
)));
same(1076, $doc["table"], "таблица архива");
same(1, count($doc["rows"]), "строки архива");
$wanted = JsonArchiveWantedColumns($doc);
same(1, count($wanted), "колонки архива");
same("Дата", $wanted[0]["name"], "имя колонки архива");

throws(function(){ JsonArchiveDecode("{не json"); }, "битый JSON отвергается");
throws(function(){ JsonArchiveDecode('{"rows":[]}'); }, "документ без format отвергается");
throws(function(){ JsonArchiveDecode('{"format":"integram-archive","version":99,"rows":[]}'); }, "версия новее поддерживаемой отвергается");
throws(function(){ JsonArchiveDecode('{"format":"integram-archive"}'); }, "документ без rows отвергается");
throws(function(){ JsonArchiveDecode('{"format":"integram-archive","rows":[1]}'); }, "строка-не-объект отвергается");
$bom = JsonArchiveDecode(pack("CCC", 0xef, 0xbb, 0xbf).'{"format":"integram-archive","rows":[]}');
same(0, count($bom["rows"]), "BOM снимается");

# ---------------------------------------------------------------------------
# 6. Строка архива раскладывается по локальным колонкам
# ---------------------------------------------------------------------------
$row = array("val" => "Заказ №1", "fields" => array(
	"Дата#1077" => "2026-09-01",
	"Цвет" => array("Красный", "Синий"),
	"Менеджер" => null
));
$values = JsonArchiveRowValues($row, $columns);
same(6, count($values), "значений = имя + 5 колонок");
same("Заказ №1", $values[0], "значение записи");
same("2026-09-01", $values[1], "колонка по ключу с уточнением");
same("", $values[2], "не упомянутая колонка не трогается");
same(array("Красный", "Синий"), $values[3], "мульти-ссылка остаётся массивом имён");
same(JSON_ARCHIVE_CLEAR, $values[4], "null очищает значение");
same("", $values[5], "подчинённая таблица данными не трогается");

# Значения, на которых ломается BKI, проходят как есть
$row = array("val" => "a;b:c\nd", "fields" => array("Дата#1077" => "1%3B2"));
$values = JsonArchiveRowValues($row, $columns);
same("a;b:c\nd", $values[0], "разделители и перевод строки в значении не разбирают строку");
same("1%3B2", $values[1], "значение с %3B не подменяется");

# Пустое имя записи — сигнал удаления по ключу (как пустая первая колонка в BKI)
$values = JsonArchiveRowValues(array("val" => "", "fields" => array("Дата#1077" => "2026-09-01")), $columns);
same("", $values[0], "пустое значение записи доезжает пустым");

# Значение по голому id колонки
$values = JsonArchiveRowValues(array("val" => "x", "fields" => array("1081" => "2026-09-01 10:00")), $columns);
same("2026-09-01 10:00", $values[2], "колонка по голому id");

# Типы значений
$values = JsonArchiveRowValues(array("val" => 42, "fields" => array("Дата#1077" => true, "Дата#1081" => false)), $columns);
same("42", $values[0], "число приводится к строке");
same("1", $values[1], "true — это 1");
same("-1", $values[2], "false — это -1 (принятая в импорте ложь)");

# Пустой массив мульти-ссылки = очистить
$values = JsonArchiveRowValues(array("val" => "x", "fields" => array("Цвет" => array())), $columns);
same(JSON_ARCHIVE_CLEAR, $values[3], "пустой массив мульти-ссылки очищает колонку");

throws(function() use ($columns){
	JsonArchiveRowValues(array("val" => "x", "fields" => array("Дата#1077" => array("a", "b"))), $columns);
}, "массив в не-мульти-колонке отвергается");
throws(function() use ($columns){
	JsonArchiveRowValues(array("val" => "x", "fields" => array("Дата#1077" => array("a" => 1))), $columns);
}, "объект вместо значения отвергается");

# Режим autoParent: первым идёт имя родителя
$values = JsonArchiveRowValues(array("parent" => "Заказ 7", "val" => "поз.1"), $columns, true);
same("Заказ 7", $values[0], "имя родителя первым элементом");
same("поз.1", $values[1], "значение записи следом");

# ---------------------------------------------------------------------------
# 7. Метаданные: структура → архив → обратное сведение
# ---------------------------------------------------------------------------
$types = JsonArchiveTypesFromStruct($struct);
ok(isset($types["1076"]), "тип таблицы попал в архив");
ok(!isset($types["9001"]), "служебная строка-ссылка типом не объявляется");
same(5, count($types["1076"]["reqs"]), "все колонки описаны");
ok($types["1076"]["reqs"][0]["key"], "ключевая колонка помечена");
same("DATE", $types["1076"]["reqs"][0]["base"], "база колонки");
same(2001, $types["1076"]["reqs"][2]["type"], "цель ссылки в метаданных");
ok($types["1076"]["reqs"][2]["multi"], "мульти-ссылка в метаданных");

# Каждая выгруженная колонка сводится обратно ровно со своей
$doc = JsonArchiveDecode(JsonArchiveEncode(array(
	"format" => JSON_ARCHIVE_FORMAT, "version" => JSON_ARCHIVE_VERSION,
	"table" => 1076, "types" => $types, "rows" => array()
)));
foreach(JsonArchiveWantedColumns($doc) as $n => $wantCol)
	same((int)$columns[$n]["id"], JsonArchiveMatchColumn($wantCol, $columns)
		, "колонка ".$wantCol["name"]." сводится сама с собой");

# attrs создаваемого реквизита: выгруженные — как есть, иначе собранные из признаков
same(":KEY:", JsonArchiveAttrs(array("attrs" => ":KEY:", "multi" => false, "key" => true)), "attrs из архива идут как есть");
same("", JsonArchiveAttrs(array("attrs" => "", "multi" => false, "key" => false)), "без признаков attrs пустые");
$built = JsonArchiveAttrs(array("attrs" => "", "multi" => true, "key" => true));
ok(FieldAttrsHasMulti($built), "собранные attrs несут MULTI");
ok(FieldAttrsHasKey($built), "собранные attrs несут KEY");

# ---------------------------------------------------------------------------
# 8. Привязка: переименованная в целевой базе колонка получает значение из архива
# ---------------------------------------------------------------------------
$doc = JsonArchiveDecode(JsonArchiveEncode(array(
	"format" => JSON_ARCHIVE_FORMAT, "version" => JSON_ARCHIVE_VERSION, "table" => 1076,
	"types" => array("1076" => array("id" => 1076, "name" => "Заказы", "base" => "SHORT", "reqs" => array(
		array("id" => 55, "kind" => "field", "name" => "Отгрузка", "base" => "DATE"),
		array("id" => 56, "kind" => "ref", "name" => "Оттенок", "target" => "Цвет", "type" => 77, "multi" => true)
	))),
	"rows" => array(array("val" => "Заказ", "fields" => array("Отгрузка" => "2026-09-01", "Оттенок" => array("Красный"))))
)));
$wanted = JsonArchiveWantedColumns($doc);
same("Цвет", $wanted[1]["target"], "целевая таблица доезжает в архиве");
# «Отгрузка» локально называется «Дата» — сведена вручную (как это делает разбор импорта)
$bound = JsonArchiveBindColumns($doc, $columns, array(0 => 1077, 1 => 1078));
$values = JsonArchiveRowValues($doc["rows"][0], $bound);
same("2026-09-01", $values[1], "значение легло в переименованную колонку");
same(array("Красный"), $values[3], "ссылка легла в колонку с другим алиасом");
same("", $values[2], "не привязанная одноимённая колонка не трогается");
# Колонка, которой в архиве не нашлось пары, значений не получает даже при совпадении имени
$bound = JsonArchiveBindColumns($doc, $columns, array());
same(array("Заказ", "", "", "", "", ""), JsonArchiveRowValues($doc["rows"][0], $bound)
	, "без привязки значения по именам не подбираются");

# ---------------------------------------------------------------------------
if(count($failed)){
	echo "ПРОВАЛЕНО ".count($failed)." из $checks проверок:\n";
	foreach($failed as $message)
		echo "  - $message\n";
	exit(1);
}
echo "json-archive-4968: $checks проверок пройдено\n";
