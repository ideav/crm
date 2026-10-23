<?php
/**
 * Схема одним JSON и поля по именам (issue #5242).
 *
 *   _d_schema          — типы с реквизитами, ссылками и подчинёнными таблицами, роли с правами
 *                        и отчёты из одного JSON. Существующее находится по имени, повторный
 *                        вызов ничего не создаёт. Описание формата — docs/kb/schema-json.md.
 *   fields=<JSON>      — поля записи по именам в _m_new и _m_set; в _m_batch имена можно
 *                        писать прямо ключами fields операции.
 *   тело application/json — те же параметры, что и в форме (Json_body_merge).
 *
 * Всё пишется теми же примитивами, что и команды _d_* (Insert, Update_Val, FieldAttrs*),
 * а записи ролей, прав и отчётов — обработчиками _m_new/_m_set через ApplyOp, со всеми их
 * проверками прав и уникальности.
 */

# ── Тело запроса JSON ──────────────────────────────────────────────────────────────────────
# Тело с Content-Type: application/json раскладывается в $_POST, как если бы те же ключи
# пришли формой: скаляры — строкой, вложенные объекты и массивы — JSON-строкой. Ключи,
# уже пришедшие формой, не перекрываются. Разобранное тело целиком — в $GLOBALS["JSON_BODY"].
function Json_body_merge($raw = NULL, $contentType = NULL)
{
	if($contentType === NULL)
		$contentType = isset($_SERVER["CONTENT_TYPE"]) ? $_SERVER["CONTENT_TYPE"] : "";
	if(stripos((string)$contentType, "application/json") === FALSE)
		return FALSE;
	if($raw === NULL)
		$raw = file_get_contents("php://input");
	if(!is_string($raw) || trim($raw) === "")
		return FALSE;
	$body = json_decode($raw, TRUE);
	if(!is_array($body))
		return FALSE;
	$GLOBALS["JSON_BODY"] = $body;
	if(array_keys($body) === range(0, count($body) - 1))	# Массив — например пакет операций _m_batch
		$body = array("ops" => $body);
	foreach($body as $key => $val)
		if(!isset($_POST[$key]))
			$_POST[$key] = Json_scalar($val);
	return TRUE;
}
function Json_scalar($val)
{
	if(is_array($val))
		return json_encode($val, JSON_UNESCAPED_UNICODE);
	if(is_bool($val))
		return $val ? "1" : "0";
	return is_null($val) ? "" : (string)$val;
}

# ── Базовые типы по имени ──────────────────────────────────────────────────────────────────
function Sj_base_id($type)
{
	if($type === NULL || $type === "")
		return $GLOBALS["BT"]["SHORT"];
	if(is_int($type) || ctype_digit((string)$type))
		return isset($GLOBALS["basics"][(int)$type]) ? (int)$type : FALSE;
	$name = strtoupper(trim($type));
	$synonyms = array("STRING" => "SHORT", "TEXT" => "CHARS", "LONG" => "CHARS", "INT" => "NUMBER", "INTEGER" => "NUMBER"
		, "DECIMAL" => "SIGNED", "FLOAT" => "SIGNED", "MONEY" => "SIGNED", "NUMERIC" => "SIGNED"
		, "BOOL" => "BOOLEAN", "PASSWORD" => "PWD");
	if(isset($synonyms[$name]))
		$name = $synonyms[$name];
	return isset($GLOBALS["BT"][$name]) ? (int)$GLOBALS["BT"][$name] : FALSE;
}
function Sj_base_name($id)
{
	return isset($GLOBALS["basics"][$id]) ? $GLOBALS["basics"][$id] : "";
}
function Sj_q($s)
{
	return addslashes((string)$s);
}
function Sj_rows($sql, $msg)
{
	$rows = array();
	$res = Exec_sql($sql, $msg);
	while($row = mysqli_fetch_assoc($res))
		$rows[] = $row;
	return $rows;
}

# ── Термины ────────────────────────────────────────────────────────────────────────────────
# В ядре всё — термины: строка верхнего уровня (up=0) с именем и базовым типом. Один и тот же
# термин бывает таблицей, полем другой таблицы (её реквизитом) и целью ссылки. Имя термина
# уникально: существующий термин переиспользуется в любой роли, а второй термин с тем же
# именем и другим базовым типом не создаётся. Ссылочные термины (val='') и сами базовые типы
# в поиск по имени не входят.
function Sj_terms($name)
{
	global $z;
	return Sj_rows("SELECT t.id, t.t, t.ord, (SELECT COUNT(1) FROM $z r WHERE r.up=t.id AND r.t!=r.up) nreq"
					." FROM $z t WHERE t.up=0 AND t.val='".Sj_q($name)."' AND t.id!=t.t"
					." AND t.t IN (".implode(",", array_keys($GLOBALS["basics"])).") ORDER BY t.id"
				, "Schema: find the term by name");
}
# Термин по имени (и базовому типу, если задан). Из нескольких одноимённых — с собственными
# реквизитами, затем первый. NULL — термина с таким именем (и таким типом) нет.
function Sj_term($name, $base = NULL)
{
	$best = NULL;
	foreach(Sj_terms($name) as $row){
		if($base !== NULL && (int)$row["t"] !== (int)$base)
			continue;
		$score = (int)$row["nreq"] > 0 ? 1 : 0;
		if($best === NULL || $score > $best["score"])
			$best = $row + array("score" => $score);
	}
	return $best;
}
function Sj_find_table($name, $base = NULL)
{
	return Sj_term($name, $base);
}
# Реквизиты типа: id, ord, имя (псевдоним, иначе имя типа или целевой таблицы ссылки),
# вид (field / ref / child / link), базовый тип, цель ссылки, атрибуты.
function Sj_type_reqs($typeId)
{
	global $z;
	$typeId = (int)$typeId;
	$rows = Sj_rows("SELECT req.id, req.ord, req.t typ, req.val attrs, typ.t tbase, typ.val tname, ref.id ref, ref.val rname, ref.t rbase"
					.", (SELECT 1 FROM $z ch WHERE ch.up=typ.id AND ch.t!=ch.up LIMIT 1) arr"
					." FROM $z req JOIN $z typ ON typ.id=req.t"
					." LEFT JOIN $z ref ON ref.id=typ.t AND ref.t!=ref.id"
					." WHERE req.up=$typeId AND req.t!=req.up ORDER BY req.ord"
				, "Schema: get the type reqs");
	$reqs = array();
	foreach($rows as $row){
		$r = array("id" => (int)$row["id"], "ord" => (int)$row["ord"], "type" => (int)$row["typ"], "attrs" => $row["attrs"]);
		if((int)$row["typ"] === 1){
			$r["kind"] = "link";
			$r["base"] = "SHORT";
			$r["type_name"] = $row["attrs"];
			$r["alias"] = "";
		}
		else{
			$r["alias"] = FieldAttrsAlias($row["attrs"], "");
			if($row["ref"]){
				$r["kind"] = "ref";
				$r["target"] = (int)$row["ref"];
				$r["type_name"] = $row["rname"];
				$r["base"] = Sj_base_name((int)$row["rbase"]);
			}
			else{
				$r["kind"] = $row["arr"] ? "child" : "field";
				$r["type_name"] = $row["tname"];
				$r["base"] = Sj_base_name((int)$row["tbase"]);
				if($r["kind"] === "child")
					$r["target"] = (int)$row["typ"];
			}
		}
		$r["name"] = $r["alias"] !== "" ? $r["alias"] : $r["type_name"];
		$reqs[] = $r;
	}
	return $reqs;
}
# Реквизит по имени: сначала по имени колонки (псевдоним или имя типа), затем по имени типа.
function Sj_req_by_name($reqs, $name)
{
	foreach($reqs as $r)
		if(mb_strtolower($r["name"]) === mb_strtolower($name))
			return $r;
	foreach($reqs as $r)
		if(mb_strtolower($r["type_name"]) === mb_strtolower($name))
			return $r;
	return NULL;
}

