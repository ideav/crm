<?php
/**
 * JSON-архив таблицы Интеграма (issue #4968) — выгрузка метаданных и данных и загрузка обратно.
 *
 * Формат BKI — построчный текст с экранированием `;` и `:`, поэтому значение с переводом строки
 * или с разделителем внутри разбирается по длине строки, а не по структуре: строки склеиваются,
 * а колонки сдвигаются. JSON-архив несёт ту же информацию структурой, поэтому экранирование не
 * требуется вовсе.
 *
 * Документ:
 *
 *     {
 *       "format": "integram-archive", "version": 1,
 *       "db": "atex", "exported": "2026-09-15T10:00:00+03:00",
 *       "table": 1076,
 *       "types": {
 *         "1076": {"id":1076, "name":"Заказы", "base":"SHORT", "unique":true, "reqs":[
 *            {"id":1077, "kind":"field", "name":"Дата",  "base":"DATE", "attrs":":KEY:", "key":true},
 *            {"id":1078, "kind":"ref",   "name":"Цвет",  "type":2001, "target":"Цвет", "multi":true},
 *            {"id":1079, "kind":"arr",   "name":"Строки","type":1090, "target":"Строки заказа"}
 *         ]},
 *         "2001": {"id":2001, "name":"Цвет", "base":"SHORT", "reqs":[]}
 *       },
 *       "rows": [
 *         {"id":500123, "val":"Заказ №1", "fields":{"Дата":"2026-09-01", "Цвет":["Красный","Синий"]}}
 *       ]
 *     }
 *
 * Значения в `fields` — как есть, без экранирования. Ссылки задаются ИМЕНАМИ целевых записей
 * (как в сокращённом формате BKI), мульти-ссылка — массивом имён. Ключ колонки — её имя;
 * при совпадении имён в одной таблице — «имя#id»; принимается и голый id колонки.
 *
 * У ссылочной колонки `name` — то, как она подписана (алиас из attrs, иначе имя целевой
 * таблицы), а `target` — всегда имя целевой таблицы: по нему колонка сводится при загрузке
 * в другую базу, где id таблиц свои.
 *
 * Смысл значений повторяет BKI, но задаётся типом, а не текстом:
 *   ключа нет в "fields"  — колонка не трогается;
 *   null                  — значение очищается (в BKI это " ");
 *   ""                    — пустая строка как значение;
 *   "val": ""             — строка удаляется по ключу уникальности (в BKI — пустая первая колонка).
 *
 * Файл чистый: работы с базой и с $GLOBALS здесь нет — всё поведение проверяется
 * experiments/json-archive-4968.test.php.
 */

require_once __DIR__ . "/delimiters.php";
require_once __DIR__ . "/field_attrs.php";

defined("JSON_ARCHIVE_FORMAT")  || define("JSON_ARCHIVE_FORMAT", "integram-archive");
defined("JSON_ARCHIVE_VERSION") || define("JSON_ARCHIVE_VERSION", 1);
# Значение-сигнал «очистить реквизит», которое понимает разбор данных в index.php
defined("JSON_ARCHIVE_CLEAR")   || define("JSON_ARCHIVE_CLEAR", " ");

class JsonArchiveError extends Exception {}

# ---------------------------------------------------------------------------
# Разбор строк локальной структуры ($GLOBALS["local_struct"], см. constructHeader)
# ---------------------------------------------------------------------------

# Разрезать строку по НЕэкранированным двоеточиям
function JsonArchiveSplit($s){
	return UnHideDelimiters(explode(":", HideDelimiters((string)$s)));
}

# Заголовок типа: "<id>:<имя>[:<базовый тип>[:unique]]"
function JsonArchiveParseTypeHead($head){
	$p = JsonArchiveSplit($head);
	return array(
		"id" => (int)$p[0],
		"name" => isset($p[1]) ? UnMaskDelimiters($p[1]) : "",
		"base" => (isset($p[2]) && $p[2] !== "") ? $p[2] : "",
		"unique" => isset($p[3]) && $p[3] === "unique"
	);
}

