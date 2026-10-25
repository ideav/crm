<?php
# Мерка к issue #5219: обязательные реквизиты в строгом режиме _m_new/_m_save.
# https://github.com/ideav/crm/issues/5219
#
# Запуск: php experiments/required-strict-5219.test.php (в гейте — через одноимённый .test.js)
#
# Что проверяется (ApplyMNew/ApplyMSave берутся ИЗ ЯДРА, БД подменена заглушкой):
#   1) со strict незаполненный обязательный реквизит — отказ 400 с именем поля, и ДО вставки:
#      в базе не появляется ни записи, ни её реквизитов;
#   2) без strict (и при strict=0) — прежнее поведение: запись создаётся (форма, integram-table #807);
#   3) значение по умолчанию, NEW_ у ссылки, подчинённая таблица, кнопка и поле без права
#      записи не считаются пропуском;
#   4) _m_save со strict отказывает на присланном пустом обязательном поле до любой записи,
#      а не присланное поле не трогает (частичное сохранение).
#
# Окружение: CORE=<путь к index.php> подменяет проверяемое ядро (для прогона на старом коде).

namespace Test5219;

error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
require __DIR__."/../include/field_attrs.php";

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

# Экстрактор функций ядра — тот же, что в experiments/m-batch-4981.test.php.
function core_function($src, $name){
	$tokens = token_get_all($src);
	$n = count($tokens);
	for($i = 0; $i < $n; $i++){
		if(!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION)
			continue;
		$j = $i + 1;
		while($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT)))
			$j++;
		if($j >= $n || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || $tokens[$j][1] !== $name)
			continue;
		$code = "";
		$depth = 0;
		$started = FALSE;
		for($k = $i; $k < $n; $k++){
			$t = $tokens[$k];
			$code .= is_array($t) ? $t[1] : $t;
			if(!is_array($t)){
				if($t === "{"){ $depth++; $started = TRUE; }
				elseif($t === "}"){
					$depth--;
					if($started && $depth === 0)
						return $code."\n";
				}
			}
			elseif($t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES)
				$depth++;
		}
	}
	return NULL;
}
$core = getenv("CORE") ?: __DIR__."/../index.php";
$coreSrc = file_get_contents($core);
$code = "";
foreach(array("ApplyMNew", "ApplyMSave") as $name){
	$f = core_function($coreSrc, $name);
	if($f === NULL){
		fwrite(STDERR, "В ядре не найдена функция $name — мерка потеряла предмет\n");
		exit(1);
	}
	$code .= $f;
}
# Помощники проверки есть только после правки; на старом ядре мерка обязана краснеть по
# поведению (запись создаётся), а не по отсутствию функции.
foreach(array("Required_strict", "Required_missing", "Required_check") as $name)
	$code .= (string)core_function($coreSrc, $name);
if(strpos($code, "function Required_check") === FALSE)
	$code .= "function Required_check(){}\n";
$code .= "function Number_check(){}\n";	# #5220: числовая проверка — своя мерка (m-save-number-5220)

# ── Заглушки ядра ───────────────────────────────────────────────────────────────────────────
class Died extends \Exception {
	public $status;
	function __construct($msg, $status){ parent::__construct($msg); $this->status = $status; }
}
class PastCheck extends \Exception {}
const PASSWORD = 20;

function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function trace($msg){}
function my_die($msg, $code = ""){ throw new Died($msg, $code === "" ? "400 Bad Request" : $code); }
function OpFail($msg){ throw new Died($msg, "200"); }
function isApi(){ return TRUE; }
function Check_Rec_masks(){}
function Check_Grant($id, $t = 0, $grant = "WRITE", $fatal = TRUE){ return !isset($GLOBALS["NO_GRANT"][$t]); }
function Grant_1level($t){ return "WRITE"; }
function UniqueKeyReqs($t){ return array(); }
function Format_Val($t, $v){ return $v; }
function Format_Val_View($t, $v){ return $v; }
function BuiltIn($v){ return $v; }
function Get_block_data($b){}
function Get_Current_Values($i, $typ){
	foreach($GLOBALS["META"] as $m)
		$GLOBALS["REQ_TYPS"][$m["id"]] = 0;
}
function checkDuplicatedReqs($id, $t){}
# Первый вызов ApplyMSave после проверки обязательных — дальше мерке идти незачем
function UniqueKeyRequestHasSubmittedKeyReq(){ throw new PastCheck("unique keys"); }
function Populate_Reqs(){ throw new PastCheck("copy"); }
function FetchAlias($attrs, $val){ return FieldAttrsAlias($attrs, $val); }
function Insert($up, $ord, $t, $val, $msg){
	$GLOBALS["WRITES"][] = "$msg: $t=$val";
	return ++$GLOBALS["NEXT_ID"];
}

