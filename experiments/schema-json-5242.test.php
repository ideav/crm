<?php
# Мерка к issue #5242: схема одним JSON (_d_schema), поля по именам (_m_new/_m_set/_m_batch)
# и чтение записей с ключами-именами (object/…?JSON_OBJ&NAMED).
# https://github.com/ideav/crm/issues/5242
#
# Запуск: php experiments/schema-json-5242.test.php (в гейте — через одноимённый .test.js)
#
# Код берётся ИЗ ЯДРА как есть (include/schema_json.php) и выполняется в своём пространстве
# имён поверх БД в памяти: Exec_sql, mysqli_fetch_*, Insert, Update_Val и ApplyOp подменены.
# Подмена ApplyOp кладёт запись так же, как _m_new/_m_set (значение — строка t=<реквизит>,
# ссылка — строка t=<цель>, val=<реквизит>), без их проверок прав: права проверяет
# прогон на стенде (experiments/schema-json-5242-stand.php).
#
# Что проверяется:
#   1) создание таблиц, полей, ссылки, подчинённой таблицы, роли с правами и отчёта по именам;
#   2) повторный вызов того же описания ничего не создаёт (created=0);
#   3) смена уровня права и маски — правка существующей записи права, а не новая запись;
#   4) ошибки описания (тип, цель ссылки, вторая ссылка на ту же таблицу, уровень,
#      один термин с двумя типами) — до записи;
#   4а) имя термина одно: существующий термин переиспользуется и таблицей, и полем; тот же
#      термин с другим базовым типом — 400 с именем, существующим и запрошенным типом;
#   5) поле с типом, отличным от существующего термина, — ошибка, поле не меняется;
#   6) поля по именам: имя колонки, имя таблицы (главное значение), ссылка по значению, t{id};
#   7) неизвестное имя: строго — ошибка, в пакете — ключ как есть и имя в списке;
#   8) чтение: строки JSON_OBJ — объекты с именами, ссылка {id,val}, подчинённая {table,count}.

namespace T5242;

error_reporting(E_ALL & ~E_DEPRECATED);
mb_internal_encoding("UTF-8");

$failed = 0;
function ok($cond, $name, $info = ""){
	global $failed;
	if($cond)
		echo "  ok   $name\n";
	else{
		echo "  FAIL $name".($info === "" ? "" : " — $info")."\n";
		$failed++;
	}
}
function shown($v){ return json_encode($v, JSON_UNESCAPED_UNICODE); }

require_once __DIR__."/../include/field_attrs.php";
define("ROLE", 42);
define("ROLE_OBJECT", 116);
define("REPORT", 22);
define("REP_COLS", 28);
define("REP_COL_NAME", 100);
define("REP_COL_FORMULA", 101);
define("REP_COL_FROM", 102);
define("REP_COL_TO", 103);
define("REP_COL_FUNC", 63);
define("REP_COL_HIDE", 107);
define("REP_COL_SORT", 109);
$GLOBALS["basics"] = array(3 => "SHORT", 8 => "CHARS", 9 => "DATE", 13 => "NUMBER", 14 => "SIGNED", 11 => "BOOLEAN"
	, 12 => "MEMO", 4 => "DATETIME", 10 => "FILE", 2 => "HTML", 7 => "BUTTON", 6 => "PWD", 5 => "GRANT"
	, 15 => "CALCULATABLE", 16 => "REPORT_COLUMN", 17 => "PATH");
$GLOBALS["BT"] = array_flip($GLOBALS["basics"]);
$z = "t";

class IntegramOpError extends \Exception {}
class Died extends \Exception {}
function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function InBatchOp(){ return !empty($GLOBALS["BATCH_OP"]); }
function my_die($msg){ if(InBatchOp()) throw new IntegramOpError($msg); throw new Died($msg); }
function api_dump($json){ $GLOBALS["DUMP"] = $json; throw new Died("api_dump"); }
function header($h){}