# ── Поля записи по именам ──────────────────────────────────────────────────────────────────
# Переводит поля {имя: значение} в ключи t{id}. Имя — имя колонки (как в metadata: псевдоним
# или имя типа), имя самой таблицы (главное значение записи) или прежний ключ t{id}.
# Значение ссылки можно дать id записи или её главным значением — оно ищется в целевой
# таблице и должно найтись ровно одной записью. Для множественной ссылки — массив.
# $strict: неизвестное имя — ошибка; иначе ключ остаётся как есть, а имя — в $unknown.
function Named_fields($typeId, $fields, $strict = TRUE, &$unknown = NULL)
{
	global $z;
	$unknown = array();
	if(!is_array($fields))
		Sj_fail(t9n("[RU]Поля записи (fields) — объект JSON {имя: значение}[EN]Record fields must be a JSON object {name: value}"));
	$typeId = (int)$typeId;
	$table = mysqli_fetch_assoc(Exec_sql("SELECT val FROM $z WHERE id=$typeId AND up=0", "Named fields: get the table"));
	if(!$table)
		Sj_fail(t9n("[RU]Таблица $typeId не найдена[EN]Table $typeId not found"));
	$reqs = NULL;
	$out = array();
	foreach($fields as $key => $val){
		$key = (string)$key;
		if(preg_match('/^t\d+$/', $key) || preg_match('/^(NEW|SEARCH)_/', $key) || in_array($key, array("copybtn"), TRUE)){
			$out[$key] = $val;
			continue;
		}
		if(mb_strtolower($key) === mb_strtolower($table["val"])){
			$out["t$typeId"] = Sj_field_scalar($val);
			continue;
		}
		if($reqs === NULL)
			$reqs = Sj_type_reqs($typeId);
		$req = Sj_req_by_name($reqs, $key);
		if($req === NULL || $req["kind"] === "child"){
			if($strict)
				Sj_fail(t9n("[RU]В таблице «".$table["val"]."» нет поля «".$key."»[EN]Table '".$table["val"]."' has no field '".$key."'")
					.". ".t9n("[RU]Поля[EN]Fields").": ".implode(", ", array_map(function($r){ return $r["name"]; }
						, array_filter($reqs, function($r){ return $r["kind"] !== "child"; }))));
			$unknown[] = $key;
			$out[$key] = $val;
			continue;
		}
		if($req["kind"] === "ref")
			$val = Sj_ref_value($req, $val, $key);
		$out["t".$req["id"]] = Sj_field_scalar($val);
	}
	return $out;
}
# Есть ли среди ключей полей имена (не t{id} и не служебные ключи обработчиков)
function Named_fields_needed($fields)
{
	if(!is_array($fields))
		return FALSE;
	foreach($fields as $key => $v)
		if(!preg_match('/^t\d+$/', (string)$key) && !preg_match('/^(NEW|SEARCH)_/', (string)$key) && ((string)$key !== "copybtn"))
			return TRUE;
	return FALSE;
}
function Sj_field_scalar($val)
{
	if(is_array($val))
		return implode(",", array_map("Json_scalar", $val));
	return Json_scalar($val);
}
function Sj_ref_value($req, $val, $field)
{
	global $z;
	$list = is_array($val) ? $val : array($val);
	$ids = array();
	foreach($list as $v){
		if(is_array($v) && isset($v["id"]))
			$v = $v["id"];
		$v = trim(Json_scalar($v));
		if($v === "" || ctype_digit($v)){
			$ids[] = $v;
			continue;
		}
		$rows = Sj_rows("SELECT id FROM $z WHERE t=".(int)$req["target"]." AND up!=0 AND val='".Sj_q($v)."' LIMIT 2"
					, "Named fields: find the ref record by value");
		if(count($rows) !== 1)
			Sj_fail(t9n(count($rows) ? "[RU]Поле «".$field."»: в «".$req["type_name"]."» несколько записей «".$v."» — укажите id"
										."[EN]Field '".$field."': several records '".$v."' in '".$req["type_name"]."' — give the id"
									: "[RU]Поле «".$field."»: в «".$req["type_name"]."» нет записи «".$v."»"
										."[EN]Field '".$field."': no record '".$v."' in '".$req["type_name"]."'"));
		$ids[] = $rows[0]["id"];
	}
	return is_array($val) ? $ids : $ids[0];
}
# Отказ: в пакете — ошибка одной операции, в одиночном вызове — 400 с текстом
function Sj_fail($msg)
{
	if(function_exists("InBatchOp") && InBatchOp())
		throw new IntegramOpError($msg);
	my_die($msg);
}
# _m_new / _m_set: fields=<JSON> переводится в t{id} и вливается в $_REQUEST.
# Ключи t{id}, пришедшие формой, сильнее одноимённых из fields.
function Named_fields_to_request($typeId)
{
	if(!isset($_REQUEST["fields"]))
		return;
	$fields = is_array($_REQUEST["fields"]) ? $_REQUEST["fields"] : json_decode((string)$_REQUEST["fields"], TRUE);
	if(!is_array($fields))
		Sj_fail(t9n("[RU]fields — объект JSON {имя поля: значение}[EN]fields must be a JSON object {field name: value}"));
	unset($_REQUEST["fields"]);
	foreach(Named_fields($typeId, $fields) as $k => $v)
		if(!isset($_REQUEST[$k]))
			$_REQUEST[$k] = $v;
}
# Тип записи (для _m_set и операций пакета)
function Sj_record_type($id)
{
	global $z;
	$row = mysqli_fetch_assoc(Exec_sql("SELECT t FROM $z WHERE id=".(int)$id." AND up!=0", "Named fields: get the record type"));
	return $row ? (int)$row["t"] : 0;
}

