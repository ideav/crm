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

function FieldAttrsBuild($default="", $required=false, $multi=false, $alias=null, $key=false, $previous="")
{
	// Keys outside the five standard ones (e.g. a button column's "action")
	// are carried over from the previous attrs: the structure editor only
	// knows the standard fields and must not wipe the rest.
	$attrs = array();
	foreach(FieldAttrsParse($previous) as $k => $v)
		if(!in_array($k, array("required", "multi", "key", "alias", "default"), true))
			$attrs[$k] = $v;
	return FieldAttrsSerialize(array_merge($attrs, array(
		"required" => $required,
		"multi" => $multi,
		"key" => $key,
		"alias" => $alias,
		"default" => $default
	)));
}

// Button column action (issue #5116): a self-contained description of what
// the button does, stored under the "action" key of the column's attrs.
//   link    — {"type":"link","url":"report/1?FR_X=[ID]","newTab":true}
//   prompt  — {"type":"prompt","prompt":"…{Поле}…","write":true}
//   formula — {"type":"formula","formula":"{Цена} * {Кол-во}","write":true}
//   query   — {"type":"query","query":"Имя запроса","params":"FR_X=[ID]","write":true}
// "label" (button caption) is optional for every type. The link URL is also
// kept as the attrs default, which the server substitutes [ID]/[VAL] into for
// the record card and the API; other types leave the default empty, so the
// cell carries either nothing (show the button) or a written result.
//
// Launch (python2node#866) — optional keys, omitted at their defaults so that
// older modifiers stay byte-identical:
//   on        — events: PRESS (click, default), CREATE, UPDATE, DELETE (server,
//               include/button_triggers.php), READ (on display, browser). A string
//               "CREATE,UPDATE" is accepted. A link runs on PRESS only.
//   recompute — with READ: recompute on every display, ignoring the stored value.
//   when      — formula condition; the action runs only when it is truthy.
//   user      — the user the action runs as (record id, or a login that _d_action
//               turns into the id); empty — the current user.
// $error receives the reason when the action is rejected (return false).
function FieldAttrsActionEvents()
{
	return array("PRESS", "CREATE", "UPDATE", "DELETE", "READ");
}
function FieldAttrsNormalizeAction($action, &$error=null)
{
	$error = "";
	if(is_string($action)){
		if(trim($action) === "")
			return null;
		$action = json_decode($action, true);
	}
	if(!is_array($action) || !isset($action["type"])){
		$error = "действие — не объект JSON с полем type";
		return false;
	}
	$type = (string)$action["type"];
	$fields = array(
		"link" => array("url"),
		"prompt" => array("prompt"),
		"formula" => array("formula"),
		"query" => array("query", "params")
	);
	if(!isset($fields[$type])){
		$error = "неизвестный тип «{$type}»: допустимы link, prompt, formula, query";
		return false;
	}
	$result = array("type" => $type);
	foreach(array_merge(array("label"), $fields[$type]) as $f)
		if(isset($action[$f]) && !is_array($action[$f]) && trim((string)$action[$f]) !== "")
			$result[$f] = mb_substr((string)$action[$f], 0, 8000);
	if($type === "link")
		$result["newTab"] = !isset($action["newTab"]) || FieldAttrsBool($action["newTab"]);
	else
		$result["write"] = isset($action["write"]) && FieldAttrsBool($action["write"]);

	$on = isset($action["on"]) ? $action["on"] : array();
	if(is_string($on))
		$on = preg_split('/[\s,;]+/', $on, -1, PREG_SPLIT_NO_EMPTY);
	if(!is_array($on)){
		$error = "on — список событий";
		return false;
	}
	$events = array();
	foreach($on as $e){
		$e = strtoupper(trim(is_scalar($e) ? (string)$e : ""));
		if(!in_array($e, FieldAttrsActionEvents(), true)){
			$error = "неизвестное событие «{$e}»: допустимы ".implode(", ", FieldAttrsActionEvents());
			return false;
		}
		$events[$e] = TRUE;
	}
	$ordered = array();
	foreach(FieldAttrsActionEvents() as $e)
		if(isset($events[$e]))
			$ordered[] = $e;
	if($type === "link" && count(array_diff($ordered, array("PRESS")))){
		$error = "ссылка запускается только нажатием (PRESS)";
		return false;
	}
	if(count($ordered) && $ordered !== array("PRESS"))
		$result["on"] = $ordered;
	if(in_array("READ", $ordered, true) && isset($action["recompute"]) && FieldAttrsBool($action["recompute"]))
		$result["recompute"] = true;
	if($type !== "link" && isset($action["when"]) && is_scalar($action["when"]) && trim((string)$action["when"]) !== "")
		$result["when"] = mb_substr(trim((string)$action["when"]), 0, 8000);
	if(isset($action["user"]) && is_scalar($action["user"]) && trim((string)$action["user"]) !== ""){
		$user = trim((string)$action["user"]);
		$result["user"] = ctype_digit($user) ? (int)$user : mb_substr($user, 0, 255);
	}
	return $result;
}

function FieldAttrsSetAction($attrs, $action)
{
	$parsed = FieldAttrsParse($attrs);
	if(is_null($action)){
		unset($parsed["action"]);
		return FieldAttrsSerialize($parsed);
	}
	$parsed["action"] = $action;
	$parsed["default"] = $action["type"] === "link" && isset($action["url"]) ? $action["url"] : "";
	return FieldAttrsSerialize($parsed);
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
