<?php
require __DIR__ . "/../include/field_attrs.php";

function assertSameValue($expected, $actual, $message)
{
	if($expected !== $actual){
		fwrite(STDERR, $message . "\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
		exit(1);
	}
}

$legacy = ":!NULL::MULTI::ALIAS=Ответственный:[USER_ID]";
$parsedLegacy = FieldAttrsParse($legacy);
assertSameValue(true, $parsedLegacy["required"], "legacy required flag");
assertSameValue(true, $parsedLegacy["multi"], "legacy multi flag");
assertSameValue("Ответственный", $parsedLegacy["alias"], "legacy alias");
assertSameValue("[USER_ID]", $parsedLegacy["default"], "legacy default value");

$json = FieldAttrsBuild("[USER_ID]", true, true, "Ответственный");
assertSameValue('{"required":true,"multi":true,"alias":"Ответственный","default":"[USER_ID]"}', $json, "JSON attrs serialization");
assertSameValue(true, FieldAttrsHasRequired($json), "JSON required flag");
assertSameValue(true, FieldAttrsHasMulti($json), "JSON multi flag");
assertSameValue("Ответственный", FieldAttrsAlias($json, "fallback"), "JSON alias");
assertSameValue("[USER_ID]", FieldAttrsDefaultValue($json), "JSON default value");

$extended = '{"display":"wide","required":true}';
assertSameValue("wide", FieldAttrsParse($extended)["display"], "JSON attrs preserve unknown field");
assertSameValue($extended, FieldAttrsSerialize(FieldAttrsParse($extended)), "JSON attrs serialize unknown field");

$withoutRequired = FieldAttrsToggleFlag($json, "required");
assertSameValue(false, FieldAttrsHasRequired($withoutRequired), "toggle required off");
assertSameValue(true, FieldAttrsHasMulti($withoutRequired), "toggle keeps multi flag");

$withoutAlias = FieldAttrsSetAlias($json, "");
assertSameValue("fallback", FieldAttrsAlias($withoutAlias, "fallback"), "empty alias is removed");
assertSameValue("[USER_ID]", FieldAttrsDefaultValue($withoutAlias), "default survives alias removal");

$property = FieldAttrsJsonProperty($json);
$decoded = json_decode("{" . substr($property, 1) . "}", true);
assertSameValue($json, $decoded["attrs"], "attrs property is valid JSON string");

echo "issue-2485 PHP attrs JSON tests passed\n";
