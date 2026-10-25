<?php
# Мерка к issue #5220 (третья часть): _m_new не пишет нечисловую строку в NUMBER/SIGNED.
#
# Запуск: php experiments/m-new-number-5220.test.php (в гейте — через одноимённый .test.js)
#
# Что проверяется (ApplyMNew, Number_check, RequireNumber берутся ИЗ ЯДРА, БД подменена заглушкой):
#   значение проходило Format_Val, и «abc» вставлялось в числовой реквизит (и в главное значение
#   записи типа NUMBER) строкой. Правило: непустое нечисловое значение NUMBER/SIGNED — 400
#   «Значение должно быть числом» ДО вставки: ни записи, ни реквизитов. Значения по умолчанию
#   (их задаёт администратор) не проверяются — только присланное клиентом.
#
# Обвязка (заглушки ядра, m_new) — из experiments/required-strict-5219.test.php.
#
# Окружение: CORE=<путь к index.php> подменяет проверяемое ядро (для прогона на старом коде).

namespace Test5220n;

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
$code = core_function($coreSrc, "ApplyMNew");
$check = (string)core_function($coreSrc, "Number_check");
$code .= $check.core_function($coreSrc, "RequireNumber");
if($check === "")
	$code .= "function Number_check(){}\n";	# прежнее ядро: проверки нет, мерка краснеет по поведению
$code .= "function Required_check(){}\n";	# обязательные поля — мерка #5219

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
function FetchAlias($attrs, $val){ return FieldAttrsAlias($attrs, $val); }
function Insert($up, $ord, $t, $val, $msg){
	$GLOBALS["WRITES"][] = "$msg: $t=$val";
	return ++$GLOBALS["NEXT_ID"];
}

# Exec_sql отдаёт строки по метке запроса; остальные запросы — пустой ответ.
function Exec_sql($sql, $msg){
	$rows = array();
	if($msg === "Check Obj type&reqs")
		foreach($GLOBALS["META"] as $m)
			$rows[] = array("t" => $GLOBALS["OWN_BASE"], "ord" => 0, "id" => $m["id"], "reqt" => $m["base"], "val" => $m["attrs"], "base" => $m["base"]);
	elseif($msg === "Get reqs' base types")
		foreach($GLOBALS["META"] as $m)
			$rows[] = array("id" => $m["id"], "base" => $m["base"]);
	return new \ArrayIterator($rows);
}
function mysqli_fetch_array($it){
	if(!$it->valid())
		return NULL;
	$row = $it->current();
	$it->next();
	return $row;
}

eval("namespace Test5220n;\n".$code);

# ── Таблица «Заявка» (10200) ────────────────────────────────────────────────────────────────
$z = "db";
$GLOBALS["basics"] = array(3 => "SHORT", 13 => "NUMBER", 14 => "SIGNED", 7 => "BUTTON");
$GLOBALS["REV_BT"] = $GLOBALS["basics"];
function col($id, $name, $attrs, $base = 3, $ref = NULL, $arr = NULL){
	return array("id" => $id, "name" => $name, "attrs" => $attrs, "base" => $base, "ref" => $ref, "arr" => $arr);
}
$META_ALL = array(
	col(10201, "Компания", ""),
	col(10203, "Сумма", "", 13),
	col(10208, "Курс", "", 14),
	col(10209, "Код", FieldAttrsBuild("н/д", false), 13),	# значение по умолчанию задал администратор
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
function wrote_nothing(){ return count($GLOBALS["WRITES"]) === 0; }
function isNumberError($r, $field){
	return ($r instanceof Died) && $r->status === "400 Bad Request"
		&& mb_stripos($r->getMessage(), "должно быть числом") !== FALSE && strpos($r->getMessage(), $field) !== FALSE;
}
function said($r){ return $r instanceof Died ? $r->status." ".$r->getMessage() : json_encode($r, JSON_UNESCAPED_UNICODE)."; ".implode("; ", $GLOBALS["WRITES"]); }

$GLOBALS["OWN_BASE"] = 3;
echo "── отказ ──\n";
foreach(array("abc", "12abc", "1,5 млн", "3 800 000 руб.") as $bad){
	$r = m_new(array("t10200" => "З-1", "t10201" => "ООО Ромашка", "t10203" => $bad));
	ok(isNumberError($r, "t10203"), "NUMBER «{$bad}» → 400 «должно быть числом»", said($r));
	ok(wrote_nothing(), "NUMBER «{$bad}» → не вставлено ни записи, ни реквизитов", implode("; ", $GLOBALS["WRITES"]));
	$r = m_new(array("t10200" => "З-1", "t10208" => $bad));
	ok(isNumberError($r, "t10208") && wrote_nothing(), "SIGNED «{$bad}» → 400, ничего не вставлено", said($r));
}
$GLOBALS["OWN_BASE"] = 13;
$r = m_new(array("t10200" => "abc"));
ok(isNumberError($r, "t10200") && wrote_nothing(), "главное значение записи типа NUMBER: «abc» → 400, ничего не вставлено", said($r));

echo "── проходит ──\n";
$GLOBALS["OWN_BASE"] = 3;
foreach(array("4200000", "4 200 000", "-7", "2,5", "") as $good){
	$r = m_new(array("t10200" => "З-1", "t10203" => $good, "t10208" => $good));
	ok(is_array($r) && count($GLOBALS["WRITES"]) > 0, "числа «{$good}» → запись создана", said($r));
}
$r = m_new(array("t10200" => "abc", "t10201" => "abc"));
ok(is_array($r), "строковые поля с «abc» числовая проверка не трогает", said($r));
$r = m_new(array("t10200" => "З-1"));
ok(is_array($r), "нечисловое значение по умолчанию у «Кода» не проверяется — его задал администратор", said($r));
$GLOBALS["OWN_BASE"] = 13;
$r = m_new(array("t10200" => "15"));
ok(is_array($r), "главное значение типа NUMBER «15» → запись создана", said($r));

if($failed){
	fwrite(STDERR, "$failed проверок упало\n");
	exit(1);
}
echo "PASS\n";