# Описание реквизита: "ref:<id>:<ссылка>[:attrs]" | "arr:<тип>[:attrs]" | "<имя>:<база>[:attrs]"
function JsonArchiveParseReq($reqId, $s){
	$p = JsonArchiveSplit($s);
	$kind = isset($p[0]) ? $p[0] : "";
	if($kind === "ref")
		return array("id" => (int)$reqId, "kind" => "ref", "refRow" => isset($p[2]) ? (int)$p[2] : 0
					, "attrs" => isset($p[3]) ? UnMaskDelimiters($p[3]) : "");
	if($kind === "arr")
		return array("id" => (int)$reqId, "kind" => "arr", "type" => isset($p[1]) ? (int)$p[1] : 0
					, "attrs" => isset($p[2]) ? UnMaskDelimiters($p[2]) : "");
	if($kind === "subst")	# определение колонки отчёта, данными не является
		return array("id" => (int)$reqId, "kind" => "subst", "attrs" => "");
	return array("id" => (int)$reqId, "kind" => "field", "name" => UnMaskDelimiters($kind)
				, "base" => isset($p[1]) ? $p[1] : "", "attrs" => isset($p[2]) ? UnMaskDelimiters($p[2]) : "");
}

/**
 * Упорядоченный список колонок типа $typeId в том же порядке, в каком их перебирает
 * разбор данных (`foreach($GLOBALS["local_struct"][$id])` без нулевого ключа).
 *
 * Имя ссылочной колонки — алиас из attrs, иначе имя целевого типа: собственного имени
 * у ссылочного реквизита нет, оно берётся от цели.
 */
function JsonArchiveColumnsFromStruct($localStruct, $typeId){
	$columns = array();
	if(!isset($localStruct[$typeId]))
		return $columns;
	foreach($localStruct[$typeId] as $reqId => $s){
		if($reqId === 0 || $reqId === "0")
			continue;
		$col = JsonArchiveParseReq($reqId, $s);
		$attrs = FieldAttrsParse($col["attrs"]);
		$col["key"] = $attrs["key"];
		$col["multi"] = $attrs["multi"];
		if($col["kind"] === "ref")
			$col["type"] = JsonArchiveRefTarget($localStruct, $col["refRow"]);
		if(($col["kind"] === "ref") || ($col["kind"] === "arr")){
			$col["target"] = JsonArchiveTypeName($localStruct, $col["type"]);
			$col["name"] = ($attrs["alias"] !== null && $attrs["alias"] !== "") ? $attrs["alias"] : $col["target"];
		}
		$columns[] = $col;
	}
	return $columns;
}

# Целевой тип ссылки: у строки-ссылки (val='') заголовок имеет вид "<id строки>:<id типа цели>"
function JsonArchiveRefTarget($localStruct, $refRow){
	if(!$refRow || !isset($localStruct[$refRow][0]))
		return 0;
	$p = JsonArchiveSplit($localStruct[$refRow][0]);
	return isset($p[1]) ? (int)$p[1] : 0;
}

function JsonArchiveTypeName($localStruct, $typeId){
	if(!$typeId || !isset($localStruct[$typeId][0]))
		return "";
	$head = JsonArchiveParseTypeHead($localStruct[$typeId][0]);
	return $head["name"];
}

# ---------------------------------------------------------------------------
# Ключи колонок в "fields"
# ---------------------------------------------------------------------------

# Имя колонки, а при совпадении имён в одной таблице — "имя#id"
function JsonArchiveColumnKey($col, $columns){
	$name = isset($col["name"]) ? $col["name"] : "";
	if($name === "")
		return (string)$col["id"];
	$same = 0;
	foreach($columns as $other)
		if(isset($other["name"]) && $other["name"] === $name)
			$same++;
	return $same > 1 ? $name."#".$col["id"] : $name;
}

/**
 * Привязать колонки архива к локальным колонкам: вернуть локальные колонки, дополненные
 * списком ключей `keys`, под которыми значение колонки лежит в "fields" строки архива.
 *
 * Без привязки колонку, переименованную в целевой базе, пришлось бы искать по её локальному
 * имени, которого в архиве нет. $resolved — результат сведения: номер колонки архива => id
 * локальной колонки (включая только что созданные).
 */
function JsonArchiveBindColumns($doc, $columns, $resolved){
	$wanted = JsonArchiveWantedColumns($doc);
	$byLocal = array();
	foreach($wanted as $n => $want){
		if(!isset($resolved[$n]) || !(int)$resolved[$n])
			continue;
		$local = (int)$resolved[$n];
		$keys = array(JsonArchiveColumnKey($want, $wanted), (string)$want["id"]);
		if($want["name"] !== "")
			$keys[] = $want["name"];
		$byLocal[$local] = isset($byLocal[$local]) ? array_merge($byLocal[$local], $keys) : $keys;
	}
	foreach($columns as $n => $col)
		$columns[$n]["keys"] = isset($byLocal[(int)$col["id"]])
								? array_values(array_unique($byLocal[(int)$col["id"]])) : array();
	return $columns;
}

