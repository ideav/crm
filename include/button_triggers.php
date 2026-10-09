<?php
# Триггеры колонок-кнопок (python2node#866) и вычислитель формул кнопок (crm#5116).
#
# Действие колонки BUTTON (attrs.action, см. include/field_attrs.php) запускается событием
# из action.on: PRESS — нажатие (браузер), READ — показ (браузер), CREATE / UPDATE / DELETE —
# создание, изменение и удаление записи (сервер, этот файл). Описание для агента —
# docs/kb/button-columns.md.
#
# Файл не знает ядра: всё, что касается базы, делает «порт» — массив функций, который
# собирает index.php (BtCorePort) и подменяют тесты:
#   meta(typeId)            → array("id","name","base","cols"=>[{id,name,base,ref,attrs}]) | null
#   record(recId)           → array("id","type","val","values"=>[colId=>string]) | null
#   write(recId, colId, value, runAs, asAi, chain)  — запись значения колонки (исключение = отказ)
#   query(name, params, runAs, chain)  → строки отчёта (массив ассоциативных массивов)
#   prompt(job)             → array("job"=>id, "content"=>?string) — постановка задачи агенту
#   promptGate(key)         → "" | текст отказа (лимит в час, дубль задачи)
#   user(ref)               → контекст пользователя array("user","user_id",…) | исключение
#   defer(key, fn)          — выполнить fn после отправки ответа; тот же key заменяет прежний
#   warn(text), log(text)
# Вся работа триггера (запись, запрос, промпт) идёт ПОСЛЕ ответа пользователю: его запись
# уже сохранена и отдана, и сбой триггера (в том числе exit() в ядре) её не задевает.
# Синхронно — только чтение записи и вычисление формул/условий: их ошибки уходят в
# предупреждение ответа.

defined("BT_EVENTS") || define("BT_EVENTS", "PRESS,CREATE,UPDATE,DELETE,READ");
defined("BT_MAX_DEPTH") || define("BT_MAX_DEPTH", 3);          # длина цепочки триггеров
defined("BT_PROMPT_HOURLY_CAP") || define("BT_PROMPT_HOURLY_CAP", 60);  # промпт-задач триггеров в час на базу

class BtFormulaError extends Exception {}
class BtSkip extends Exception {}

# Значение undefined из JS: аргумент функции, которого не передали.
final class BtUndef { }
function BtUndef(){ static $u = null; if($u === null) $u = new BtUndef(); return $u; }

# ── Семантика значений JS ───────────────────────────────────────────────────

# Number → String по правилам ECMAScript (кратчайшая запись, экспонента от 1e21 и до 1e-7)
function BtJsNumToString($f){
	$f = (float)$f;
	if(is_nan($f)) return "NaN";
	if(is_infinite($f)) return $f > 0 ? "Infinity" : "-Infinity";
	if($f == 0) return "0";
	$neg = $f < 0;
	$a = abs($f);
	for($p = 1; $p <= 17; $p++){
		$s = sprintf("%.".($p - 1)."e", $a);
		if((float)$s == $a) break;
	}
	preg_match('/^(\d)(?:\.(\d+))?e([+-]\d+)$/', $s, $m);
	$digits = rtrim($m[1].(isset($m[2]) ? $m[2] : ""), "0");
	if($digits === "") $digits = "0";
	$k = strlen($digits);
	$n = (int)$m[3] + 1;
	if($k <= $n && $n <= 21)
		$r = $digits.str_repeat("0", $n - $k);
	elseif(0 < $n && $n <= 21)
		$r = substr($digits, 0, $n).".".substr($digits, $n);
	elseif(-6 < $n && $n <= 0)
		$r = "0.".str_repeat("0", -$n).$digits;
	else{
		$e = $n - 1;
		$r = $digits[0].($k > 1 ? ".".substr($digits, 1) : "")."e".($e >= 0 ? "+" : "-").abs($e);
	}
	return ($neg ? "-" : "").$r;
}
# String(v)
function BtJsString($v){
	if(is_string($v)) return $v;
	if(is_float($v) || is_int($v)) return BtJsNumToString($v);
	if(is_bool($v)) return $v ? "true" : "false";
	if($v instanceof BtUndef) return "undefined";
	if($v === null) return "null";
	return (string)$v;
}
# Number(s) для строки без пробелов: NAN, если не число
function BtJsNumber($s){
	if($s === "") return 0.0;
	if(preg_match('/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i', $s)) return (float)$s;
	if(preg_match('/^0x[0-9a-f]+$/i', $s)) return (float)hexdec(substr($s, 2));
	if(preg_match('/^0b[01]+$/i', $s)) return (float)bindec(substr($s, 2));
	if(preg_match('/^0o[0-7]+$/i', $s)) return (float)octdec(substr($s, 2));
	if(preg_match('/^([+-]?)Infinity$/', $s, $m)) return $m[1] === "-" ? -INF : INF;
	return NAN;
}
define("BT_WS", '[\s\p{Zs}\x{FEFF}\x{2028}\x{2029}]');
function BtStripSpaces($s){ return preg_replace('/'.BT_WS.'/u', "", $s); }
# String.prototype.trim
function BtTrim($s){ return preg_replace('/^'.BT_WS.'+|'.BT_WS.'+$/u', "", (string)$s); }
# Длина и срез строки в единицах UTF-16, как у строк JS
function BtU16($s){ return mb_convert_encoding((string)$s, "UTF-16LE", "UTF-8"); }
function BtJsLength($s){ return intdiv(strlen(BtU16($s)), 2); }
function BtJsIntOrInf($n){ return is_nan($n) ? 0.0 : ($n < 0 ? ceil($n) : floor($n)); }
function BtJsSlice($s, $start, $end=null){
	$u = BtU16($s);
	$len = intdiv(strlen($u), 2);
	$st = BtJsIntOrInf((float)$start);
	$st = $st < 0 ? max($len + $st, 0) : min($st, $len);
	$en = $end === null ? $len : BtJsIntOrInf((float)$end);
	$en = $en < 0 ? max($len + $en, 0) : min($en, $len);
	if($en <= $st) return "";
	return mb_convert_encoding(substr($u, (int)$st * 2, (int)($en - $st) * 2), "UTF-8", "UTF-16LE");
}
# Math.round: ближайшее целое, половина — вверх
function BtJsRound($x){
	if(is_nan($x) || is_infinite($x)) return $x;
	$r = floor($x);
	if($x - $r >= 0.5) $r += 1;
	return (float)$r;
}