# ── БД в памяти ───────────────────────────────────────────────────────────────────────────
$DB = array();
$NEXT = 1000;
function row($id, $up, $ord, $t, $val){ $GLOBALS["DB"][$id] = array("id" => $id, "up" => $up, "ord" => $ord, "t" => $t, "val" => (string)$val); }
function seed(){
	$GLOBALS["DB"] = array();
	$GLOBALS["NEXT"] = 1000;
	foreach($GLOBALS["basics"] as $id => $n)
		row($id, 0, 0, $id, $n);
	row(1, 1, 0, 1, "ROOT");
	row(42, 0, 0, 3, "Роль");          row(119, 0, 0, 12, "Описание");  row(135, 42, 3, 119, "");
	row(116, 0, 0, 5, "Объекты");       row(117, 42, 1, 116, "");
	row(47, 0, 0, 3, "Доступ");         row(121, 0, 0, 47, "");          row(136, 116, 1, 121, "");
	row(48, 0, 0, 3, "Маска");          row(49, 116, 2, 48, "");
	row(52, 1, 1, 47, "BARRED");        row(53, 1, 1, 47, "READ");       row(54, 1, 1, 47, "WRITE");
	row(22, 0, 0, 3, "Запрос");         row(28, 0, 0, 16, "Колонки запроса"); row(99, 22, 1, 28, "");
	row(26, 0, 0, 3, "Имя в отчете");   row(100, 28, 1, 26, "");
	row(25, 0, 0, 8, "Формула");        row(101, 28, 2, 25, "");
	row(63, 0, 0, 8, "Функция");        row(64, 0, 0, 63, "");           row(104, 28, 5, 64, "");
	row(27, 0, 0, 11, "Скрыть");        row(107, 28, 8, 27, "");
	row(73, 1, 1, 63, "SUM");           row(74, 1, 1, 63, "COUNT");
}
class Res { public $rows; function __construct($rows){ $this->rows = array_values($rows); } }
function mysqli_fetch_assoc($res){ return ($res instanceof Res && count($res->rows)) ? array_shift($res->rows) : NULL; }
function mysqli_fetch_array($res){ $r = mysqli_fetch_assoc($res); return $r === NULL ? NULL : array_merge(array_values($r), $r); }
function rows_where($f){ return array_filter($GLOBALS["DB"], $f); }
function nreq($id){ return count(rows_where(function($r) use ($id){ return $r["up"] == $id && $r["t"] != $r["up"]; })); }
function m($re, $sql){ if(!preg_match($re, $sql, $mm)) throw new \Exception("не разобран запрос: $sql"); return $mm; }
function Exec_sql($sql, $msg){
	$DB = &$GLOBALS["DB"];
	$GLOBALS["SQL_LOG"][] = $msg;
	switch($msg){
		case "Schema: find the term by name":
			$v = stripslashes(m("/t\.val='((?:[^'\\\\]|\\\\.)*)'/u", $sql)[1]);
			return new Res(array_map(function($r){ return array("id" => $r["id"], "t" => $r["t"], "ord" => $r["ord"], "nreq" => nreq($r["id"])); }
				, rows_where(function($r) use ($v){ return $r["up"] == 0 && $r["val"] === $v && $r["id"] != $r["t"] && isset($GLOBALS["basics"][$r["t"]]); })));
		case "Schema: is the type a field":
			$id = (int)m("/r\.t=(\d+)/", $sql)[1];
			return new Res(array_slice(array_map(function(){ return array("1" => 1); }, rows_where(function($r) use ($id){
				return $r["t"] == $id && $r["up"] != $r["t"] && isset($GLOBALS["DB"][$r["up"]]) && $GLOBALS["DB"][$r["up"]]["up"] == 0; })), 0, 1));
		case "Schema: get the type reqs":
			$id = (int)m("/req\.up=(\d+)/", $sql)[1];
			$reqs = rows_where(function($r) use ($id){ return $r["up"] == $id && $r["t"] != $r["up"]; });
			usort($reqs, function($a, $b){ return $a["ord"] - $b["ord"]; });
			$out = array();
			foreach($reqs as $r){
				$typ = $DB[$r["t"]];
				$ref = isset($DB[$typ["t"]]) && $DB[$typ["t"]]["t"] != $DB[$typ["t"]]["id"] ? $DB[$typ["t"]] : NULL;
				$out[] = array("id" => $r["id"], "ord" => $r["ord"], "typ" => $r["t"], "attrs" => $r["val"], "tbase" => $typ["t"], "tname" => $typ["val"]
					, "ref" => $ref ? $ref["id"] : NULL, "rname" => $ref ? $ref["val"] : NULL, "rbase" => $ref ? $ref["t"] : NULL
					, "arr" => nreq($typ["id"]) ? 1 : NULL);
			}
			return new Res($out);
		case "Schema: find the ref type":
			$id = (int)m("/t=(\d+)/", $sql)[1];
			return new Res(array_slice(rows_where(function($r) use ($id){ return $r["up"] == 0 && $r["t"] == $id && $r["val"] === ""; }), 0, 1));
		case "Schema: find the field type":
			$b = (int)m("/t\.t=(\d+)/", $sql)[1];
			$v = stripslashes(m("/t\.val='((?:[^'\\\\]|\\\\.)*)'/u", $sql)[1]);
			return new Res(array_map(function($r){ return array("id" => $r["id"], "nreq" => nreq($r["id"])); }
				, rows_where(function($r) use ($b, $v){ return $r["up"] == 0 && $r["t"] == $b && $r["val"] === $v && $r["id"] != $r["t"]; })));
		case "Schema: set the type unique flag":
			$mm = m("/ord=(\d+) WHERE id=(\d+)/", $sql);
			$DB[(int)$mm[2]]["ord"] = (int)$mm[1];
			return TRUE;
		case "Named fields: get the table":
			$id = (int)m("/id=(\d+)/", $sql)[1];
			return new Res(isset($DB[$id]) && $DB[$id]["up"] == 0 ? array(array("val" => $DB[$id]["val"])) : array());
		case "Named fields: get the record type":
			$id = (int)m("/id=(\d+)/", $sql)[1];
			return new Res(isset($DB[$id]) && $DB[$id]["up"] != 0 ? array(array("t" => $DB[$id]["t"])) : array());
		case "Named fields: find the ref record by value":
			$t = (int)m("/t=(\d+)/", $sql)[1];
			$v = stripslashes(m("/val='((?:[^'\\\\]|\\\\.)*)'/u", $sql)[1]);
			return new Res(array_slice(rows_where(function($r) use ($t, $v){ return $r["t"] == $t && $r["up"] != 0 && $r["val"] === $v; }), 0, 2));
		case "Schema: find the role":
		case "Schema: find the report":
			$t = (int)m("/t=(\d+)/", $sql)[1];
			$v = stripslashes(m("/val='((?:[^'\\\\]|\\\\.)*)'/u", $sql)[1]);
			return new Res(array_slice(rows_where(function($r) use ($t, $v){ return $r["t"] == $t && $r["up"] == 1 && $r["val"] === $v; }), 0, 1));
		case "Schema: find the access level":
		case "Schema: find the column function":
			$t = (int)m("/t=(\d+)/", $sql)[1];
			$v = stripslashes(m("/val='((?:[^'\\\\]|\\\\.)*)'/u", $sql)[1]);
			return new Res(array_slice(rows_where(function($r) use ($t, $v){ return $r["t"] == $t && $r["val"] === $v; }), 0, 1));
		case "Schema: find the grant":
			$mm = m("/up=(\d+) AND t=(\d+) AND val='(\d+)'/", $sql);
			return new Res(array_slice(rows_where(function($r) use ($mm){ return $r["up"] == $mm[1] && $r["t"] == $mm[2] && $r["val"] === $mm[3]; }), 0, 1));
		case "Schema: read the record values":
			$id = (int)m("/up=(\d+)/", $sql)[1];
			return new Res(rows_where(function($r) use ($id){ return $r["up"] == $id; }));
		case "Schema: find the report column":
			$mm = m("/c\.up=(\d+).*n\.val='((?:[^'\\\\]|\\\\.)*)'/u", $sql);
			foreach(rows_where(function($r) use ($mm){ return $r["up"] == $mm[1] && $r["t"] == REP_COLS; }) as $c)
				foreach(rows_where(function($r) use ($c){ return $r["up"] == $c["id"] && $r["t"] == REP_COL_NAME; }) as $n)
					if($n["val"] === stripslashes($mm[2]))
						return new Res(array(array("id" => $c["id"], "val" => $c["val"])));
			return new Res(array());
	}
	throw new \Exception("неожиданный запрос [$msg]: $sql");
}
function Insert($up, $ord, $t, $val, $message){
	$id = ++$GLOBALS["NEXT"];
	row($id, $up, $ord, $t, $val);
	$GLOBALS["INSERTS"][] = $message;
	return $id;
}
function Get_Ord($parent){ $m = 0; foreach($GLOBALS["DB"] as $r) if($r["up"] == $parent) $m = max($m, $r["ord"]); return $m + 1; }
function Update_Val($id, $val){ $GLOBALS["DB"][$id]["val"] = (string)$val; }
# ApplyOp: запись как у _m_new/_m_set. Реквизит-ссылка (по метаданным типа) — строка t=цель, val=реквизит.
function ApplyOp($op, $rec, $fields, $up = 0, &$newRec = NULL){
	$GLOBALS["OPS"][] = array($op, $rec, $fields, $up);
	$type = $op === "new" ? $rec : $GLOBALS["DB"][$rec]["t"];
	$refs = array();
	foreach(Sj_type_reqs($type) as $r)
		if($r["kind"] === "ref")
			$refs[$r["id"]] = TRUE;
	if($op === "new"){
		$newRec = Insert($up, 1, $rec, isset($fields["t$rec"]) ? $fields["t$rec"] : "", "op new");
		$rec = $newRec;
	}
	foreach($fields as $k => $v){
		$t = (int)substr($k, 1);
		if($t === (int)$type){ $GLOBALS["DB"][$rec]["val"] = (string)$v; continue; }
		foreach($GLOBALS["DB"] as $id => $r)	# прежнее значение реквизита — долой
			if($r["up"] == $rec && (isset($refs[$t]) ? $r["val"] === (string)$t : $r["t"] == $t))
				unset($GLOBALS["DB"][$id]);
		if((string)$v !== "")
			isset($refs[$t]) ? Insert($rec, 1, (int)$v, (string)$t, "ref") : Insert($rec, 1, $t, $v, "val");
	}
	return "";
}