# Exec_sql отдаёт строки по метке запроса; запросы, которых мерка не ждёт, на пути
# сохранения означают «проверку прошли» (PastCheck), на пути создания — пустой ответ.
function Exec_sql($sql, $msg){
	$rows = array();
	if($msg === "Check Obj type&reqs")
		foreach($GLOBALS["META"] as $m)
			$rows[] = array("t" => 3, "ord" => 0, "id" => $m["id"], "reqt" => $m["base"], "val" => $m["attrs"], "base" => $m["base"]);
	elseif($msg === "Required reqs (#5219)")
		foreach($GLOBALS["META"] as $m)
			$rows[] = array("id" => $m["id"], "attrs" => $m["attrs"], "ref_id" => $m["ref"], "base_typ" => $m["base"]
				, "val" => $m["name"], "arr_id" => $m["arr"]);
	elseif($msg === "Get current Val and Type")
		$rows[] = array("val" => "З-1", "typ" => 10200, "up" => 1, "ord" => 1, "t" => 3, "uniq" => 0);
	elseif($GLOBALS["MODE"] === "save")
		throw new PastCheck($msg);
	return new \ArrayIterator($rows);
}
function mysqli_fetch_array($it){
	if(!$it->valid())
		return NULL;
	$row = $it->current();
	$it->next();
	return $row;
}

eval("namespace Test5219;\n".$code);

# ── Таблица «Заявка» (10200) ────────────────────────────────────────────────────────────────
$z = "db";
$GLOBALS["basics"] = array(3 => "SHORT", 13 => "NUMBER", 7 => "BUTTON");
$GLOBALS["REV_BT"] = array(3 => "SHORT", 13 => "NUMBER", 7 => "BUTTON");
$REQUIRED = FieldAttrsBuild("", true);
function col($id, $name, $attrs, $base = 3, $ref = NULL, $arr = NULL){
	return array("id" => $id, "name" => $name, "attrs" => $attrs, "base" => $base, "ref" => $ref, "arr" => $arr);
}
$META_ALL = array(
	col(10201, "Компания", $REQUIRED),
	col(10202, "Статус", FieldAttrsBuild("Новая", true)),	# обязателен, но со значением по умолчанию
	col(10203, "Сумма", $REQUIRED, 13),
	col(10204, "Комментарий", ""),
	col(10205, "Позиции", $REQUIRED, 3, NULL, 10300),		# подчинённая таблица
	col(10206, "Отправить", $REQUIRED, 7),					# кнопка
	col(10207, "Менеджер", FieldAttrsBuild("", true, false, "Ответственный"), 3, 18),	# ссылка с псевдонимом
);

function reset_env($meta){
	global $META_ALL;
	$GLOBALS["META"] = $meta === NULL ? $META_ALL : $meta;
	$GLOBALS["WRITES"] = array();
	$GLOBALS["NEXT_ID"] = 20179;
	foreach(array("REQ_TYPS", "REF_typs", "MULTI", "NOT_NULL", "GRANTS", "DEFVAL", "warning", "NO_GRANT") as $k)
		unset($GLOBALS[$k]);
	$_GET = $_POST = array();
}
# _m_new/10200: результат — массив ядра или Died
function m_new($req, $get = array(), $setup = NULL){
	global $a, $arg, $obj;
	reset_env(NULL);
	$GLOBALS["MODE"] = "new";
	$a = $arg = $obj = "";
	$_GET = $get;
	$_REQUEST = $req + $get;
	if($setup)
		$setup();
	try{
		return ApplyMNew(10200, 1, array());
	}
	catch(Died $e){
		return $e;
	}
}
function m_save($req, $get = array()){
	global $a, $arg, $obj, $next_act;
	reset_env(NULL);
	$GLOBALS["MODE"] = "save";
	$a = $arg = $obj = $next_act = "";
	$_GET = $get;
	$_REQUEST = $req + $get;
	try{
		ApplyMSave(20180, $_REQUEST, array());
		return "done";
	}
	catch(Died $e){
		return $e;
	}
	catch(PastCheck $e){
		return "past";
	}
}
function inserted_amount(){
	foreach($GLOBALS["WRITES"] as $w)
		if(strpos($w, "10203=") !== FALSE)
			return TRUE;
	return FALSE;
}

$noAmount = array("t10200" => "З-1", "t10201" => "ООО Ромашка", "t10202" => "Новая", "t10207" => "5");