# ── Чтение записей по именам ───────────────────────────────────────────────────────────────
# object/{таблица}/?JSON_OBJ&NAMED: строки JSON_OBJ ({i,u,o,r:[…]}) — объектами с ключами-именами.
# Порядок значений r тот же, что у реквизитов в api.req_order листинга (r[0] — главное значение).
# Ссылка — {"id":…, "val":…} (множественная — массивом таких), подчинённая таблица —
# {"table": id таблицы, "count": число записей}: её записи читаются object/{id}/?JSON_OBJ&NAMED&F_U={id записи}.
function Named_rows($tableId, $rows, $api)
{
	if(!is_array($rows))
		return $rows;
	$tableName = isset($api["type"]["val"]) ? $api["type"]["val"] : (string)$tableId;
	$order = isset($api["req_order"]) && is_array($api["req_order"]) ? array_values($api["req_order"]) : array();
	$names = array();
	foreach(Sj_type_reqs($tableId) as $r){
		$names[$r["id"]] = $r;
		if($r["kind"] === "child")	# Подчинённая таблица в листинге адресуется id своей таблицы
			$names[$r["target"]] = $r;
	}
	$out = array();
	foreach($rows as $row){
		if(!is_array($row) || !isset($row["r"])){
			$out[] = $row;
			continue;
		}
		$o = array("id" => $row["i"], "up" => $row["u"], "ord" => $row["o"]);
		foreach($row["r"] as $n => $v){
			if($n === 0){
				$o[$tableName] = $v;
				continue;
			}
			$req = isset($order[$n - 1]) ? $order[$n - 1] : NULL;
			$r = ($req !== NULL && isset($names[$req])) ? $names[$req] : NULL;
			$key = $r ? $r["name"] : (($req !== NULL && isset($api["req_type"][$req])) ? $api["req_type"][$req] : "r$n");
			if(isset($api["arr_type"][$req]) || ($r && $r["kind"] === "child"))
				$v = array("table" => $r ? $r["target"] : (int)$api["arr_type"][$req], "count" => (int)$v);
			elseif(isset($api["ref_type"][$req]) || ($r && $r["kind"] === "ref"))
				$v = Named_ref_value($v, $r && FieldAttrsHasMulti($r["attrs"]));
			$o[$key] = $v;
		}
		$out[] = $o;
	}
	return $out;
}
# "id:Значение" → {"id","val"}; множественная "id1,id2:з1,з2" → массив; пусто → null
function Named_ref_value($v, $multi)
{
	$v = (string)$v;
	if($v === "" || strpos($v, ":") === FALSE)
		return $v === "" ? NULL : $v;
	list($ids, $vals) = explode(":", $v, 2);
	$ids = explode(",", $ids);
	$vals = count($ids) > 1 ? explode(",", $vals) : array($vals);
	$list = array();
	foreach($ids as $k => $id)
		if($id !== "")
			$list[] = array("id" => (int)$id, "val" => str_replace("&comma;", ",", isset($vals[$k]) ? $vals[$k] : ""));
	if($multi || count($list) > 1)
		return $list;
	return count($list) ? $list[0] : NULL;
}

# ── Схема одним JSON ───────────────────────────────────────────────────────────────────────
function Schema_json_input()
{
	if(isset($_REQUEST["json"]))
		$spec = is_array($_REQUEST["json"]) ? $_REQUEST["json"] : json_decode((string)$_REQUEST["json"], TRUE);
	elseif(isset($GLOBALS["JSON_BODY"]))
		$spec = $GLOBALS["JSON_BODY"];
	else
		$spec = NULL;
	if(!is_array($spec))
		my_die(t9n("[RU]Ожидается описание схемы JSON: поле формы json=… или тело application/json[EN]Expected a JSON schema: form field json=… or an application/json body")
			.(json_last_error() !== JSON_ERROR_NONE ? " (".json_last_error_msg().")" : ""));
	unset($spec["_xsrf"]);
	return $spec;
}