# ── Код ядра ──────────────────────────────────────────────────────────────────────────────
$src = file_get_contents(__DIR__."/../include/schema_json.php");
if($src === FALSE){
	fwrite(STDERR, "В ядре нет include/schema_json.php — мерка потеряла предмет\n");
	exit(1);
}
eval("namespace T5242;\n".preg_replace('/^<\?php/', "", $src));

function schema($spec){
	try{ return json_decode(json_encode(Schema_apply($spec), JSON_UNESCAPED_UNICODE), TRUE); }	# как в ответе API
	catch(Died $e){ return json_decode($GLOBALS["DUMP"], TRUE); }
}
function find($up, $t, $val = NULL){
	foreach($GLOBALS["DB"] as $r)
		if($r["up"] == $up && $r["t"] == $t && ($val === NULL || $r["val"] === (string)$val))
			return $r;
	return NULL;
}

$SPEC = array(
	"tables" => array(
		array("name" => "Компания", "unique" => TRUE, "fields" => array(array("name" => "ИНН"), array("name" => "Лимит", "type" => "NUMBER"))),
		array("name" => "Заявка", "fields" => array(array("name" => "Компания", "ref" => "Компания", "required" => TRUE), array("name" => "Сумма заявки", "type" => "SIGNED")),
			"children" => array(array("name" => "Позиция заявки", "fields" => array(array("name" => "Кол-во", "type" => "NUMBER"))))),
		array("name" => "Договор", "fields" => array(array("name" => "Заявка по договору", "ref" => "Заявка"), array("name" => "Сумма договора", "type" => "decimal"))),
	),
	"reports" => array(array("name" => "Договоры", "columns" => array(
		array("name" => "Договор", "table" => "Договор"),
		array("name" => "Сумма", "table" => "Договор", "field" => "Сумма договора", "func" => "SUM"),
		array("name" => "Удвоено", "formula" => "[Сумма]*2", "hide" => TRUE)))),
	"roles" => array(array("name" => "Юрист", "description" => "Ведёт договоры", "grants" => array(
		array("table" => "Договор", "level" => "WRITE"),
		array("table" => "Заявка", "level" => "READ"),
		array("table" => "Заявка", "field" => "Сумма заявки", "level" => "BARRED"),
		array("report" => "Договоры", "level" => "READ")))),
);

