<?php

defined("NOT_NULL_MASK") || define("NOT_NULL_MASK", ":!NULL:");
defined("MULTI_MASK") || define("MULTI_MASK", ":MULTI:");
defined("KEY_MASK") || define("KEY_MASK", ":KEY:");
defined("ALIAS_MASK") || define("ALIAS_MASK", "/:ALIAS=(.*?):/u");
defined("ALIAS_DEF") || define("ALIAS_DEF", ":ALIAS=");

function FieldAttrsEmpty()
{
	return array(
		"required" => false,
		"multi" => false,
		"key" => false,
		"alias" => null,
		"default" => ""
	);
}

function FieldAttrsBool($value)
{
	if(is_bool($value))
		return $value;
	if(is_numeric($value))
		return ((int)$value) !== 0;
	if(is_string($value)){
		$value = strtolower(trim($value));
		return !in_array($value, array("", "0", "false", "no", "off"), true);
	}
	return !empty($value);
}

function FieldAttrsParse($attrs)
{
	$result = FieldAttrsEmpty();
	$attrs = is_null($attrs) ? "" : (string)$attrs;
	$trimmed = trim($attrs);
	if($trimmed === "")
		return $result;

	if(substr($trimmed, 0, 1) === "{"){
		$json = json_decode($trimmed, true);
		if(json_last_error() === JSON_ERROR_NONE && is_array($json)){
			foreach($json as $key => $value){
				switch($key){
					case "required":
					case "notNull":
					case "not_null":
						$result["required"] = FieldAttrsBool($value);
						break;
					case "multi":
						$result["multi"] = FieldAttrsBool($value);
						break;
					case "key":
						$result["key"] = FieldAttrsBool($value);
						break;
					case "alias":
						$result["alias"] = is_null($value) ? null : (string)$value;
						break;
					case "default":
					case "defaultValue":
						$result["default"] = is_null($value) ? "" : (string)$value;
						break;
					default:
						$result[$key] = $value;
						break;
				}
			}
			return $result;
		}
	}

	$result["required"] = strpos($attrs, NOT_NULL_MASK) !== false;
	$result["multi"] = strpos($attrs, MULTI_MASK) !== false;
	$result["key"] = strpos($attrs, KEY_MASK) !== false;
	if(preg_match(ALIAS_MASK, $attrs, $alias))
		$result["alias"] = $alias[1];
	$result["default"] = preg_replace(ALIAS_MASK, "", str_replace(KEY_MASK, "", str_replace(MULTI_MASK, "", str_replace(NOT_NULL_MASK, "", $attrs))));
	return $result;
}

function FieldAttrsSerialize($attrs)
{
	$parsed = is_array($attrs) ? array_merge(FieldAttrsEmpty(), $attrs) : FieldAttrsParse($attrs);
	$json = array();

	foreach($parsed as $key => $value){
		if(in_array($key, array("required", "notNull", "not_null", "multi", "key", "alias", "default", "defaultValue"), true))
			continue;
		if(!is_null($value))
			$json[$key] = $value;
	}
	if(FieldAttrsBool($parsed["required"]))
		$json["required"] = true;
	if(FieldAttrsBool($parsed["multi"]))
		$json["multi"] = true;
	if(FieldAttrsBool($parsed["key"]))
		$json["key"] = true;
	if(isset($parsed["alias"]) && $parsed["alias"] !== "")
		$json["alias"] = (string)$parsed["alias"];
	$default = isset($parsed["default"]) ? $parsed["default"] : (isset($parsed["defaultValue"]) ? $parsed["defaultValue"] : "");
	if($default !== "")
		$json["default"] = (string)$default;

	return count($json) ? json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : "";
}

function FieldAttrsHasRequired($attrs)
{
	$parsed = FieldAttrsParse($attrs);
	return $parsed["required"];
}

function FieldAttrsHasMulti($attrs)
{
	$parsed = FieldAttrsParse($attrs);
	return $parsed["multi"];
}

function FieldAttrsHasKey($attrs)
{
	$parsed = FieldAttrsParse($attrs);
	return $parsed["key"];
}

function FieldAttrsAlias($attrs, $fallback="")
{
	$parsed = FieldAttrsParse($attrs);
	return isset($parsed["alias"]) && $parsed["alias"] !== "" ? $parsed["alias"] : $fallback;
}

function FieldAttrsDefaultValue($attrs)
{
	$parsed = FieldAttrsParse($attrs);
	return isset($parsed["default"]) ? $parsed["default"] : "";
}

function FieldAttrsSetFlag($attrs, $flag, $enabled)
{
	$parsed = FieldAttrsParse($attrs);
	$parsed[$flag] = (bool)$enabled;
	return FieldAttrsSerialize($parsed);
}

function FieldAttrsToggleFlag($attrs, $flag)
{
	$parsed = FieldAttrsParse($attrs);
	$parsed[$flag] = !FieldAttrsBool(isset($parsed[$flag]) ? $parsed[$flag] : false);
	return FieldAttrsSerialize($parsed);
}

function FieldAttrsSetAlias($attrs, $alias)
{
	$parsed = FieldAttrsParse($attrs);
	$parsed["alias"] = (string)$alias;
	return FieldAttrsSerialize($parsed);
}

function FieldAttrsBuild($default="", $required=false, $multi=false, $alias=null, $key=false)
{
	return FieldAttrsSerialize(array(
		"required" => $required,
		"multi" => $multi,
		"key" => $key,
		"alias" => $alias,
		"default" => $default
	));
}

function FieldAttrsJsonProperty($attrs)
{
	return strlen((string)$attrs)
		? ",\"attrs\":".json_encode((string)$attrs, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
		: "";
}

function FieldAttrsJsString($value)
{
	return str_replace(
		array("\\", "\"", "\n", "\r"),
		array("\\\\", "\\\"", "\\n", "\\r"),
		(string)$value
	);
}