# Значение колонки из "fields" строки. Возвращает array("found"=>bool, "value"=>mixed)
function JsonArchiveFieldValue($fields, $col, $columns){
	if(isset($col["keys"])){	# колонки привязаны — только объявленные ключи, без догадок по имени
		foreach($col["keys"] as $key)
			if(is_array($fields) && array_key_exists($key, $fields))
				return array("found" => true, "value" => $fields[$key]);
		return array("found" => false, "value" => null);
	}
	foreach(array(JsonArchiveColumnKey($col, $columns), (string)$col["id"]) as $key)
		if(is_array($fields) && array_key_exists($key, $fields))
			return array("found" => true, "value" => $fields[$key]);
	# имя без уточнения "#id" — принимаем, если оно однозначно
	if(isset($col["name"]) && $col["name"] !== "" && is_array($fields) && array_key_exists($col["name"], $fields)){
		$same = 0;
		foreach($columns as $other)
			if(isset($other["name"]) && $other["name"] === $col["name"])
				$same++;
		if($same === 1)
			return array("found" => true, "value" => $fields[$col["name"]]);
	}
	return array("found" => false, "value" => null);
}

# ---------------------------------------------------------------------------
# Сведение колонок архива с колонками базы
# ---------------------------------------------------------------------------

/**
 * Найти локальную колонку под колонку архива. Возвращает id локального реквизита или 0.
 *
 * Сравнение — по полному значению, а не по префиксу: "Дата:DATE" НЕ должно попадать в
 * локальную "Дата:DATETIME" (`DATE` — префикс `DATETIME`), иначе дата уезжает в колонку
 * другого типа. Порядок: точное совпадение id (при том же роде колонки), затем имя+база.
 */
function JsonArchiveMatchColumn($want, $columns){
	$kind = isset($want["kind"]) ? $want["kind"] : "field";
	$wantId = isset($want["id"]) ? (int)$want["id"] : 0;
	if($wantId)
		foreach($columns as $col)
			if(((int)$col["id"] === $wantId) && ($col["kind"] === $kind) && JsonArchiveSameShape($want, $col))
				return (int)$col["id"];
	$name = isset($want["name"]) ? (string)$want["name"] : "";
	if($name !== "")
		foreach($columns as $col)
			if(($col["kind"] === $kind) && isset($col["name"]) && ($col["name"] === $name) && JsonArchiveSameShape($want, $col))
				return (int)$col["id"];
	# Ссылка могла быть подписана в базах по-разному — тогда её опознаёт целевая таблица
	$target = isset($want["target"]) ? (string)$want["target"] : "";
	if((($kind === "ref") || ($kind === "arr")) && ($target !== ""))
		foreach($columns as $col)
			if(($col["kind"] === $kind) && isset($col["target"]) && ($col["target"] === $target))
				return (int)$col["id"];
	return 0;
}

# Совпадают ли базовый тип (для поля) и цель (для ссылки). Не заданное в архиве не сверяется.
function JsonArchiveSameShape($want, $col){
	$kind = isset($want["kind"]) ? $want["kind"] : "field";
	if($kind === "field"){
		$base = isset($want["base"]) ? (string)$want["base"] : "";
		return ($base === "") || ($base === (string)$col["base"]);
	}
	if(($kind === "ref") || ($kind === "arr")){
		# Имя целевой таблицы — главный признак: id таблиц у разных баз свои
		$target = isset($want["target"]) ? (string)$want["target"] : "";
		if(($target !== "") && isset($col["target"]) && ($col["target"] !== ""))
			return $col["target"] === $target;
		$type = isset($want["type"]) ? (int)$want["type"] : 0;
		if($type && isset($col["type"]) && ((int)$col["type"] === $type))
			return true;
		$name = isset($want["name"]) ? (string)$want["name"] : "";
		return ($name !== "") && isset($col["name"]) && ($col["name"] === $name);
	}
	return true;
}

# ---------------------------------------------------------------------------
# Чтение архива
# ---------------------------------------------------------------------------

