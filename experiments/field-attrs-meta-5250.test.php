<?php
# Мерка к issue #5250: metadata отдаёт атрибуты колонки разобранным объектом field_attrs
# рядом с сырой строкой attrs. https://github.com/ideav/crm/issues/5250
#
# Запуск: php experiments/field-attrs-meta-5250.test.php (в гейте — через одноимённый .test.js)
#
# Что проверяется:
#   1) старый формат (":!NULL:", "[TODAY]", ":MULTI::ALIAS=…:") и JSON-формат одних и тех же
#      атрибутов дают одинаковый field_attrs;
#   2) колонка без атрибутов: field_attrs со значениями по умолчанию, ключа attrs нет;
#   3) сырое attrs осталось побайтно прежним (как FieldAttrsJsonProperty);
#   4) нестандартные ключи (action колонки-кнопки) переходят в field_attrs;
#   5) свойства встраиваются в объект metadata и дают валидный JSON.

error_reporting(E_ALL & ~E_DEPRECATED);
require __DIR__ . "/../include/field_attrs.php";

$fails = 0;
function check($ok, $message)
{
	global $fails;
	if(!$ok){
		$fails++;
		fwrite(STDERR, "FAIL: $message\n");
	}
	else
		echo "ok - $message\n";
}

// Объект metadata-строки с нашими свойствами, как его собирает index.php (case "metadata").
function metaRow($attrs)
{
	$json = "{\"num\":1,\"id\":\"115\"" . FieldAttrsMetaProperties($attrs) . "}";
	$row = json_decode($json, true);
	check(is_array($row), "валидный JSON для attrs=" . var_export($attrs, true) . ": $json");
	return is_array($row) ? $row : array();
}

$empty = array("required" => false, "multi" => false, "key" => false, "alias" => null, "default" => "");

// 1) старый формат из шаблонной базы (Пользователь → Роль, Дата) и тот же смысл JSON-ом
$role = metaRow(":!NULL:");
check(isset($role["field_attrs"]) && $role["field_attrs"] == array_merge($empty, array("required" => true)), "Роль :!NULL: → required=true");
$date = metaRow("[TODAY]");
check(isset($date["field_attrs"]) && $date["field_attrs"] == array_merge($empty, array("default" => "[TODAY]")), "Дата [TODAY] → default=[TODAY]");

$pairs = array(
	array(":!NULL:[TODAY]", FieldAttrsBuild("[TODAY]", true)),
	array(":!NULL::MULTI::ALIAS=Ответственный:[USER_ID]", FieldAttrsBuild("[USER_ID]", true, true, "Ответственный")),
	array(":KEY:", FieldAttrsBuild("", false, false, null, true)),
);
foreach($pairs as $p){
	$legacy = metaRow($p[0]);
	$json = metaRow($p[1]);
	check(isset($legacy["field_attrs"], $json["field_attrs"]) && $legacy["field_attrs"] === $json["field_attrs"],
		"одинаковый field_attrs: «{$p[0]}» и «{$p[1]}»");
}

// 2) без атрибутов
foreach(array("", null) as $none){
	$row = metaRow($none);
	check(isset($row["field_attrs"]) && $row["field_attrs"] === $empty, "без атрибутов → field_attrs по умолчанию (" . var_export($none, true) . ")");
	check(!array_key_exists("attrs", $row), "без атрибутов ключа attrs нет (" . var_export($none, true) . ")");
}

// 3) сырое attrs не изменилось
foreach(array(":!NULL:", "[TODAY]", '{"required":true,"default":"[TODAY]"}', "") as $raw){
	$old = FieldAttrsJsonProperty($raw);
	$new = FieldAttrsMetaProperties($raw);
	check(substr($new, 0, strlen($old)) === $old, "attrs побайтно прежний для " . var_export($raw, true));
}

// 4) колонка-кнопка: действие переходит в field_attrs
$button = FieldAttrsSetAction("", array("type" => "link", "url" => "report/1?FR_X=[ID]", "newTab" => true));
$row = metaRow($button);
check(isset($row["field_attrs"]["action"]["type"]) && $row["field_attrs"]["action"]["type"] === "link", "action колонки-кнопки в field_attrs");
check(isset($row["attrs"]) && $row["attrs"] === $button, "attrs колонки-кнопки — сырая строка");

// 5) спецсимволы в псевдониме и значении по умолчанию
$row = metaRow(FieldAttrsBuild("a\"b\c", false, false, "Имя \"в кавычках\""));
check(isset($row["field_attrs"]) && $row["field_attrs"]["default"] === "a\"b\c" && $row["field_attrs"]["alias"] === "Имя \"в кавычках\"", "кавычки и обратная косая черта экранированы");

if($fails){
	fwrite(STDERR, "$fails проверок упало\n");
	exit(1);
}
echo "PASS\n";