# Проверка описания до записи: имена, типы, цели ссылок. Возвращает список ошибок.
function Schema_validate($spec)
{
	$err = array();
	$known = array("tables", "roles", "reports");
	foreach($spec as $k => $v)
		if(!in_array($k, $known, TRUE))
			$err[] = t9n("[RU]Неизвестный раздел «".$k."» (допустимы tables, roles, reports)[EN]Unknown section '".$k."' (expected tables, roles, reports)");
	$tables = Schema_flat_tables(isset($spec["tables"]) ? $spec["tables"] : array(), NULL, $err);
	$names = array();
	$want = array();	# Имя термина в нижнем регистре => имя и базовые типы, которыми его описали
	foreach($tables as $t){
		if(isset($names[mb_strtolower($t["name"])]))
			$err[] = "«".$t["name"]."»: ".t9n("[RU]таблица описана дважды[EN]the table is described twice");
		$names[mb_strtolower($t["name"])] = TRUE;
		Sj_term_want($t["name"], isset($t["type"]) ? Sj_base_id($t["type"]) : NULL, "«".$t["name"]."»", $want);
	}
	foreach($tables as $t){
		$seen = array();
		$refTargets = array();
		foreach(isset($t["fields"]) && is_array($t["fields"]) ? $t["fields"] : array() as $i => $f){
			$where = "«".$t["name"]."».fields[$i]";
			if(!is_array($f) || !isset($f["name"]) || trim((string)$f["name"]) === ""){
				$err[] = "$where: ".t9n("[RU]нужно имя поля (name)[EN]field name is required");
				continue;
			}
			$fn = mb_strtolower(trim($f["name"]));
			if(isset($seen[$fn]))
				$err[] = "$where: ".t9n("[RU]поле «".$f["name"]."» задано дважды[EN]field '".$f["name"]."' is given twice");
			$seen[$fn] = TRUE;
			if(isset($f["ref"])){
				$target = trim((string)$f["ref"]);
				if(!isset($names[mb_strtolower($target)]) && !Sj_find_table($target))
					$err[] = "$where: ".t9n("[RU]таблица ссылки «".$target."» не найдена ни в описании, ни в базе[EN]ref table '".$target."' is neither in the schema nor in the base");
				if(isset($refTargets[mb_strtolower($target)]))
					$err[] = "$where: ".t9n("[RU]вторая ссылка на «".$target."» из одной таблицы невозможна: ссылка на таблицу у записи одна (держите вторую роль текстом или отдельным справочником)"
						."[EN]a second ref to '".$target."' from one table is impossible: one ref per target table");
				$refTargets[mb_strtolower($target)] = TRUE;
			}
			elseif(isset($f["type"]) && Sj_base_id($f["type"]) === FALSE)
				$err[] = "$where: ".t9n("[RU]неизвестный тип «".$f["type"]."»[EN]unknown type '".$f["type"]."'")
					." (".implode(", ", array_values($GLOBALS["basics"])).")";
			else
				Sj_term_want(trim($f["name"]), isset($f["type"]) ? Sj_base_id($f["type"]) : NULL, "«".$t["name"]."».«".trim($f["name"])."»", $want);
		}
	}
	$err = array_merge($err, Sj_term_bases($want));
	foreach(isset($spec["roles"]) && is_array($spec["roles"]) ? $spec["roles"] : array() as $i => $r){
		if(!is_array($r) || !isset($r["name"]) || trim((string)$r["name"]) === ""){
			$err[] = "roles[$i]: ".t9n("[RU]нужно имя роли (name)[EN]role name is required");
			continue;
		}
		foreach(isset($r["grants"]) && is_array($r["grants"]) ? $r["grants"] : array() as $j => $g){
			$where = "roles[«".$r["name"]."»].grants[$j]";
			if(!is_array($g)){
				$err[] = "$where: ".t9n("[RU]право — объект[EN]a grant must be an object");
				continue;
			}
			$level = strtoupper(isset($g["level"]) ? trim((string)$g["level"]) : "");
			if(!in_array($level, array("READ", "WRITE", "BARRED"), TRUE))
				$err[] = "$where: ".t9n("[RU]уровень level — READ, WRITE или BARRED[EN]level must be READ, WRITE or BARRED");
			if(!isset($g["table"]) && !isset($g["report"]) && !isset($g["object"]))
				$err[] = "$where: ".t9n("[RU]укажите table (и field), report или object[EN]give table (and field), report or object");
			elseif(isset($g["table"]) && !isset($names[mb_strtolower(trim($g["table"]))]) && !Sj_find_table(trim($g["table"])))
				$err[] = "$where: ".t9n("[RU]таблица «".$g["table"]."» не найдена[EN]table '".$g["table"]."' not found");
		}
	}
	foreach(isset($spec["reports"]) && is_array($spec["reports"]) ? $spec["reports"] : array() as $i => $rep){
		if(!is_array($rep) || !isset($rep["name"]) || trim((string)$rep["name"]) === ""){
			$err[] = "reports[$i]: ".t9n("[RU]нужно имя отчёта (name)[EN]report name is required");
			continue;
		}
		foreach(isset($rep["columns"]) && is_array($rep["columns"]) ? $rep["columns"] : array() as $j => $c){
			$where = "reports[«".$rep["name"]."»].columns[$j]";
			if(!is_array($c) || !isset($c["name"]) || trim((string)$c["name"]) === "")
				$err[] = "$where: ".t9n("[RU]нужно имя колонки (name)[EN]column name is required");
			elseif(!isset($c["table"]) && !isset($c["formula"]))
				$err[] = "$where: ".t9n("[RU]укажите table (и field) или formula[EN]give table (and field) or formula");
			elseif(isset($c["table"]) && !isset($names[mb_strtolower(trim($c["table"]))]) && !Sj_find_table(trim($c["table"])))
				$err[] = "$where: ".t9n("[RU]таблица «".$c["table"]."» не найдена[EN]table '".$c["table"]."' not found");
		}
	}
	return $err;
}
# Запомнить, каким базовым типом описание задаёт термин (NULL — тип не задан)
function Sj_term_want($name, $base, $where, &$want)
{
	$k = mb_strtolower($name);
	if(!isset($want[$k]))
		$want[$k] = array("name" => $name, "bases" => array());
	if($base !== NULL && $base !== FALSE && !isset($want[$k]["bases"][$base]))
		$want[$k]["bases"][$base] = $where;
}
# Базовый тип каждого термина описания: заданный в описании, иначе существующего термина,
# иначе SHORT. Ошибка — два разных типа в описании или тип, отличный от существующего термина.
function Sj_term_bases($want)
{
	$err = array();
	$GLOBALS["SJ_BASE"] = array();
	foreach($want as $k => $w){
		if(count($w["bases"]) > 1){
			$list = array();
			foreach($w["bases"] as $b => $where)
				$list[] = "$where: ".Sj_base_name($b);
			$list = implode(", ", $list);
			$err[] = t9n("[RU]Термин «".$w["name"]."» описан с разными типами (".$list.") — у термина одно имя и один тип"
				."[EN]Term '".$w["name"]."' is described with different types (".$list.") — a term has one name and one type");
			continue;
		}
		$asked = count($w["bases"]) ? (int)key($w["bases"]) : NULL;
		$terms = Sj_terms($w["name"]);
		if($asked !== NULL && count($terms) && !Sj_term($w["name"], $asked)){
			$have = Sj_base_name((int)$terms[0]["t"]);
			$err[] = reset($w["bases"]).": ".t9n("[RU]термин «".$w["name"]."» уже есть с типом ".$have." (id ".$terms[0]["id"]."), запрошен ".Sj_base_name($asked)
				." — второй термин с тем же именем не создаётся: уберите type, задайте ".$have." или выберите другое имя"
				."[EN]term '".$w["name"]."' exists with type ".$have." (id ".$terms[0]["id"]."), requested ".Sj_base_name($asked)
				." — a second term with the same name is not created: drop type, use ".$have." or pick another name");
			continue;
		}
		$GLOBALS["SJ_BASE"][$k] = $asked !== NULL ? $asked : (count($terms) ? (int)Sj_term($w["name"])["t"] : (int)$GLOBALS["BT"]["SHORT"]);
	}
	return $err;
}
function Sj_want_base($name)
{
	$k = mb_strtolower($name);
	return isset($GLOBALS["SJ_BASE"][$k]) ? $GLOBALS["SJ_BASE"][$k] : (int)$GLOBALS["BT"]["SHORT"];
}

