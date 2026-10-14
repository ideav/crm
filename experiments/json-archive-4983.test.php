<?php
/**
 * issue #4983 — JSON-архив v2: одна запись на строку файла, ключи строк по коротким
 * именам (алиасам), каноничные целые — числами, пустых значений в строке нет.
 *
 * Повод: выгрузка журнала планирования на 7,7 МБ нечитаема — каждое поле на своей строке
 * с отступом в 4 пробела, а имена колонок журнала длинные ("Журнал.Сессия"), хотя у них
 * есть короткие алиасы ("Сессия").
 *
 * Прогон: php experiments/json-archive-4983.test.php
 * В гейт заходит через experiments/json-archive-4983.test.js.
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
# local_struct журнала планирования: имена колонок с префиксом "Журнал.",
# короткие подписи — алиасами в attrs (как в живой базе, issue #4983)
# ---------------------------------------------------------------------------
$struct = array(
	665850 => array(
		0 => "665850:Журнал:SHORT",
		665852 => MaskDelimiters("Журнал.Сессия").":SHORT:".MaskDelimiters('{"alias":"Сессия"}'),
		665856 => MaskDelimiters("Журнал.Событие").":SHORT:".MaskDelimiters('{"alias":"Событие"}'),
		665858 => "ref:665858:9001:".MaskDelimiters('{"alias":"Задание"}'),
		665866 => MaskDelimiters("Журнал.Было").":NUMBER:".MaskDelimiters('{"alias":"Было"}'),
		665868 => MaskDelimiters("Журнал.Стало").":NUMBER:".MaskDelimiters('{"alias":"Стало"}'),
		665870 => "arr:1090:".MaskDelimiters('{"alias":"Детали"}')
	),
	9001 => array(0 => "9001:18"),
	18 => array(0 => "18:Задание:SHORT"),
	1090 => array(0 => "1090:Строки:SHORT")
);
$columns = JsonArchiveColumnsFromStruct($struct, 665850);

# ---------------------------------------------------------------------------
# 1. Короткие имена колонок v2: алиас, иначе имя; одноимённые уточняются id
# ---------------------------------------------------------------------------
same("Журнал.Сессия", $columns[0]["name"], "полное имя колонки — с префиксом таблицы");
same("Сессия", JsonArchiveShortName($columns[0]), "короткое имя — алиас из attrs");
same("Задание", JsonArchiveShortName($columns[2]), "у ссылки короткое имя совпадает с именем колонки");
same("Детали", JsonArchiveShortName($columns[5]), "у подчинённой таблицы — её алиас");

$coll = $struct;
$coll[665850][665871] = MaskDelimiters("День").":DATE:".MaskDelimiters('{"alias":"Сессия"}');
$collColumns = JsonArchiveColumnsFromStruct($coll, 665850);
same("Сессия#665852", JsonArchiveShortKey($collColumns[0], $collColumns), "одноимённые короткие имена уточняются id");
same("Сессия#665871", JsonArchiveShortKey($collColumns[6], $collColumns), "второе одноимённое — тоже");
same("Сессия", JsonArchiveShortKey($columns[0], $columns), "однозначное короткое имя — без уточнения");

# ---------------------------------------------------------------------------
# 2. Строка v2: каноничные целые — числами, пустого ключа нет, "007" — строкой
# ---------------------------------------------------------------------------
$row = JsonArchiveV2Row("1786009198", array(
	"Сессия" => "applySplitPlan-1786009195",
	"Событие" => "RUNS_CHANGE",
	"Задание" => "666541",
	"Было" => "4",
	"Стало" => "0",
	"Детали" => "",
	"ПустойСписок" => array(),
	"Мульти" => array("12", "007")
));
same(array(
	"val" => 1786009198,
	"Сессия" => "applySplitPlan-1786009195",
	"Событие" => "RUNS_CHANGE",
	"Задание" => 666541,
	"Было" => 4,
	"Стало" => 0,
	"Мульти" => array(12, "007")
), $row, "строка v2: число числом, пустые значения без ключа, 007 остаётся строкой");

same("007", JsonArchiveV2Number("007"), "ведущие нули — строкой");
same("1000000000000000", JsonArchiveV2Number("1000000000000000"), "16 цифр — строкой");
same(999999999999999, JsonArchiveV2Number("999999999999999"), "15 цифр — числом");
same(-42, JsonArchiveV2Number("-42"), "отрицательное каноничное — числом");
same(0, JsonArchiveV2Number("0"), "ноль — числом");
same("3.14", JsonArchiveV2Number("3.14"), "нецелое — строкой");
same("+5", JsonArchiveV2Number("+5"), "плюс — строкой");
same("1e5", JsonArchiveV2Number("1e5"), "экспонента — строкой");
same(" 5", JsonArchiveV2Number(" 5"), "пробел — строкой");
same("2026-09-01", JsonArchiveV2Number("2026-09-01"), "дата — строкой");

# ---------------------------------------------------------------------------
# 3. types несут полное имя, а рядом — алиас, по которому значение лежит в строке
# ---------------------------------------------------------------------------
$types = JsonArchiveTypesFromStruct($struct);
$byId = array();
foreach($types["665850"]["reqs"] as $req)
	$byId[$req["id"]] = $req;
same("Журнал.Сессия", $byId[665852]["name"], "в types — полное имя колонки");
same("Сессия", $byId[665852]["alias"], "алиас рядом — по нему ключ в строке v2");
ok(!isset($byId[665858]["alias"]), "у ссылки alias-ключа нет: её имя и так короткое");

# ---------------------------------------------------------------------------
# 4. Кодирование v2: шапка с отступами, записи — по одной строке файла
# ---------------------------------------------------------------------------
$doc = array(
	"format" => JSON_ARCHIVE_FORMAT, "version" => JSON_ARCHIVE_VERSION,
	"db" => "ateh", "exported" => "2026-10-14T10:00:00+03:00", "table" => 665850,
	"readme" => "rows: одна запись на строку; ключ val — значение главной колонки, остальные ключи — реквизиты по алиасам из types; отсутствующий ключ = пусто",
	"types" => array("665850" => array("id" => 665850, "name" => "Журнал", "base" => "SHORT", "reqs" => array())),
	"rows" => array(
		array("val" => 1786009198, "Сессия" => "applySplitPlan-1786009195", "Событие" => "RUNS_CHANGE", "Было" => 4, "Стало" => 0),
		array("val" => 1786009199, "Сессия" => "applySplitPlan-1786009195", "Событие" => "RUNS_CHANGE", "Было" => 0, "Стало" => 4, "Детали" => "строка 1\nстрока 2")
	)
);
$text = JsonArchiveEncode($doc);
$lines = explode("\n", $text);
same(array(
	'        {"val":1786009198,"Сессия":"applySplitPlan-1786009195","Событие":"RUNS_CHANGE","Было":4,"Стало":0},',
	'        {"val":1786009199,"Сессия":"applySplitPlan-1786009195","Событие":"RUNS_CHANGE","Было":0,"Стало":4,"Детали":"строка 1\nстрока 2"}'
), array_slice($lines, -4, 2), "записи — по одной строке файла, кириллица как есть");
same('    "format": "integram-archive",', $lines[1], "шапка — с отступами, как в v1");
$back = JsonArchiveDecode($text);
same($doc["rows"], $back["rows"], "закодированный v2 читается обратно без потерь");

$empty = JsonArchiveEncode(array("format" => JSON_ARCHIVE_FORMAT, "version" => 2, "rows" => array()));
ok(substr_count($empty, '"rows": []') === 1, "пустые rows — одной строкой");

$v1text = JsonArchiveEncode(array("format" => JSON_ARCHIVE_FORMAT, "version" => 1, "rows" => array(array("val" => "x", "fields" => array("A" => "1")))));
$v1want = '{
    "format": "integram-archive",
    "version": 1,
    "rows": [
        {
            "val": "x",
            "fields": {
                "A": "1"
            }
        }
    ]
}';
same($v1want, $v1text, "документ v1 кодируется как раньше — с отступами у каждого поля");

throws(function(){ JsonArchiveDecode('{"format":"integram-archive","version":3,"rows":[]}'); }, "версия новее поддерживаемой (3 больше 2) отвергается");
$d2 = JsonArchiveDecode('{"format":"integram-archive","version":2,"rows":[]}');
same(array(), $d2["rows"], "версия 2 читается");

# ---------------------------------------------------------------------------
# 5. Нормализация v2 к внутреннему виду v1
# ---------------------------------------------------------------------------
$doc2 = array(
	"format" => JSON_ARCHIVE_FORMAT, "version" => 2, "table" => 665850,
	"types" => $types,
	"rows" => array(
		array("val" => 1786009198, "Сессия" => "applySplitPlan-1786009195", "Событие" => "RUNS_CHANGE", "Задание" => 666541, "Было" => 4, "Стало" => 0),
		array("val" => "0007", "Сессия" => null, "Журнал.Событие" => "SPLIT", "665866" => "3.14", "Стало" => "12345678901234567890", "Детали" => array("12", "007"))
	)
);
$norm = JsonArchiveNormalize($doc2);
same(array("val" => "1786009198", "fields" => array(
	"Журнал.Сессия" => "applySplitPlan-1786009195",
	"Журнал.Событие" => "RUNS_CHANGE",
	"Задание" => "666541",
	"Журнал.Было" => "4",
	"Журнал.Стало" => "0"
)), $norm["rows"][0], "строка v2 приведена к виду v1: обёртка fields, полные имена, значения строками");
same(array("val" => "0007", "fields" => array(
	"Журнал.Сессия" => null,
	"Журнал.Событие" => "SPLIT",
	"Журнал.Было" => "3.14",
	"Журнал.Стало" => "12345678901234567890",
	"Детали" => array("12", "007")
)), $norm["rows"][1], "null — очистить; полное имя и id колонки принимаются; ведущие нули и длинные числа не искажаются");

$docV1 = array("format" => JSON_ARCHIVE_FORMAT, "version" => 1, "table" => 665850, "types" => $types,
	"rows" => array(array("val" => "x", "fields" => array("Журнал.Сессия" => "s"))));
same($docV1, JsonArchiveNormalize($docV1), "документ v1 возвращается как есть");

# ---------------------------------------------------------------------------
# 6. Круговая: v1 и v2 разбираются в одинаковые значения; файл v2 — импорт без потерь
# ---------------------------------------------------------------------------
$rowV1 = array("val" => "1786009198", "fields" => array(
	"Журнал.Сессия" => "applySplitPlan-1786009195",
	"Журнал.Событие" => "RUNS_CHANGE",
	"Задание" => "666541",
	"Журнал.Было" => "4",
	"Журнал.Стало" => "0"
));
$rowV2norm = JsonArchiveNormalize(array(
	"version" => 2, "table" => 665850, "types" => $types,
	"rows" => array(array("val" => 1786009198, "Сессия" => "applySplitPlan-1786009195", "Событие" => "RUNS_CHANGE", "Задание" => 666541, "Было" => 4, "Стало" => 0))
));
$rowV2norm = $rowV2norm["rows"][0];
same(JsonArchiveRowValues($rowV1, $columns), JsonArchiveRowValues($rowV2norm, $columns), "v1 и нормализованный v2 дают одинаковый разбор");
$values = JsonArchiveRowValues($rowV2norm, $columns);
same("4", $values[4], "число из строки v2 разобралось строкой, как в v1");

$fileText = JsonArchiveEncode($doc2);
$cycle = JsonArchiveNormalize(JsonArchiveDecode($fileText));
same(JsonArchiveRowValues($rowV1, $columns), JsonArchiveRowValues($cycle["rows"][0], $columns), "файл v2: кодирование, чтение, нормализация — тот же разбор, что у v1");
same("0007", JsonArchiveRowValues($cycle["rows"][1], $columns)[0], "значение записи с ведущими нулями переживает цикл");

# ---------------------------------------------------------------------------
echo "\nПроверок: $checks\n";
if(count($failed)){
	echo "ПАДАЕТ:\n";
	foreach($failed as $f)
		echo "  - ".$f."\n";
	exit(1);
}
echo "ОК\n";