echo "── 1. создание ──\n";
seed();
$res = schema($SPEC);
ok($res["ok"] === TRUE, "ответ ok", shown($res));
$comp = $res["tables"]["Компания"]["id"];
$app = $res["tables"]["Заявка"]["id"];
$pos = $res["tables"]["Позиция заявки"]["id"];
$con = $res["tables"]["Договор"]["id"];
ok($GLOBALS["DB"][$comp]["up"] == 0 && $GLOBALS["DB"][$comp]["t"] == 3 && $GLOBALS["DB"][$comp]["ord"] == 1, "Компания — таблица SHORT, уникальная");
$lim = $GLOBALS["DB"][$res["tables"]["Компания"]["fields"]["Лимит"]];
ok($lim["up"] == $comp && $GLOBALS["DB"][$lim["t"]]["t"] == 13 && $GLOBALS["DB"][$lim["t"]]["val"] === "Лимит", "Лимит — реквизит NUMBER");
$appComp = $GLOBALS["DB"][$res["tables"]["Заявка"]["fields"]["Компания"]];
ok($GLOBALS["DB"][$appComp["t"]]["t"] == $comp && $GLOBALS["DB"][$appComp["t"]]["val"] === "", "Заявка.Компания — ссылочный тип на Компанию");
ok(FieldAttrsHasRequired($appComp["val"]) && FieldAttrsAlias($appComp["val"]) === "", "ссылка обязательная, без псевдонима (имя = таблица)", $appComp["val"]);
$conApp = $GLOBALS["DB"][$res["tables"]["Договор"]["fields"]["Заявка по договору"]];
ok(FieldAttrsAlias($conApp["val"]) === "Заявка по договору", "ссылка под другим именем — псевдоним", $conApp["val"]);
ok($GLOBALS["DB"][$GLOBALS["DB"][$res["tables"]["Договор"]["fields"]["Сумма договора"]]["t"]]["t"] == 14, "тип decimal → SIGNED");
ok(find($app, $pos) !== NULL && $res["tables"]["Позиция заявки"]["parent"] === $app, "Позиция заявки — реквизит Заявки (подчинённая таблица)");
$types = array_map(function($r){ return $r["kind"]; }, Sj_type_reqs($app));
ok($types === array("child", "ref", "field"), "metadata Заявки: подчинённая, ссылка, поле", shown($types));
$role = find(1, ROLE, "Юрист");
ok($role !== NULL && $res["roles"]["Юрист"]["id"] === $role["id"], "роль Юрист создана");
ok(find($role["id"], 135, "Ведёт договоры") !== NULL, "описание роли — в её реквизите");
$g = find($role["id"], ROLE_OBJECT, $con);
ok($g !== NULL && find($g["id"], 54, "136") !== NULL, "право WRITE на Договор (ссылка на уровень 54)");
$g = find($role["id"], ROLE_OBJECT, $res["tables"]["Заявка"]["fields"]["Сумма заявки"]);
ok($g !== NULL && find($g["id"], 52, "136") !== NULL, "BARRED на поле Заявка.Сумма заявки");
$rep = find(1, REPORT, "Договоры");
ok($rep !== NULL && find($role["id"], ROLE_OBJECT, $rep["id"]) !== NULL, "отчёт создан и выдан роли по имени");
$col = $GLOBALS["DB"][$res["reports"]["Договоры"]["columns"]["Сумма"]];
ok($col["up"] == $rep["id"] && $col["val"] === (string)$res["tables"]["Договор"]["fields"]["Сумма договора"], "колонка отчёта — источник по имени поля");
ok(find($col["id"], 73, "104") !== NULL, "функция SUM — ссылка на справочник функций");
$calc = $GLOBALS["DB"][$res["reports"]["Договоры"]["columns"]["Удвоено"]];
ok($calc["val"] === "0" && find($calc["id"], 101, "[Сумма]*2") !== NULL && find($calc["id"], 107, "1") !== NULL, "вычисляемая колонка: формула и «скрыть»");
$created = $res["created"];
ok($created > 20 && $res["existing"] === 0, "всё создано (created=$created)");