# Таблицы описания вместе с подчинёнными (children) — плоским списком; у подчинённой
# в "parent" имя родителя.
function Schema_flat_tables($list, $parent, &$err)
{
	$out = array();
	if(!is_array($list)){
		$err[] = t9n("[RU]tables — массив таблиц[EN]tables must be an array");
		return $out;
	}
	foreach($list as $i => $t){
		if(!is_array($t) || !isset($t["name"]) || trim((string)$t["name"]) === ""){
			$err[] = ($parent === NULL ? "tables[$i]" : "«".$parent."».children[$i]").": ".t9n("[RU]нужно имя таблицы (name)[EN]table name is required");
			continue;
		}
		$t["name"] = trim($t["name"]);
		if(isset($t["type"]) && Sj_base_id($t["type"]) === FALSE)
			$err[] = "«".$t["name"]."»: ".t9n("[RU]неизвестный тип первой колонки «".$t["type"]."»[EN]unknown first column type '".$t["type"]."'");
		$t["parent"] = $parent;
		$out[] = $t;
		if(isset($t["children"]))
			$out = array_merge($out, Schema_flat_tables($t["children"], $t["name"], $err));
	}
	return $out;
}

# Применить описание. Ответ — id всего, что описано, и что из этого создано.
function Schema_apply($spec)
{
	$GLOBALS["SJ"] = array("created" => 0, "existing" => 0, "updated" => 0, "warnings" => array(), "errors" => array());
	$err = Schema_validate($spec);
	if(count($err)){
		header("HTTP/1.0 400 Bad Request");
		api_dump(json_encode(array("ok" => FALSE, "errors" => $err), JSON_UNESCAPED_UNICODE), "schema.json");
	}
	$out = array("ok" => TRUE);
	$tables = Schema_flat_tables(isset($spec["tables"]) ? $spec["tables"] : array(), NULL, $err);
	$ids = array();
	# 1. Сами таблицы — чтобы ссылки могли указывать на описанные ниже
	foreach($tables as $t)
		$ids[mb_strtolower($t["name"])] = Schema_table($t, $out);
	# 2. Подчинённые таблицы — реквизитом родителя
	foreach($tables as $t)
		if($t["parent"] !== NULL)
			Schema_child($ids[mb_strtolower($t["parent"])], $t, $ids[mb_strtolower($t["name"])], $out);
	# 3. Поля
	foreach($tables as $t)
		foreach(isset($t["fields"]) && is_array($t["fields"]) ? $t["fields"] : array() as $f)
			Schema_field($ids[mb_strtolower($t["name"])], $t["name"], $f, $out);
	foreach($tables as $t)
		if($t["parent"] !== NULL && !count(Sj_type_reqs($ids[mb_strtolower($t["name"])])))
			$GLOBALS["SJ"]["warnings"][] = t9n("[RU]Подчинённая таблица «".$t["name"]."» без полей не считается табличной частью — добавьте ей хотя бы одно поле"
				."[EN]Child table '".$t["name"]."' has no fields and is not a table part yet — add at least one field");
	# 4. Отчёты — до ролей: права могут ссылаться на отчёт
	$GLOBALS["BATCH_OP"] = TRUE;	# Отказ обработчика записи — ошибка одного пункта, а не всего вызова
	try{
		foreach(isset($spec["reports"]) && is_array($spec["reports"]) ? $spec["reports"] : array() as $rep)
			Schema_report($rep, $out);
		foreach(isset($spec["roles"]) && is_array($spec["roles"]) ? $spec["roles"] : array() as $role)
			Schema_role($role, $out);
	}
	finally{
		unset($GLOBALS["BATCH_OP"]);
	}
	foreach(isset($out["tables"]) ? $out["tables"] : array() as $k => $t)	# Пустой набор полей — {} , а не []
		$out["tables"][$k]["fields"] = (object)$t["fields"];
	foreach(isset($out["reports"]) ? $out["reports"] : array() as $k => $r)
		$out["reports"][$k]["columns"] = (object)$r["columns"];
	foreach(array("created", "updated", "existing") as $k)
		$out[$k] = $GLOBALS["SJ"][$k];
	if(count($GLOBALS["SJ"]["warnings"]))
		$out["warnings"] = $GLOBALS["SJ"]["warnings"];
	if(count($GLOBALS["SJ"]["errors"])){
		$out["ok"] = FALSE;
		$out["errors"] = $GLOBALS["SJ"]["errors"];
	}
	return $out;
}
function Sj_count($what)
{
	$GLOBALS["SJ"][$what]++;
}

