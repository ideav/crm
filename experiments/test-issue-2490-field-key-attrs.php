<?php

require_once __DIR__ . "/../include/field_attrs.php";

function assertSameIssue2490($expected, $actual, $message)
{
	if($expected !== $actual){
		fwrite(STDERR, $message."\nExpected: ".var_export($expected, true)."\nActual: ".var_export($actual, true)."\n");
		exit(1);
	}
}

$parsed = FieldAttrsParse('{"required":true,"multi":true,"key":true,"alias":"Owner","default":"[USER_ID]"}');
assertSameIssue2490(true, $parsed["required"], "JSON required flag should parse");
assertSameIssue2490(true, $parsed["multi"], "JSON multi flag should parse");
assertSameIssue2490(true, $parsed["key"], "JSON key flag should parse");
assertSameIssue2490("Owner", $parsed["alias"], "JSON alias should parse");
assertSameIssue2490("[USER_ID]", $parsed["default"], "JSON default should parse");

$legacy = FieldAttrsParse(":!NULL::KEY:legacy-default");
assertSameIssue2490(true, $legacy["required"], "Legacy required flag should parse");
assertSameIssue2490(true, $legacy["key"], "Legacy key flag should parse");
assertSameIssue2490("legacy-default", $legacy["default"], "Legacy key mask should not leak into default value");

assertSameIssue2490(
	'{"required":true,"key":true,"alias":"Owner","default":"[USER_ID]"}',
	FieldAttrsBuild("[USER_ID]", true, false, "Owner", true),
	"FieldAttrsBuild should serialize the key flag"
);

assertSameIssue2490(true, FieldAttrsHasKey('{"key":true}'), "FieldAttrsHasKey should detect JSON key flag");
assertSameIssue2490(false, FieldAttrsHasKey('{"key":false}'), "FieldAttrsHasKey should reject false key flag");

echo "issue-2490 field key attrs: ok\n";