echo "── 2. повторный вызов ──\n";
$before = count($GLOBALS["DB"]);
$res2 = schema($SPEC);
ok($res2["ok"] === TRUE && $res2["created"] === 0 && $res2["updated"] === 0, "повтор: ничего не создано и не изменено", shown(array($res2["created"], $res2["updated"], $res2["existing"])));
ok(count($GLOBALS["DB"]) === $before, "повтор: строк в базе столько же ($before)");
ok($res2["tables"]["Договор"]["fields"]["Сумма договора"] === $res["tables"]["Договор"]["fields"]["Сумма договора"], "повтор отдаёт те же id");

echo "── 3. правка права ──\n";
$res3 = schema(array("roles" => array(array("name" => "Юрист", "grants" => array(
	array("table" => "Заявка", "level" => "WRITE", "mask" => "[USER_ID]"))))));
$g = find($role["id"], ROLE_OBJECT, $app);
ok($res3["updated"] === 1 && $res3["created"] === 0, "уровень и маска — правка, не новая запись", shown($res3));
ok(find($g["id"], 54, "136") !== NULL && find($g["id"], 53, "136") === NULL && find($g["id"], 49, "[USER_ID]") !== NULL, "у права теперь WRITE и маска");
ok(count(array_filter($GLOBALS["DB"], function($r) use ($role, $app){ return $r["up"] == $role["id"] && $r["t"] == ROLE_OBJECT && $r["val"] === (string)$app; })) === 1, "право на Заявку одно");