function Schema_table($t, &$out)
{
	global $z;
	$base = Sj_want_base($t["name"]);
	$unique = isset($t["unique"]) ? (FieldAttrsBool($t["unique"]) ? 1 : 0) : NULL;
	$row = Sj_term($t["name"], $base);
	if($row){
		$id = (int)$row["id"];
		$created = FALSE;
		Sj_count("existing");
		if($unique !== NULL && (int)$row["ord"] !== $unique){
			Exec_sql("UPDATE $z SET ord=$unique WHERE id=$id", "Schema: set the type unique flag");
			Sj_count("updated");
		}
	}
	else{
		$id = Insert(0, (int)$unique, $base, $t["name"], "Schema: create term");
		$created = TRUE;
		Sj_count("created");
	}
	$out["tables"][$t["name"]] = array("id" => $id, "created" => $created, "fields" => array());
	return $id;
}

function Schema_child($parentId, $t, $childId, &$out)
{
	$reqs = Sj_type_reqs($parentId);
	foreach($reqs as $r)
		if($r["type"] === $childId){
			$out["tables"][$t["name"]]["parent"] = $parentId;
			$out["tables"][$t["name"]]["req"] = $r["id"];
			Sj_count("existing");
			return;
		}
	$req = Insert($parentId, Get_Ord($parentId), $childId, "", "Schema: add child table");
	Sj_count("created");
	$out["tables"][$t["name"]]["parent"] = $parentId;
	$out["tables"][$t["name"]]["req"] = $req;
}

function Schema_field($tableId, $tableName, $f, &$out)
{
	global $z;
	$name = trim($f["name"]);
	$reqs = Sj_type_reqs($tableId);
	$existing = Sj_req_by_name($reqs, $name);
	if(isset($f["ref"])){
		$target = Sj_find_table(trim($f["ref"]));
		$targetId = (int)$target["id"];
		$targetName = trim($f["ref"]);
		if($existing && !($existing["kind"] === "ref" && $existing["target"] === $targetId))
			return Sj_field_conflict($tableName, $name, $existing, t9n("[RU]ссылка на «".$targetName."»[EN]ref to '".$targetName."'"));
		if(!$existing)	# Ссылка на ту же таблицу под другим именем — это тот же реквизит
			foreach($reqs as $r)
				if($r["kind"] === "ref" && $r["target"] === $targetId)
					return Sj_field_conflict($tableName, $name, $r, t9n("[RU]ссылка на «".$targetName."»[EN]ref to '".$targetName."'"));
		$alias = (mb_strtolower($name) === mb_strtolower($targetName)) ? NULL : $name;
		if(!$existing){
			$ref = mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE up=0 AND t=$targetId AND val='' LIMIT 1", "Schema: find the ref type"));
			$refType = $ref ? (int)$ref["id"] : Insert(0, 0, $targetId, "", "Schema: create ref type");
			$id = Insert($tableId, Get_Ord($tableId), $refType, Sj_attrs("", $f, $alias), "Schema: add ref field");
			Sj_count("created");
			$out["tables"][$tableName]["fields"][$name] = $id;
			return;
		}
	}
	else{
		$base = Sj_want_base($name);
		$term = Sj_term($name, $base);
		$type = $term ? (int)$term["id"] : NULL;
		if($existing && $existing["type"] !== $type)	# Под этим именем в таблице другой термин (например ссылка)
			return Sj_field_conflict($tableName, $name, $existing, Sj_base_name($base));
		if(!$existing && $type !== NULL)
			foreach($reqs as $r)
				if($r["type"] === $type)	# Тот же термин под псевдонимом — это то же поле
					$existing = $r;
		if(!$existing){
			if($type === NULL)
				$type = Insert(0, 0, $base, $name, "Schema: create term");
			elseif((int)$term["nreq"] > 0)
				$GLOBALS["SJ"]["warnings"][] = t9n("[RU]«".$tableName."».«".$name."»: термин «".$name."» — таблица со своими полями, в «".$tableName."» он стал подчинённой таблицей; для ссылки на её записи задайте ref"
					."[EN]'".$tableName."'.'".$name."': term '".$name."' is a table with fields, in '".$tableName."' it became a child table; for a reference use ref");
			$id = Insert($tableId, Get_Ord($tableId), $type, Sj_attrs("", $f, NULL), "Schema: add field");
			Sj_count("created");
			$out["tables"][$tableName]["fields"][$name] = $id;
			return;
		}
	}
	# Поле есть: при необходимости поправить флаги
	$attrs = Sj_attrs($existing["attrs"], $f, isset($alias) ? $alias : ($existing["alias"] !== "" ? $existing["alias"] : NULL));
	if($attrs !== $existing["attrs"] && FieldAttrsSerialize($existing["attrs"]) !== $attrs){
		Update_Val($existing["id"], $attrs);
		Sj_count("updated");
	}
	else
		Sj_count("existing");
	$out["tables"][$tableName]["fields"][$name] = $existing["id"];
}
function Sj_field_conflict($tableName, $name, $r, $want)
{
	$have = $r["kind"] === "ref" ? t9n("[RU]ссылка на «".$r["type_name"]."»[EN]ref to '".$r["type_name"]."'")
			: ($r["kind"] === "child" ? t9n("[RU]подчинённая таблица[EN]child table") : $r["base"]);
	$GLOBALS["SJ"]["errors"][] = t9n("[RU]«".$tableName."».«".$name."»: уже есть поле «".$r["name"]."» (".$have.", id ".$r["id"]."), а описано ".$want." — не меняю"
		."[EN]'".$tableName."'.'".$name."': field '".$r["name"]."' exists (".$have.", id ".$r["id"]."), described as ".$want." — not changed");
}
# Атрибуты реквизита: заданные в описании флаги поверх прежних
function Sj_attrs($previous, $f, $alias)
{
	$p = FieldAttrsParse($previous);
	foreach(array("required", "multi", "key") as $flag)
		if(isset($f[$flag]))
			$p[$flag] = FieldAttrsBool($f[$flag]);
	if(isset($f["default"]))
		$p["default"] = Json_scalar($f["default"]);
	$p["alias"] = $alias;
	return FieldAttrsSerialize($p);
}