function JsonArchiveDecode($text){
	$text = (string)$text;
	if(substr($text, 0, 3) === pack("CCC", 0xef, 0xbb, 0xbf))
		$text = substr($text, 3);
	$doc = json_decode($text, true);
	if(json_last_error() !== JSON_ERROR_NONE)
		throw new JsonArchiveError("JSON-архив не разобран: ".json_last_error_msg());
	if(!is_array($doc))
		throw new JsonArchiveError("JSON-архив должен быть объектом");
	if(!isset($doc["format"]) || ($doc["format"] !== JSON_ARCHIVE_FORMAT))
		throw new JsonArchiveError("Не архив Интеграма: ожидается \"format\":\"".JSON_ARCHIVE_FORMAT."\"");
	if(isset($doc["version"]) && ((int)$doc["version"] > JSON_ARCHIVE_VERSION))
		throw new JsonArchiveError("Версия архива ".(int)$doc["version"]." новее поддерживаемой ".JSON_ARCHIVE_VERSION);
	if(!isset($doc["rows"]) || !is_array($doc["rows"]))
		throw new JsonArchiveError("В архиве нет массива \"rows\"");
	foreach($doc["rows"] as $n => $row)
		if(!is_array($row))
			throw new JsonArchiveError("Строка ".($n + 1)." архива — не объект");
	$doc["table"] = isset($doc["table"]) ? (int)$doc["table"] : 0;
	if(!isset($doc["types"]) || !is_array($doc["types"]))
		$doc["types"] = array();
	return $doc;
}

# Описание таблицы архива: явное по "table", иначе единственный тип в "types"
function JsonArchiveTableType($doc){
	if(!count($doc["types"]))
		return NULL;
	if($doc["table"] && isset($doc["types"][(string)$doc["table"]]))
		return $doc["types"][(string)$doc["table"]];
	if(count($doc["types"]) === 1)
		return reset($doc["types"]);
	return NULL;
}

# Колонки таблицы архива в том виде, в каком их ждёт JsonArchiveMatchColumn
function JsonArchiveWantedColumns($doc){
	$type = JsonArchiveTableType($doc);
	if(($type === NULL) || !isset($type["reqs"]) || !is_array($type["reqs"]))
		return array();
	$columns = array();
	foreach($type["reqs"] as $req){
		if(!is_array($req))
			continue;
		$kind = isset($req["kind"]) ? (string)$req["kind"] : "field";
		$columns[] = array(
			"id" => isset($req["id"]) ? (int)$req["id"] : 0,
			"kind" => $kind,
			"name" => isset($req["name"]) ? (string)$req["name"] : "",
			"base" => isset($req["base"]) ? (string)$req["base"] : "",
			"type" => isset($req["type"]) ? (int)$req["type"] : 0,
			"target" => isset($req["target"]) ? (string)$req["target"] : "",
			"multi" => isset($req["multi"]) ? (bool)$req["multi"] : false,
			"key" => isset($req["key"]) ? (bool)$req["key"] : false,
			"attrs" => isset($req["attrs"]) ? (string)$req["attrs"] : ""
		);
	}
	return $columns;
}

/**
 * Разложить строку архива по локальным колонкам — ровно в тот позиционный массив,
 * который разбирает импорт сокращённого формата: [0] — значение записи, дальше по
 * реквизиту в порядке local_struct. Мульти-ссылка остаётся массивом имён.
 *
 * $withParent — режим autoParent: нулевым элементом идёт имя родителя, разбор снимет его
 * через array_shift.
 */
function JsonArchiveRowValues($row, $columns, $withParent=false){
	$object = array();
	if($withParent)
		$object[] = isset($row["parent"]) ? JsonArchiveScalar($row["parent"], "parent") : "";
	$object[] = array_key_exists("val", $row) && ($row["val"] !== null) ? JsonArchiveScalar($row["val"], "val") : "";
	$fields = isset($row["fields"]) && is_array($row["fields"]) ? $row["fields"] : array();
	foreach($columns as $col){
		if($col["kind"] === "arr" || $col["kind"] === "subst"){	# подчинённые таблицы архивируются отдельно
			$object[] = "";
			continue;
		}
		$found = JsonArchiveFieldValue($fields, $col, $columns);
		if(!$found["found"]){
			$object[] = "";
			continue;
		}
		$value = $found["value"];
		if($value === null){
			$object[] = JSON_ARCHIVE_CLEAR;
			continue;
		}
		if(is_array($value)){
			if(($col["kind"] !== "ref") || !$col["multi"])
				throw new JsonArchiveError("Колонка \"".JsonArchiveColumnKey($col, $columns)."\" не мульти-ссылка — массив значений недопустим");
			$refs = array();
			foreach($value as $item)
				$refs[] = JsonArchiveScalar($item, JsonArchiveColumnKey($col, $columns));
			$object[] = count($refs) ? $refs : JSON_ARCHIVE_CLEAR;
			continue;
		}
		$object[] = JsonArchiveScalar($value, JsonArchiveColumnKey($col, $columns));
	}
	return $object;
}