echo "── 4. ошибки описания — до записи ──\n";
$before = count($GLOBALS["DB"]);
$bad = schema(array("tables" => array(array("name" => "Т", "fields" => array(
		array("name" => "a", "type" => "FOO"), array("name" => "b", "ref" => "Нет такой"),
		array("name" => "c", "ref" => "Компания"), array("name" => "d", "ref" => "Компания")))),
	"roles" => array(array("name" => "R", "grants" => array(array("table" => "Договор", "level" => "ADMIN")))), "лишнее" => 1));
ok($bad["ok"] === FALSE && count($bad["errors"]) === 5, "пять ошибок", shown($bad));
ok(count($GLOBALS["DB"]) === $before, "при ошибках описания ничего не записано");
$bad = schema(array("tables" => array(array("name" => "Х", "fields" => array(array("name" => "Срок", "type" => "DATE"))),
	array("name" => "У", "fields" => array(array("name" => "Срок", "type" => "NUMBER"))))));
ok($bad["ok"] === FALSE && count($bad["errors"]) === 1 && strpos($bad["errors"][0], "разными типами") !== FALSE, "один термин с двумя типами в описании — ошибка", shown($bad));
ok(count($GLOBALS["DB"]) === $before, "и ничего не записано");

echo "── 4а. термин с именем один ──
";
$limTerm = $lim["t"];
$r = schema(array("tables" => array(array("name" => "Лимит"))));
ok($r["ok"] === TRUE && $r["tables"]["Лимит"]["id"] === $limTerm && $r["tables"]["Лимит"]["created"] === FALSE, "таблица «Лимит» без type — тот же термин, что поле Компании (NUMBER)", shown($r));
$before = count($GLOBALS["DB"]);
$bad = schema(array("tables" => array(array("name" => "Лимит", "type" => "SHORT"))));
ok($bad["ok"] === FALSE && strpos($bad["errors"][0], "«Лимит» уже есть с типом NUMBER") !== FALSE && strpos($bad["errors"][0], "запрошен SHORT") !== FALSE, "тот же термин с другим типом — 400 с именем, есть и запрошено", shown($bad));
ok(count($GLOBALS["DB"]) === $before, "второй термин «Лимит» не создан");
$r = schema(array("tables" => array(array("name" => "Договор", "fields" => array(array("name" => "Лимит", "type" => "NUMBER"))))));
ok($r["ok"] === TRUE && $GLOBALS["DB"][$r["tables"]["Договор"]["fields"]["Лимит"]]["t"] === $limTerm, "поле «Лимит» Договора — тот же термин", shown($r));
ok(count(array_filter($GLOBALS["DB"], function($x){ return $x["up"] == 0 && $x["val"] === "Лимит"; })) === 1, "термин «Лимит» в базе один");
$r = schema(array("tables" => array(array("name" => "Договор", "fields" => array(array("name" => "Позиция заявки"))))));
$k = array_values(array_filter(Sj_type_reqs($con), function($x) use ($pos){ return $x["type"] === $pos; }));
ok($r["ok"] === TRUE && count($k) === 1 && $k[0]["kind"] === "child" && isset($r["warnings"]) && strpos($r["warnings"][0], "подчинённой таблицей") !== FALSE
	, "термин-таблица полем другой таблицы — подчинённая таблица и предупреждение", shown($r));
$r2 = schema(array("tables" => array(array("name" => "Договор", "fields" => array(array("name" => "Позиция заявки"))))));
ok($r2["created"] === 0, "повтор — без новых реквизитов", shown($r2));