# ── Роли и права ───────────────────────────────────────────────────────────────────────────
function Schema_role($role, &$out)
{
	global $z;
	$name = trim($role["name"]);
	$res = array("grants" => array());
	try{
		$row = mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE t=".ROLE." AND up=1 AND val='".Sj_q($name)."' LIMIT 1", "Schema: find the role"));
		$roleReqs = Sj_type_reqs(ROLE);
		$descReq = Sj_req_by_name($roleReqs, "Описание");
		if($row){
			$roleId = (int)$row["id"];
			$res["created"] = FALSE;
			Sj_count("existing");
			if(isset($role["description"]) && $descReq)
				ApplyOp("set", $roleId, array("t".$descReq["id"] => Json_scalar($role["description"])));
		}
		else{
			$fields = array("t".ROLE => $name);
			if(isset($role["description"]) && $descReq)
				$fields["t".$descReq["id"]] = Json_scalar($role["description"]);
			ApplyOp("new", ROLE, $fields, 1, $roleId);
			$res["created"] = TRUE;
			Sj_count("created");
		}
		$res["id"] = (int)$roleId;
	}
	catch(IntegramOpError $e){
		$GLOBALS["SJ"]["errors"][] = t9n("[RU]Роль[EN]Role")." «".$name."»: ".$e->getMessage();
		$out["roles"][$name] = $res;
		return;
	}
	$grantReqs = Sj_type_reqs(ROLE_OBJECT);
	$levelReq = NULL;
	foreach($grantReqs as $r)
		if($r["kind"] === "ref" && $levelReq === NULL)
			$levelReq = $r;
	$maskReq = Sj_req_by_name($grantReqs, "Маска");
	$exportReq = Sj_req_by_name($grantReqs, "EXPORT") ?: Sj_req_by_name($grantReqs, "Экспорт");
	$deleteReq = Sj_req_by_name($grantReqs, "DELETE") ?: Sj_req_by_name($grantReqs, "Удаление");
	foreach(isset($role["grants"]) && is_array($role["grants"]) ? $role["grants"] : array() as $g){
		$level = strtoupper(trim($g["level"]));
		$what = Sj_grant_label($g);
		try{
			$obj = Sj_grant_object($g);
			if(!$levelReq)
				throw new IntegramOpError(t9n("[RU]в таблице прав нет уровня доступа[EN]the grants table has no access level"));
			$lv = mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE t=".$levelReq["target"]." AND val='$level' LIMIT 1", "Schema: find the access level"));
			if(!$lv)
				throw new IntegramOpError(t9n("[RU]уровень $level не найден[EN]level $level not found"));
			$fields = array("t".$levelReq["id"] => $lv["id"]);
			if($maskReq && array_key_exists("mask", $g))
				$fields["t".$maskReq["id"]] = Json_scalar($g["mask"]);
			if($exportReq && isset($g["export"]))
				$fields["t".$exportReq["id"]] = FieldAttrsBool($g["export"]) ? "1" : "";
			if($deleteReq && isset($g["delete"]))
				$fields["t".$deleteReq["id"]] = FieldAttrsBool($g["delete"]) ? "1" : "";
			$row = mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE up=$roleId AND t=".ROLE_OBJECT." AND val='$obj' LIMIT 1", "Schema: find the grant"));
			if($row){
				$grantId = (int)$row["id"];
				$cur = Sj_grant_current($grantId, array_keys($fields), array("t".$levelReq["id"]));
				$diff = array();
				foreach($fields as $k => $v)
					if((string)$cur[$k] !== (string)$v)
						$diff[$k] = $v;
				if(count($diff)){
					ApplyOp("set", $grantId, $diff);
					Sj_count("updated");
				}
				else
					Sj_count("existing");
				$created = FALSE;
			}
			else{
				ApplyOp("new", ROLE_OBJECT, array("t".ROLE_OBJECT => $obj) + $fields, $roleId, $grantId);
				Sj_count("created");
				$created = TRUE;
			}
			$res["grants"][] = array("object" => $what, "object_id" => (int)$obj, "id" => (int)$grantId, "level" => $level, "created" => $created);
		}
		catch(IntegramOpError $e){
			$GLOBALS["SJ"]["errors"][] = t9n("[RU]Роль[EN]Role")." «".$name."», ".$what.": ".$e->getMessage();
		}
	}
	$out["roles"][$name] = $res;
}
function Sj_grant_label($g)
{
	if(isset($g["report"]))
		return t9n("[RU]отчёт[EN]report")." «".$g["report"]."»";
	if(isset($g["object"]))
		return "object ".Json_scalar($g["object"]);
	return "«".$g["table"]."»".(isset($g["field"]) ? ".«".$g["field"]."»" : "");
}
# Объект права: таблица, поле таблицы, отчёт или служебный объект (types/all/files или id)
function Sj_grant_object($g)
{
	global $z;
	if(isset($g["object"])){
		$special = array("TYPES" => 0, "ALL" => 1, "FILES" => 10);
		$o = strtoupper(trim(Json_scalar($g["object"])));
		if(isset($special[$o]))
			return $special[$o];
		if(ctype_digit($o))
			return (int)$o;
		throw new IntegramOpError(t9n("[RU]object — types, all, files или id[EN]object must be types, all, files or an id"));
	}
	if(isset($g["report"])){
		$row = mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE t=".REPORT." AND val='".Sj_q(trim($g["report"]))."' LIMIT 1", "Schema: find the report"));
		if(!$row)
			throw new IntegramOpError(t9n("[RU]отчёт не найден[EN]report not found"));
		return (int)$row["id"];
	}
	$table = Sj_find_table(trim($g["table"]));
	if(!$table)
		throw new IntegramOpError(t9n("[RU]таблица не найдена[EN]table not found"));
	if(!isset($g["field"]))
		return (int)$table["id"];
	$req = Sj_req_by_name(Sj_type_reqs($table["id"]), trim($g["field"]));
	if(!$req)
		throw new IntegramOpError(t9n("[RU]поле не найдено[EN]field not found"));
	return $req["id"];
}
# Текущие значения реквизитов записи. Строка ссылки хранится «наоборот» (t — запись-цель,
# val — id реквизита), поэтому ссылки читаются только по реквизитам из $refKeys, а не по
# виду значения: число в val бывает и у обычного поля.
function Sj_grant_current($recId, $keys, $refKeys = array())
{
	global $z;
	$cur = array_fill_keys($keys, "");
	foreach(Sj_rows("SELECT t, val FROM $z WHERE up=".(int)$recId, "Schema: read the record values") as $row){
		if(in_array("t".$row["val"], $refKeys, TRUE) && isset($cur["t".$row["val"]]))
			$cur["t".$row["val"]] = $row["t"];
		elseif(isset($cur["t".$row["t"]]) && !in_array("t".$row["t"], $refKeys, TRUE))
			$cur["t".$row["t"]] = $row["val"];
	}
	return $cur;
}