# Скалярное значение архива в строку. Объекты и вложенные массивы — ошибка, а не "Array".
function JsonArchiveScalar($value, $where){
	if(is_bool($value))
		return $value ? "1" : "-1";	# -1 — принятое в импорте «ложь», см. разбор BOOLEAN
	if(is_int($value) || is_float($value))
		return (string)$value;
	if(is_string($value))
		return $value;
	throw new JsonArchiveError("Недопустимое значение в \"$where\": ожидается строка, число или null");
}

# ---------------------------------------------------------------------------
# Мост с разбором данных импорта
# ---------------------------------------------------------------------------

/**
 * Значение колонки $n разобранной строки импорта.
 *
 * В BKI поле приезжает экранированным, и его надо расшторить; в JSON значение уже настоящее,
 * а мульти-ссылка — массивом имён. $json задаётся явно, чтобы поведение не зависело от
 * глобального состояния и проверялось тестом.
 */
function ImportField($object, $n, $json=false){
	if(!isset($object[$n]))
		return "";
	if($json || is_array($object[$n]))
		return $object[$n];
	return UnMaskDelimiters($object[$n]);
}

# Задано ли значение колонки. Мульти-ссылка приезжает массивом — strlen на нём неприменим.
function ImportHasValue($object, $n){
	if(!isset($object[$n]))
		return false;
	if(is_array($object[$n]))
		return count($object[$n]) > 0;
	return strlen($object[$n]) > 0;
}

# ---------------------------------------------------------------------------
# Сборка архива
# ---------------------------------------------------------------------------

# Метаданные всех типов, до которых дотянулась выгрузка, в виде "types" документа
function JsonArchiveTypesFromStruct($localStruct){
	$types = array();
	foreach($localStruct as $typeId => $entry){
		if(!is_numeric($typeId) || !isset($entry[0]))
			continue;
		$parts = JsonArchiveSplit($entry[0]);
		if(isset($parts[0]) && ($parts[0] === "subst"))	# колонка отчёта, а не таблица
			continue;
		$head = JsonArchiveParseTypeHead($entry[0]);
		if($head["base"] === "")	# строка-ссылка (val=''), собственного типа не описывает
			continue;
		$type = array("id" => (int)$typeId, "name" => $head["name"], "base" => $head["base"]);
		if($head["unique"])
			$type["unique"] = true;
		$columns = JsonArchiveColumnsFromStruct($localStruct, $typeId);
		$type["reqs"] = array();
		foreach($columns as $col){
			if($col["kind"] === "subst")
				continue;
			$req = array("id" => (int)$col["id"], "kind" => $col["kind"], "name" => isset($col["name"]) ? $col["name"] : "");
			if($col["kind"] === "field")
				$req["base"] = $col["base"];
			else{
				$req["type"] = isset($col["type"]) ? (int)$col["type"] : 0;
				$req["target"] = isset($col["target"]) ? $col["target"] : "";
			}
			if($col["multi"])
				$req["multi"] = true;
			if($col["key"])
				$req["key"] = true;
			if($col["attrs"] !== "")
				$req["attrs"] = $col["attrs"];
			$type["reqs"][] = $req;
		}
		$types[(string)$typeId] = $type;
	}
	return $types;
}

/**
 * Строка attrs для колонки архива: выгруженная — как есть, иначе собранная из признаков.
 * Архив, написанный руками, может задать только `"multi":true`/`"key":true` — их надо
 * донести до создаваемого реквизита, иначе мульти-ссылка станет одиночной, а ключевой
 * реквизит перестанет участвовать в поиске дубля.
 */
function JsonArchiveAttrs($col){
	if(isset($col["attrs"]) && ((string)$col["attrs"] !== ""))
		return (string)$col["attrs"];
	if(empty($col["multi"]) && empty($col["key"]))
		return "";
	return FieldAttrsBuild("", false, !empty($col["multi"]), null, !empty($col["key"]));
}

function JsonArchiveEncode($doc){
	return json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
}