# ── Вычислитель формул: порт js/integram-table/26-button-actions.js один к одному ──
# Общие векторы паритета — experiments/button-formula-vectors.fixture.json.

function BtToNumber($v){
	if(is_float($v)) return $v;
	if(is_int($v)) return (float)$v;
	if(is_bool($v)) return $v ? 1.0 : 0.0;
	$str = ($v === null || $v instanceof BtUndef) ? "" : BtJsString($v);
	$s = preg_replace('/,/', ".", BtStripSpaces($str), 1);
	if($s === "") return 0.0;
	$n = BtJsNumber($s);
	if(is_nan($n)) throw new BtFormulaError("«".BtJsString($v)."» — не число");
	return $n;
}
function BtLooksNumeric($v){
	if(is_float($v) || is_int($v)) return true;
	if(!is_string($v)) return false;
	$s = preg_replace('/,/', ".", BtStripSpaces($v), 1);
	return $s !== "" && !is_nan(BtJsNumber($s));
}
function BtFieldValue($v){
	return BtLooksNumeric($v) ? BtToNumber($v) : (($v === null || $v instanceof BtUndef) ? "" : BtJsString($v));
}
function BtTruthy($v){
	return !($v === "" || $v === 0.0 || $v === 0 || $v === false || $v === null || $v instanceof BtUndef || $v === "0");
}
# Истинность значения в JS (для `v || ''`)
function BtJsTruthy($v){
	return !($v === "" || $v === false || $v === null || $v instanceof BtUndef
		|| ((is_float($v) || is_int($v)) && ($v == 0 || is_nan((float)$v))));
}
# Дата → метка UTC (календарная арифметика без перехода на летнее время)
function BtParseDate($v){
	$s = BtJsTruthy($v) ? BtTrim(BtJsString($v)) : "";
	$mk = function($y, $mo, $d, $h, $i, $sec){
		$y = (int)$y;
		if($y >= 0 && $y <= 99) $y += 1900;
		return gmmktime((int)$h, (int)$i, (int)$sec, (int)$mo, (int)$d, $y);
	};
	if(preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:'.BT_WS.'+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\z/u', $s, $m))
		return $mk($m[3], $m[2], $m[1], isset($m[4]) && $m[4] !== "" ? $m[4] : 0, isset($m[5]) && $m[5] !== "" ? $m[5] : 0, isset($m[6]) && $m[6] !== "" ? $m[6] : 0);
	if(preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/u', $s, $m))
		return $mk($m[1], $m[2], $m[3], isset($m[4]) && $m[4] !== "" ? $m[4] : 0, isset($m[5]) && $m[5] !== "" ? $m[5] : 0, isset($m[6]) && $m[6] !== "" ? $m[6] : 0);
	throw new BtFormulaError("«".$s."» — не дата");
}
function BtFmtDate($ts){ return gmdate("d.m.Y", $ts); }

function BtCallFunction($name, $args){
	$a = function($i) use ($args){ return array_key_exists($i, $args) ? $args[$i] : BtUndef(); };
	$str = function($v){ return BtJsString($v instanceof BtUndef ? "" : $v); };
	switch($name){
		case "ROUND":
			$n = $a(1);
			$p = pow(10.0, $n instanceof BtUndef ? 0.0 : BtToNumber($n));
			return BtJsRound(BtToNumber($a(0)) * $p) / $p;
		case "FLOOR": return (float)floor(BtToNumber($a(0)));
		case "CEIL": return (float)ceil(BtToNumber($a(0)));
		case "ABS": return abs(BtToNumber($a(0)));
		case "MIN":
		case "MAX":
			$r = $name === "MIN" ? INF : -INF;
			$nums = array_map("BtToNumber", $args);
			foreach($nums as $x){
				if(is_nan($x)) return NAN;
				$r = $name === "MIN" ? min($r, $x) : max($r, $x);
			}
			return (float)$r;
		case "SUM":
			$s = 0.0;
			foreach($args as $x) $s += BtToNumber($x);
			return $s;
		case "AVG":
			if(!count($args)) return 0.0;
			$s = 0.0;
			foreach($args as $x) $s += BtToNumber($x);
			return $s / count($args);
		case "NUM": return BtToNumber($a(0));
		case "IF": return BtTruthy($a(0)) ? $a(1) : ($a(2) instanceof BtUndef ? "" : $a(2));
		case "LEN": return (float)BtJsLength($str($a(0)));
		case "UPPER": return mb_strtoupper($str($a(0)), "UTF-8");
		case "LOWER": return mb_strtolower($str($a(0)), "UTF-8");
		case "TRIM": return BtTrim($str($a(0)));
		case "LEFT": return BtJsSlice($str($a(0)), 0, BtToNumber($a(1) instanceof BtUndef ? 1.0 : $a(1)));
		case "RIGHT":
			$s = $str($a(0));
			$k = BtToNumber($a(1) instanceof BtUndef ? 1.0 : $a(1));
			return $k > 0 ? BtJsSlice($s, -$k) : "";
		case "CONCAT":
			$out = "";
			foreach($args as $x) $out .= $str($x);
			return $out;
		case "TODAY":
			$tz = isset($GLOBALS["tzone"]) ? (int)$GLOBALS["tzone"] : 0;
			return date("d.m.Y", time() + $tz);
		case "DAYS": return BtJsRound((BtParseDate($a(0)) - BtParseDate($a(1))) / 86400);
		case "ADDDAYS":
			$ts = BtParseDate($a(0));
			$day = BtJsIntOrInf((int)gmdate("j", $ts) + BtToNumber($a(1)));
			return BtFmtDate(gmmktime((int)gmdate("H", $ts), (int)gmdate("i", $ts), (int)gmdate("s", $ts)
				, (int)gmdate("n", $ts), (int)$day, (int)gmdate("Y", $ts)));
	}
	return null;
}
function BtIsFunction($name){
	return in_array($name, array("ROUND","FLOOR","CEIL","ABS","MIN","MAX","SUM","AVG","NUM","IF","LEN","UPPER","LOWER","TRIM","LEFT","RIGHT","CONCAT","TODAY","DAYS","ADDDAYS"), true);
}

function BtTokenize($src){
	$tokens = array();
	$i = 0;
	$len = strlen($src);
	while($i < $len){
		preg_match('/\G./su', $src, $m, 0, $i);
		$c = $m[0];
		if(preg_match('/^'.BT_WS.'$/u', $c)){ $i += strlen($c); continue; }
		if(ctype_digit($c) || ($c === "." && $i + 1 < $len && ctype_digit($src[$i + 1]))){
			preg_match('/\G\d*\.?\d+(?:[eE][+-]?\d+)?/', $src, $m, 0, $i);
			$tokens[] = array("t" => "num", "v" => (float)$m[0]);
			$i += strlen($m[0]);
			continue;
		}
		if($c === '"' || $c === "'"){
			$j = $i + 1;
			$s = "";
			while($j < $len && $src[$j] !== $c){
				if($src[$j] === "\\" && $j + 1 < $len){
					preg_match('/\G./su', $src, $n, 0, $j + 1);
					$s .= $n[0];
					$j += 1 + strlen($n[0]);
					continue;
				}
				preg_match('/\G./su', $src, $n, 0, $j);
				$s .= $n[0];
				$j += strlen($n[0]);
			}
			if($j >= $len) throw new BtFormulaError("Незакрытая строка в формуле");
			$tokens[] = array("t" => "str", "v" => $s);
			$i = $j + 1;
			continue;
		}
		if($c === "{"){
			$j = strpos($src, "}", $i);
			if($j === false) throw new BtFormulaError("Незакрытая скобка { в формуле");
			$tokens[] = array("t" => "field", "v" => BtTrim(substr($src, $i + 1, $j - $i - 1)));
			$i = $j + 1;
			continue;
		}
		if(substr($src, $i, 4) === "[ID]"){ $tokens[] = array("t" => "id"); $i += 4; continue; }
		if(substr($src, $i, 5) === "[VAL]"){ $tokens[] = array("t" => "val"); $i += 5; continue; }
		if(preg_match('/\G[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*/u', $src, $m, 0, $i)){
			$tokens[] = array("t" => "ident", "v" => $m[0]);
			$i += strlen($m[0]);
			continue;
		}
		if(preg_match('/\G(<=|>=|<>|!=|==|&&|\|\||[-+*\/%()<>=!?:,&])/', $src, $m, 0, $i)){
			$tokens[] = array("t" => "op", "v" => $m[0]);
			$i += strlen($m[0]);
			continue;
		}
		throw new BtFormulaError("Недопустимый символ «".$c."» в формуле");
	}
	return $tokens;
}

# Поле строки по имени колонки: точное совпадение, затем без учёта регистра
function BtLookupField($ctx, $name){
	$fields = isset($ctx["fields"]) && is_array($ctx["fields"]) ? $ctx["fields"] : array();
	if(array_key_exists($name, $fields)) return array(true, $fields[$name]);
	$lower = mb_strtolower($name, "UTF-8");
	foreach($fields as $k => $v)
		if(mb_strtolower((string)$k, "UTF-8") === $lower) return array(true, $v);
	return array(false, "");
}

class BtFormulaParser {
	private $tokens; private $pos = 0; private $ctx;
	function __construct($tokens, $ctx){ $this->tokens = $tokens; $this->ctx = $ctx; }
	private function peek(){ return isset($this->tokens[$this->pos]) ? $this->tokens[$this->pos] : null; }
	private function isOp($v){ $t = $this->peek(); return $t && $t["t"] === "op" && $t["v"] === $v; }
	private function expect($v){ if(!$this->isOp($v)) throw new BtFormulaError("Ожидалось «".$v."» в формуле"); $this->pos++; }
	function run(){
		if(!count($this->tokens)) return "";
		$r = $this->ternary();
		if($this->pos < count($this->tokens)){
			$t = $this->tokens[$this->pos];
			$v = isset($t["v"]) ? $t["v"] : null;
			$shown = ($v === null || $v === 0.0 || $v === "") ? "" : BtJsString($v);
			throw new BtFormulaError("Лишнее «".$shown."» в формуле");
		}
		return $r;
	}
	function ternary(){
		$c = $this->orExpr();
		if($this->isOp("?")){
			$this->pos++;
			$a = $this->ternary();
			$this->expect(":");
			$b = $this->ternary();
			return BtTruthy($c) ? $a : $b;
		}
		return $c;
	}
	function orExpr(){
		$l = $this->andExpr();
		while($this->isOp("||")){ $this->pos++; $r = $this->andExpr(); $l = BtTruthy($l) || BtTruthy($r); }
		return $l;
	}
	function andExpr(){
		$l = $this->cmp();
		while($this->isOp("&&")){ $this->pos++; $r = $this->cmp(); $l = BtTruthy($l) && BtTruthy($r); }
		return $l;
	}
	function cmp(){
		$l = $this->add();
		$t = $this->peek();
		if($t && $t["t"] === "op" && in_array($t["v"], array("==", "=", "!=", "<>", "<", "<=", ">", ">="), true)){
			$this->pos++;
			$r = $this->add();
			$num = BtLooksNumeric($l) && BtLooksNumeric($r);
			$a = $num ? BtToNumber($l) : BtJsString($l);
			$b = $num ? BtToNumber($r) : BtJsString($r);
			if(!$num){
				$c = strcmp($a, $b);
				switch($t["v"]){
					case "==": case "=": return $c === 0;
					case "!=": case "<>": return $c !== 0;
					case "<": return $c < 0;
					case "<=": return $c <= 0;
					case ">": return $c > 0;
					default: return $c >= 0;
				}
			}
			switch($t["v"]){
				case "==": case "=": return $a == $b && !is_nan($a);
				case "!=": case "<>": return !($a == $b && !is_nan($a));
				case "<": return $a < $b;
				case "<=": return $a <= $b;
				case ">": return $a > $b;
				default: return $a >= $b;
			}
		}
		return $l;
	}
	function add(){
		$l = $this->mul();
		for(;;){
			if($this->isOp("+")){
				$this->pos++;
				$r = $this->mul();
				$l = (BtLooksNumeric($l) && BtLooksNumeric($r)) ? BtToNumber($l) + BtToNumber($r) : BtJsString($l).BtJsString($r);
			}
			elseif($this->isOp("-")){ $this->pos++; $a = BtToNumber($l); $l = $a - BtToNumber($this->mul()); }
			elseif($this->isOp("&")){ $this->pos++; $l = BtJsString($l).BtJsString($this->mul()); }
			else return $l;
		}
	}
	function mul(){
		$l = $this->unary();
		for(;;){
			if($this->isOp("*")){ $this->pos++; $a = BtToNumber($l); $l = $a * BtToNumber($this->unary()); }
			elseif($this->isOp("/")){
				$this->pos++;
				$r = BtToNumber($this->unary());
				if($r == 0) throw new BtFormulaError("Деление на ноль");
				$l = BtToNumber($l) / $r;
			}
			elseif($this->isOp("%")){
				$this->pos++;
				$a = BtToNumber($l);
				$r = BtToNumber($this->unary());
				$l = $r == 0 ? NAN : fmod($a, $r);
			}
			else return $l;
		}
	}
	function unary(){
		if($this->isOp("-")){ $this->pos++; return -BtToNumber($this->unary()); }
		if($this->isOp("+")){ $this->pos++; return BtToNumber($this->unary()); }
		if($this->isOp("!")){ $this->pos++; return !BtTruthy($this->unary()); }
		return $this->primary();
	}
	function primary(){
		$t = $this->peek();
		if(!$t) throw new BtFormulaError("Формула оборвана");
		$this->pos++;
		if($t["t"] === "num" || $t["t"] === "str") return $t["v"];
		if($t["t"] === "id") return BtFieldValue(isset($this->ctx["id"]) ? $this->ctx["id"] : null);
		if($t["t"] === "val") return BtFieldValue(isset($this->ctx["val"]) ? $this->ctx["val"] : null);
		if($t["t"] === "field"){
			list($found, $value) = BtLookupField($this->ctx, $t["v"]);
			if(!$found) throw new BtFormulaError("Нет колонки «".$t["v"]."»");
			return BtFieldValue($value);
		}
		if($t["t"] === "op" && $t["v"] === "("){ $v = $this->ternary(); $this->expect(")"); return $v; }
		if($t["t"] === "ident"){
			$name = strtoupper($t["v"]);
			if($name === "TRUE") return true;
			if($name === "FALSE") return false;
			if(!BtIsFunction($name)) throw new BtFormulaError("Неизвестная функция ".$t["v"]);
			$this->expect("(");
			$args = array();
			if(!$this->isOp(")")){
				$args[] = $this->ternary();
				while($this->isOp(",")){ $this->pos++; $args[] = $this->ternary(); }
			}
			$this->expect(")");
			return BtCallFunction($name, $args);
		}
		throw new BtFormulaError("Неожиданное «".BtJsString(isset($t["v"]) ? $t["v"] : BtUndef())."» в формуле");
	}
}

function BtFormulaEval($src, $ctx){
	$parser = new BtFormulaParser(BtTokenize((string)$src), $ctx);
	return $parser->run();
}
function BtFormulaFormat($v){
	if(is_float($v) || is_int($v)){
		$v = (float)$v;
		if(is_nan($v) || is_infinite($v)) throw new BtFormulaError("Результат не число");
		if(abs($v) >= 1e21) return BtJsNumToString($v);
		return BtJsNumToString((float)sprintf("%.10f", $v));
	}
	if(is_bool($v)) return $v ? "1" : "0";
	if($v === null || $v instanceof BtUndef) return "";
	return (string)$v;
}

# ── Шаблоны, промпт, ответ агента ────────────────────────────────────────────

function BtEncodeUriComponent($s){
	return strtr(rawurlencode($s), array("%21" => "!", "%2A" => "*", "%27" => "'", "%28" => "(", "%29" => ")"));
}
function BtSubstitute($template, $ctx, $encode=null){
	$enc = $encode ? $encode : function($v){ return $v; };
	$str = function($v){ return $v === null ? "" : BtJsString($v); };
	# Порядок как в JS: [ID], затем [VAL], затем {Колонка} — по уже подставленному тексту
	$s = str_replace("[ID]", $enc($str(isset($ctx["id"]) ? $ctx["id"] : null)), (string)$template);
	$s = str_replace("[VAL]", $enc($str(isset($ctx["val"]) ? $ctx["val"] : null)), $s);
	return preg_replace_callback('/\{([^{}]+)\}/u', function($m) use ($ctx, $enc, $str){
		list($found, $value) = BtLookupField($ctx, BtTrim($m[1]));
		return $found ? $enc($str($value)) : $m[0];
	}, $s);
}
function BtBuildPrompt($action, $ctx, $columnName, $write){
	$text = BtSubstitute(isset($action["prompt"]) ? $action["prompt"] : "", $ctx);
	if(!$write) return $text;
	return $text."\n\nОтветь только итоговым значением для поля «".$columnName."» записи #".BtJsString($ctx["id"])
		." — без пояснений, кавычек и форматирования.";
}
function BtCleanAnswer($text){
	$s = BtTrim((string)$text);
	if(preg_match('/^```[\w-]*\n?([\s\S]*?)\n?```\z/', $s, $m))
		$s = BtTrim($m[1]);
	return $s;
}

# ── События и выбор триггеров ────────────────────────────────────────────────

function BtEventList(){ return explode(",", BT_EVENTS); }
# События действия; пусто — нажатие
function BtActionEvents($action){
	return (isset($action["on"]) && is_array($action["on"]) && count($action["on"])) ? $action["on"] : array("PRESS");
}
# Колонки-кнопки таблицы с событием $event — в порядке колонок
function BtTriggerColumns($meta, $event){
	$out = array();
	if(!$meta || !isset($meta["cols"])) return $out;
	foreach($meta["cols"] as $col){
		if(empty($col["ref"]) && isset($col["base"]) && $col["base"] === "BUTTON"){
			$action = BtColumnAction($col);
			if($action && in_array($event, BtActionEvents($action), true))
				$out[] = array_merge($col, array("action" => $action));
		}
	}
	return $out;
}
function BtColumnAction($col){
	$parsed = FieldAttrsParse(isset($col["attrs"]) ? $col["attrs"] : "");
	if(!isset($parsed["action"])) return null;
	$action = FieldAttrsNormalizeAction($parsed["action"]);
	return is_array($action) ? $action : null;
}
# Контекст подстановок записи: id, главное значение, поля по имени колонки
function BtContext($meta, $rec){
	$fields = array();
	if(isset($meta["name"]) && $meta["name"] !== "")
		$fields[$meta["name"]] = isset($rec["val"]) ? (string)$rec["val"] : "";
	foreach($meta["cols"] as $col){
		$v = isset($rec["values"][$col["id"]]) ? (string)$rec["values"][$col["id"]] : "";
		if(isset($col["name"]) && $col["name"] !== "")
			$fields[$col["name"]] = $v;
	}
	return array("id" => (string)$rec["id"], "val" => isset($rec["val"]) ? (string)$rec["val"] : "", "fields" => $fields);
}
# Колонки, на которые ссылается действие ({Колонка}, [VAL]): id колонок, главное значение — id таблицы
function BtActionRefs($action, $meta){
	$text = "";
	foreach(array("formula", "prompt", "query", "params", "when") as $k)
		if(isset($action[$k])) $text .= "\n".$action[$k];
	$ids = array();
	if(strpos($text, "[VAL]") !== false)
		$ids[] = (int)$meta["id"];
	if(preg_match_all('/\{([^{}]+)\}/u', $text, $m))
		foreach($m[1] as $name){
			$name = mb_strtolower(BtTrim($name), "UTF-8");
			if(isset($meta["name"]) && mb_strtolower($meta["name"], "UTF-8") === $name)
				$ids[] = (int)$meta["id"];
			foreach($meta["cols"] as $col)
				if(isset($col["name"]) && mb_strtolower($col["name"], "UTF-8") === $name)
					$ids[] = (int)$col["id"];
		}
	return array_values(array_unique($ids));
}
# UPDATE срабатывает, если изменилась колонка, на которую ссылается действие; без ссылок —
# любое изменение, кроме своей колонки
function BtUpdateFires($action, $colId, $changed, $meta){
	$changed = array_map("intval", $changed);
	$refs = BtActionRefs($action, $meta);
	if(count($refs))
		return count(array_intersect($refs, $changed)) > 0;
	return count(array_diff($changed, array((int)$colId))) > 0;
}
# Изменённые колонки между двумя снимками записи; главное значение — id таблицы
function BtDiff($before, $after){
	$changed = array();
	if(!$before || !$after) return $changed;
	if((string)$before["val"] !== (string)$after["val"])
		$changed[] = (int)$after["type"];
	$keys = array_unique(array_merge(array_keys($before["values"]), array_keys($after["values"])));
	foreach($keys as $k){
		$a = isset($before["values"][$k]) ? (string)$before["values"][$k] : "";
		$b = isset($after["values"][$k]) ? (string)$after["values"][$k] : "";
		if($a !== $b) $changed[] = (int)$k;
	}
	sort($changed);
	return $changed;
}

# ── Исполнение ───────────────────────────────────────────────────────────────

# Цепочка запуска (id колонок) общая на весь запрос и на все записи: колонка не срабатывает
# второй раз в одной цепочке, длина цепочки ≤ BT_MAX_DEPTH (сценарий 4 «Конфликтов»).
function BtFire($port, $event, $rec, $opts=array()){
	$chain = isset($opts["chain"]) ? array_map("intval", $opts["chain"]) : array();
	if(!$rec || count($chain) >= BT_MAX_DEPTH)
		return;
	if(!empty($GLOBALS["BT_GONE"][(int)$rec["id"]]) && $event !== "DELETE")
		return;
	$meta = $port["meta"]((int)$rec["type"]);
	if(!$meta) return;
	foreach(BtTriggerColumns($meta, $event) as $col){
		if(in_array((int)$col["id"], $chain, true))
			continue;
		if($event === "UPDATE" && !BtUpdateFires($col["action"], $col["id"], isset($opts["changed"]) ? $opts["changed"] : array(), $meta))
			continue;
		BtRunColumn($port, $event, $rec, $meta, $col, $chain);
	}
}
# Кто исполняет: null — текущий пользователь, иначе контекст пользователя из action.user
function BtRunAs($port, $action){
	if(!isset($action["user"]) || $action["user"] === "" || $action["user"] === null)
		return null;
	return $port["user"]($action["user"]);
}
function BtColLabel($col){ return "Кнопка «".(isset($col["name"]) ? $col["name"] : $col["id"])."»"; }

# Один триггер. Синхронно, по снимку записи после изменения пользователя: исполнитель,
# условие when, пробное вычисление формулы, лимит промптов — их отказы уходят в предупреждение
# ответа. Сама работа отложена (порт defer): она перечитывает запись, поэтому триггеры одного
# события выполняются по порядку колонок и каждый видит результат предыдущих.
function BtRunColumn($port, $event, $rec, $meta, $col, $chain){
	$action = $col["action"];
	$type = $action["type"];
	if($type === "link")
		return;
	try{
		$runAs = BtRunAs($port, $action);
		$ctx = BtContext($meta, $rec);
		if(isset($action["when"]) && $action["when"] !== "" && !BtTruthy(BtFormulaEval($action["when"], $ctx)))
			return;
		if($type === "formula")
			BtFormulaFormat(BtFormulaEval(isset($action["formula"]) ? $action["formula"] : "", $ctx));
		if($type === "query" && (!isset($action["query"]) || $action["query"] === ""))
			throw new BtFormulaError("Запрос не задан");
		if($type === "prompt" && (!isset($action["prompt"]) || $action["prompt"] === ""))
			throw new BtFormulaError("Промпт не задан");
		$recId = (int)$rec["id"];
		$colId = (int)$col["id"];
		if($type === "prompt"){
			$gate = $port["promptGate"]("$recId:$colId");
			if($gate === false)
				return;	# молча (не оплачено) — порт уже записал в журнал
			if($gate !== ""){
				$port["warn"](BtColLabel($col).": ".$gate);
				$port["log"](BtColLabel($col)." #$recId $event: ".$gate);
				return;
			}
		}
		$snapshot = $event === "DELETE" ? $rec : null;
		$port["defer"]("$recId:$colId:$event", function() use ($port, $event, $recId, $meta, $col, $chain, $runAs, $snapshot){
			BtExecColumn($port, $event, $recId, $meta, $col, $chain, $runAs, $snapshot);
		});
	}
	catch(Throwable $e){
		$msg = BtColLabel($col).": ".$e->getMessage();
		$port["warn"]($msg);
		$port["log"]($msg." (#".$rec["id"]." $event)");
	}
}
# Отложенная часть: свежая запись (для DELETE — снимок до удаления), действие, запись результата
function BtExecColumn($port, $event, $recId, $meta, $col, $chain, $runAs, $snapshot){
	$action = $col["action"];
	$type = $action["type"];
	$typeId = (int)$meta["id"];
	$colId = (int)$col["id"];
	if($snapshot)
		$rec = $snapshot;
	elseif(BtRecordGone($port, $recId, $typeId, $col))
		return;
	else
		$rec = $port["record"]($recId);
	$ctx = BtContext($meta, $rec);
	$write = !empty($action["write"]) && $event !== "DELETE";
	$next = array_merge($chain, array($colId));
	if($type === "formula"){
		$value = BtFormulaFormat(BtFormulaEval(isset($action["formula"]) ? $action["formula"] : "", $ctx));
		if($write)
			BtWrite($port, $recId, $typeId, $col, $value, $next, $runAs, false, null);
		return;
	}
	if($type === "query"){
		$params = ltrim(BtSubstitute(isset($action["params"]) ? $action["params"] : "", $ctx, "BtEncodeUriComponent"), "?&");
		$rows = $port["query"]($action["query"], $params, $runAs, $next);
		if($write)
			BtWrite($port, $recId, $typeId, $col, BtFirstValue($rows), $next, $runAs, false, null);
		return;
	}
	$job = array(
		"message" => BtBuildPrompt($action, $ctx, $col["name"], $write),
		"context" => array("page" => "trigger", "table_id" => $typeId, "object_id" => $recId
			, "event" => $event, "column" => (string)$col["name"], "chain" => $next),
		"trigger" => array("rec" => $recId, "type" => $typeId, "col" => $colId, "colName" => (string)$col["name"]
			, "event" => $event, "write" => $write, "chain" => $next
			, "start" => isset($rec["values"][$colId]) ? (string)$rec["values"][$colId] : ""
			, "key" => "$recId:$colId"),
		"runAs" => $runAs
	);
	$res = $port["prompt"]($job);
	if(isset($res["content"]) && $res["content"] !== null)
		BtApplyAnswer($port, $job["trigger"], $res["content"], $runAs);
}
# Запись удалена (или id занят записью другого типа) — оставшиеся триггеры по ней не идут
function BtRecordGone($port, $recId, $typeId, $col){
	if(empty($GLOBALS["BT_GONE"][(int)$recId])){
		$rec = $port["record"]($recId);
		if($rec && (int)$rec["type"] === (int)$typeId)
			return false;
		$GLOBALS["BT_GONE"][(int)$recId] = TRUE;
	}
	$port["log"](BtColLabel($col).": запись #$recId удалена — действие пропущено");
	return true;
}
function BtFirstValue($rows){
	if(!is_array($rows) || !count($rows)) return "";
	$first = reset($rows);
	if(!is_array($first) || !count($first)) return "";
	$v = reset($first);
	if(is_int($v)) $v = (float)$v;
	return BtFormulaFormat($v);
}
# Запись результата в колонку кнопки и запуск UPDATE-триггеров записи по цепочке.
# Запись не делается, если записи уже нет или у неё другой тип (удалена, id занят заново),
# и если $expect задан и значение колонки уже не равно ему (поле изменили, пока шла задача).
function BtWrite($port, $recId, $typeId, $col, $value, $chain, $runAs, $asAi, $expect){
	$colId = (int)$col["id"];
	$rec = $port["record"]($recId);
	if(!$rec || (int)$rec["type"] !== (int)$typeId){
		$GLOBALS["BT_GONE"][(int)$recId] = TRUE;
		$port["log"](BtColLabel($col).": запись #$recId удалена — результат не записан");
		return false;
	}
	$current = isset($rec["values"][$colId]) ? (string)$rec["values"][$colId] : "";
	if($expect !== null && $current !== (string)$expect){
		$port["log"](BtColLabel($col).": поле записи #$recId изменилось, пока выполнялось действие («"
			.$expect."» → «".$current."») — результат не записан");
		return false;
	}
	if($current === (string)$value)
		return true;
	try{
		$port["write"]($recId, $colId, (string)$value, $runAs, $asAi, $chain);
	}
	catch(Throwable $e){
		$port["log"](BtColLabel($col).": запись #$recId не сохранена: ".$e->getMessage());
		return false;
	}
	$fresh = $port["record"]($recId);
	if($fresh)
		BtFire($port, "UPDATE", $fresh, array("changed" => array($colId), "chain" => $chain));
	return true;
}
# Ответ агента по задаче триггера: запись в колонку от имени исполнителя с пометкой ~ai
function BtApplyAnswer($port, $trigger, $content, $runAs){
	if(empty($trigger["write"]))
		return false;
	$value = BtCleanAnswer($content);
	$col = array("id" => (int)$trigger["col"], "name" => isset($trigger["colName"]) ? $trigger["colName"] : "");
	return BtWrite($port, (int)$trigger["rec"], (int)$trigger["type"], $col, $value
		, isset($trigger["chain"]) ? $trigger["chain"] : array($col["id"]), $runAs, true
		, isset($trigger["start"]) ? (string)$trigger["start"] : null);
}