echo "── 5. конфликт с существующим полем ──\n";
$res5 = schema(array("tables" => array(array("name" => "Договор", "fields" => array(array("name" => "Сумма договора", "type" => "DATE"))))));
ok($res5["ok"] === FALSE && strpos($res5["errors"][0], "«Сумма договора» уже есть с типом SIGNED") !== FALSE, "поле с другим типом — 400 до записи", shown($res5));
ok($GLOBALS["DB"][$GLOBALS["DB"][$res["tables"]["Договор"]["fields"]["Сумма договора"]]["t"]]["t"] == 14, "поле не изменено");

echo "── 6. поля по именам ──\n";
row(5001, 1, 1, $comp, "Альфа");
row(5002, 1, 1, $comp, "Бета");
row(5003, 1, 1, $comp, "Бета");
row(6001, 1, 1, $app, "З-1");
$f = Named_fields($app, array("Заявка" => "З-2", "Компания" => "Альфа", "Сумма заявки" => 10.5, "t999" => "x"));
$reqComp = $res["tables"]["Заявка"]["fields"]["Компания"];
$reqSum = $res["tables"]["Заявка"]["fields"]["Сумма заявки"];
ok($f === array("t$app" => "З-2", "t$reqComp" => "5001", "t$reqSum" => "10.5", "t999" => "x"), "имя таблицы, ссылка по значению, поле, t{id}", shown($f));
$f = Named_fields($app, array("компания" => 5002));
ok($f === array("t$reqComp" => "5002"), "имя без учёта регистра, ссылка id");
$f = Named_fields($con, array("Заявка" => "З-1"));
ok($f === array("t".$res["tables"]["Договор"]["fields"]["Заявка по договору"] => "6001"), "ссылка находится и по имени таблицы-цели (не только по псевдониму)", shown($f));
foreach(array(array("Компания" => "Бета"), array("Компания" => "Гамма"), array("Нет поля" => 1)) as $case){
	try{ Named_fields($app, $case); $msg = "нет ошибки"; }
	catch(Died $e){ $msg = $e->getMessage(); }
	ok($msg !== "нет ошибки", "ошибка: ".shown($case), $msg);
	echo "       $msg\n";
}

echo "── 7. пакет: неизвестное имя ──\n";
$f = Named_fields($app, array("Сумма заявки" => 1, "Нечто" => 2), FALSE, $unknown);
ok($f === array("t$reqSum" => "1", "Нечто" => 2) && $unknown === array("Нечто"), "неизвестное имя — ключ как есть и в списке", shown(array($f, $unknown)));
ok(Named_fields_needed(array("t1" => 1, "NEW_5" => "x")) === FALSE && Named_fields_needed(array("Сумма" => 1)) === TRUE, "пакет без имён не трогается");

echo "── 8. чтение по именам ──\n";
$api = array("type" => array("val" => "Заявка"), "req_order" => array((string)$pos, (string)$reqComp, (string)$reqSum)
	, "arr_type" => array((string)$pos => "1"), "ref_type" => array((string)$reqComp => (string)$comp));
$rows = Named_rows($app, array(array("i" => 6001, "u" => 1, "o" => 1, "r" => array("З-1", "2", "5001:Альфа", "10.50"))), $api);
ok($rows === array(array("id" => 6001, "up" => 1, "ord" => 1, "Заявка" => "З-1", "Позиция заявки" => array("table" => $pos, "count" => 2)
	, "Компания" => array("id" => 5001, "val" => "Альфа"), "Сумма заявки" => "10.50")), "строка JSON_OBJ — объект с именами", shown($rows));
ok(Named_ref_value("1,2:А,Б&comma;В", TRUE) === array(array("id" => 1, "val" => "А"), array("id" => 2, "val" => "Б,В")), "множественная ссылка — массив");
ok(Named_ref_value("", FALSE) === NULL, "пустая ссылка — null");

echo "── 9. тело JSON ──\n";
$_POST = array("_xsrf" => "form");
$GLOBALS["dumpAPI"] = NULL;
ok(Json_body_merge('{"up":1,"_xsrf":"body","fields":{"A":1}}', "application/json; charset=utf-8") === TRUE, "тело application/json разобрано");
ok($_POST["_xsrf"] === "form" && $_POST["up"] === "1" && json_decode($_POST["fields"], TRUE) === array("A" => 1), "ключи формы сильнее тела, объект — JSON-строкой");
ok(Json_body_merge("x=1", "application/x-www-form-urlencoded") === FALSE, "форма — не тело JSON");

echo $failed ? "\nПРОВАЛЕНО: $failed\n" : "\nschema-json-5242: всё прошло\n";
exit($failed ? 1 : 0);