echo "── _m_new ──\n";
# Сценарий issue: заявка без суммы со strict
$r = m_new($noAmount + array("strict" => "1"));
ok($r instanceof Died && $r->status === "400 Bad Request", "strict, без «Суммы» → 400",
	$r instanceof Died ? $r->status." ".$r->getMessage() : "ответ ".json_encode($r, JSON_UNESCAPED_UNICODE));
ok($r instanceof Died && strpos($r->getMessage(), "Сумма (t10203)") !== FALSE, "в ошибке названо поле «Сумма (t10203)»",
	$r instanceof Died ? $r->getMessage() : "");
ok(count($GLOBALS["WRITES"]) === 0, "strict, без «Суммы» → в базу не записано ничего", implode("; ", $GLOBALS["WRITES"]));

# Флаг в адресе (?strict без значения), поля в теле
$r = m_new($noAmount, array("JSON" => "", "strict" => ""));
ok($r instanceof Died && count($GLOBALS["WRITES"]) === 0, "?strict в адресе без значения — тоже строгий режим");

# Флаг в теле POST при полях операции пакета
$r = m_new($noAmount, array(), function(){ $_POST = array("strict" => "1", "ops" => "[]"); });
ok($r instanceof Died && count($GLOBALS["WRITES"]) === 0, "strict в теле запроса (_m_batch?strict) — строгий режим для операции");

# Без флага — как раньше
$r = m_new($noAmount);
ok(is_array($r) && $r["rec"] === 20180 && count($GLOBALS["WRITES"]) > 0, "без strict запись создаётся (форма, integram-table #807)",
	$r instanceof Died ? $r->getMessage() : "");
$r = m_new($noAmount + array("strict" => "0"));
ok(is_array($r) && count($GLOBALS["WRITES"]) > 0, "strict=0 — строгий режим выключен");

# Всё заполнено
$r = m_new($noAmount + array("t10203" => "1500", "strict" => "1"));
ok(is_array($r) && inserted_amount(), "strict, всё заполнено → запись создана с суммой", $r instanceof Died ? $r->getMessage() : "");

# Значение по умолчанию у «Статуса» засчитывается
$req = $noAmount + array("t10203" => "1500", "strict" => "1");
unset($req["t10202"]);
$r = m_new($req);
ok(is_array($r), "strict, «Статус» не прислан, но есть значение по умолчанию → не пропуск", $r instanceof Died ? $r->getMessage() : "");

# Пустое значение и ссылка, созданная по NEW_
$req = $noAmount + array("t10203" => "", "strict" => "1");
$r = m_new($req);
ok($r instanceof Died && count($GLOBALS["WRITES"]) === 0, "strict, «Сумма» прислана пустой → 400");
$req = $noAmount + array("t10203" => "1500", "strict" => "1");
unset($req["t10207"]);
$r = m_new($req);
ok($r instanceof Died && strpos($r->getMessage(), "Ответственный (t10207)") !== FALSE, "у ссылки в ошибке — псевдоним колонки",
	$r instanceof Died ? $r->getMessage() : "");
$r = m_new($req + array("NEW_10207" => "Иванов"));
ok(!($r instanceof Died), "strict, ссылка задана через NEW_ → не пропуск", $r instanceof Died ? $r->getMessage() : "");

# Поле без права записи пользователь заполнить не может — не пропуск
$r = m_new($noAmount + array("strict" => "1"), array(), function(){ $GLOBALS["NO_GRANT"][10203] = TRUE; });
ok(!($r instanceof Died), "strict, на «Сумму» нет права записи → не требуется", $r instanceof Died ? $r->getMessage() : "");

echo "── _m_save ──\n";
$r = m_save(array("t10203" => "", "strict" => "1"));
ok($r instanceof Died && $r->status === "400 Bad Request" && strpos($r->getMessage(), "Сумма (t10203)") !== FALSE,
	"strict, «Сумма» прислана пустой → 400 до любой записи", is_string($r) ? $r : $r->getMessage());
$r = m_save(array("t10204" => "звонить после обеда", "strict" => "1"));
ok($r === "past", "strict, прислано только необязательное поле → сохранение идёт дальше", is_string($r) ? $r : $r->getMessage());
$r = m_save(array("t10203" => ""));
ok($r === "past", "без strict пустая «Сумма» — прежнее поведение (сохранение идёт дальше)", is_string($r) ? $r : $r->getMessage());
$r = m_save(array("t10203" => "", "strict" => "1", "copybtn" => "1"));
ok($r === "past", "strict, копия записи — не проверяется", is_string($r) ? $r : $r->getMessage());

if($failed){
	fwrite(STDERR, "$failed проверок упало\n");
	exit(1);
}
echo "PASS\n";