# ── Отчёты ─────────────────────────────────────────────────────────────────────────────────
function Schema_report($rep, &$out)
{
	global $z;
	$name = trim($rep["name"]);
	$res = array("columns" => array());
	try{
		$row = mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE t=".REPORT." AND val='".Sj_q($name)."' LIMIT 1", "Schema: find the report"));
		if($row){
			$repId = (int)$row["id"];
			$res["created"] = FALSE;
			Sj_count("existing");
		}
		else{
			ApplyOp("new", REPORT, array("t".REPORT => $name), 1, $repId);
			$res["created"] = TRUE;
			Sj_count("created");
		}
		$res["id"] = (int)$repId;
	}
	catch(IntegramOpError $e){
		$GLOBALS["SJ"]["errors"][] = t9n("[RU]Отчёт[EN]Report")." «".$name."»: ".$e->getMessage();
		$out["reports"][$name] = $res;
		return;
	}
	$colReqs = Sj_type_reqs(REP_COLS);
	$funcReq = NULL;
	foreach($colReqs as $r)	# Функция колонки — ссылка на справочник функций (REP_COL_FUNC)
		if($r["kind"] === "ref" && $r["target"] === REP_COL_FUNC)
			$funcReq = $r;
	foreach(isset($rep["columns"]) && is_array($rep["columns"]) ? $rep["columns"] : array() as $c){
		$cname = trim($c["name"]);
		try{
			$src = "0";
			if(isset($c["table"])){
				$table = Sj_find_table(trim($c["table"]));
				if(!$table)
					throw new IntegramOpError(t9n("[RU]таблица «".$c["table"]."» не найдена[EN]table '".$c["table"]."' not found"));
				$src = (string)$table["id"];
				if(isset($c["field"]) && mb_strtolower(trim($c["field"])) !== mb_strtolower(trim($c["table"]))){
					$req = Sj_req_by_name(Sj_type_reqs($table["id"]), trim($c["field"]));
					if(!$req)
						throw new IntegramOpError(t9n("[RU]в «".$c["table"]."» нет поля «".$c["field"]."»[EN]no field '".$c["field"]."' in '".$c["table"]."'"));
					$src = (string)$req["id"];
				}
			}
			$fields = array();
			if(isset($c["formula"]))
				$fields["t".REP_COL_FORMULA] = Json_scalar($c["formula"]);
			if(isset($c["hide"]))
				$fields["t".REP_COL_HIDE] = FieldAttrsBool($c["hide"]) ? "1" : "";
			if(isset($c["sort"]))
				$fields["t".REP_COL_SORT] = Json_scalar($c["sort"]);
			if(isset($c["from"]))
				$fields["t".REP_COL_FROM] = Json_scalar($c["from"]);
			if(isset($c["to"]))
				$fields["t".REP_COL_TO] = Json_scalar($c["to"]);
			if(isset($c["func"])){
				$func = strtoupper(trim($c["func"]));
				$f = ($func === "" || !$funcReq) ? NULL : mysqli_fetch_assoc(Exec_sql("SELECT id FROM $z WHERE t=".$funcReq["target"]." AND val='".Sj_q($func)."' LIMIT 1", "Schema: find the column function"));
				if($func !== "" && !$f)
					throw new IntegramOpError(t9n("[RU]функция «".$c["func"]."» не найдена[EN]function '".$c["func"]."' not found"));
				$fields["t".$funcReq["id"]] = $f ? $f["id"] : "";
			}
			$row = mysqli_fetch_assoc(Exec_sql("SELECT c.id, c.val FROM $z c JOIN $z n ON n.up=c.id AND n.t=".REP_COL_NAME
					." WHERE c.up=$repId AND c.t=".REP_COLS." AND n.val='".Sj_q($cname)."' LIMIT 1", "Schema: find the report column"));
			if($row){
				$colId = (int)$row["id"];
				$cur = Sj_grant_current($colId, array_keys($fields), $funcReq ? array("t".$funcReq["id"]) : array());
				$diff = array();
				foreach($fields as $k => $v)
					if((string)$cur[$k] !== (string)$v)
						$diff[$k] = $v;
				if((string)$row["val"] !== $src)
					$diff["t".REP_COLS] = $src;
				if(count($diff)){
					ApplyOp("set", $colId, $diff);
					Sj_count("updated");
				}
				else
					Sj_count("existing");
			}
			else{
				ApplyOp("new", REP_COLS, array("t".REP_COLS => $src, "t".REP_COL_NAME => $cname) + $fields, $repId, $colId);
				Sj_count("created");
			}
			$res["columns"][$cname] = (int)$colId;
		}
		catch(IntegramOpError $e){
			$GLOBALS["SJ"]["errors"][] = t9n("[RU]Отчёт[EN]Report")." «".$name."», ".t9n("[RU]колонка[EN]column")." «".$cname."»: ".$e->getMessage();
		}
	}
	$out["reports"][$name] = $res;
}
