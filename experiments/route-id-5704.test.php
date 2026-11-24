<?php
# Мерка к issue #5704: адрес по имени (/{db}/<действие>/<имя>[/<имя записи>]).
# https://github.com/ideav/crm/issues/5704
#
# Запуск: php experiments/route-id-5704.test.php (в гейте — через одноимённый .test.js)
#
# Функция Route_id берётся ИЗ index.php как есть и выполняется в своём пространстве имён:
# Exec_sql, mysqli_fetch_array и my_die подменены (my_die запоминает текст и код ответа).
#
# Что проверяется:
#   1) номер — id без запросов к базе; пустой сегмент — пустой id;
#   2) запрос по имени: найден — id, нет — 404 «Запрос не найден»;
#   3) таблица по имени: найдена — id; нет — 404 «Таблица не найдена», SQL действия не выполняется;
#   4) запись по имени: найдена — id записи; нет — 404 «Запись не найдена», а не id таблицы;
#      «Таблица/» (пустой сегмент записи) — id таблицы;
#   5) /{db}/ai/agent — третий сегмент не имя: пустой id без запросов.

namespace T5704;

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

define("REPORT", 22);
$z = "t";
class Died extends \Exception { public $code_http; function __construct($msg, $code){ parent::__construct($msg); $this->code_http = $code; } }
function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function my_die($msg, $code = ""){ throw new Died($msg, $code); }

# ── База: таблица «Клиент» (id 500) с записью «Альфа» (id 501), запрос «Сводка» (id 700) ──
$DB = array(
	array("id" => 500, "up" => 0, "t" => 3, "val" => "Клиент"),
	array("id" => 501, "up" => 1, "t" => 500, "val" => "Альфа"),
	array("id" => 700, "up" => 1, "t" => REPORT, "val" => "Сводка"),
);
class Res { public $rows; function __construct($rows){ $this->rows = array_values($rows); } }
function mysqli_fetch_array($res){ return ($res instanceof Res && count($res->rows)) ? array_shift($res->rows) : NULL; }
function val_of($sql){
	if(!preg_match("/val='((?:[^'\\\\]|\\\\.)*)'/u", $sql, $m))
		throw new \Exception("не разобран запрос: $sql");
	return mb_strtolower(stripslashes($m[1]));	# сравнение в MySQL — без учёта регистра
}
function Exec_sql($sql, $msg){
	$GLOBALS["SQL_LOG"][] = $msg;
	$v = val_of($sql);
	switch($msg){
		case "Get report by name":
			$f = function($r) use ($v){ return $r["t"] == REPORT && mb_strtolower($r["val"]) === $v; };
			break;
		case "Get object by name":
			$f = function($r) use ($v){ return $r["up"] == 0 && mb_strtolower($r["val"]) === $v; };
			break;
		case "Get record by name":
			if(!preg_match("/t=(\d+) AND up!=0/", $sql, $m))
				throw new \Exception("не разобран запрос: $sql");
			$t = (int)$m[1];
			$f = function($r) use ($v, $t){ return $r["t"] == $t && $r["up"] != 0 && mb_strtolower($r["val"]) === $v; };
			break;
		default:
			throw new \Exception("неожиданный запрос [$msg]: $sql");
	}
	return new Res(array_map(function($r){ return array("id" => $r["id"], 0 => $r["id"]); }, array_filter($GLOBALS["DB"], $f)));
}

# ── Код ядра ──────────────────────────────────────────────────────────────────────────────
$src = file_get_contents(__DIR__."/../index.php");
if(!preg_match('/^function Route_id\(.*?^}\n/ms', str_replace("\r\n", "\n", $src), $m)){
	fwrite(STDERR, "В index.php нет функции Route_id — мерка потеряла предмет\n");
	exit(1);
}
eval("namespace T5704;\n".$m[0]);

# Адрес как в index.php: explode("/") от strtolower(REQUEST_URI) без «?…»
function route($uri){
	$com = explode("/", explode("?", strtolower($uri))[0]);
	$GLOBALS["SQL_LOG"] = array();
	try{
		return array("id" => Route_id(isset($com[2]) ? $com[2] : "", $com), "code" => NULL, "msg" => NULL, "sql" => $GLOBALS["SQL_LOG"]);
	}
	catch(Died $e){
		return array("id" => NULL, "code" => $e->code_http, "msg" => $e->getMessage(), "sql" => $GLOBALS["SQL_LOG"]);
	}
}
function enc($s){ return rawurlencode($s); }

echo "── 1. номер и пустой сегмент ──\n";
$r = route("/t/object/500/?JSON=1");
ok($r["id"] === 500 && $r["sql"] === array(), "номер — id без запросов", shown($r));
$r = route("/t/object/");
ok($r["id"] === "" && $r["code"] === NULL, "«object/» — пустой id", shown($r));
$r = route("/t/object");
ok($r["id"] === "" && $r["code"] === NULL, "без третьего сегмента — пустой id", shown($r));

echo "── 2. запрос по имени ──\n";
$r = route("/t/report/".enc("Сводка")."?JSON=1");
ok($r["id"] === 700, "найден — id запроса", shown($r));
$r = route("/t/report/".enc("Нет такого")."?JSON=1");
ok($r["code"] === "404 Not Found" && $r["msg"] === "Запрос не найден", "нет — 404 «Запрос не найден»", shown($r));

echo "── 3. таблица по имени ──\n";
$r = route("/t/object/".enc("Клиент")."/?JSON=1");
ok($r["id"] === 500 && $r["code"] === NULL, "найдена — id таблицы", shown($r));
$r = route("/t/object/".enc("НетТакой")."/?JSON=1");
ok($r["code"] === "404 Not Found" && $r["msg"] === "Таблица не найдена", "нет — 404 «Таблица не найдена»", shown($r));
foreach(array("edit_obj", "_m_set", "_m_new", "_d_req") as $act){
	$r = route("/t/$act/".enc("НетТакой"));
	ok($r["code"] === "404 Not Found", "$act/НетТакой — 404, пустой id не уходит в действие", shown($r));
}

echo "── 4. запись по имени ──\n";
$r = route("/t/_m_set/".enc("Клиент")."/".enc("Альфа"));
ok($r["id"] === 501, "найдена — id записи", shown($r));
$r = route("/t/_m_set/".enc("Клиент")."/".enc("Нет такой записи"));
ok($r["code"] === "404 Not Found" && $r["msg"] === "Запись не найдена", "нет — 404 «Запись не найдена», а не id таблицы", shown($r));
$r = route("/t/object/".enc("Клиент")."/");
ok($r["id"] === 500 && !in_array("Get record by name", $r["sql"]), "«Таблица/» — id таблицы, запись не ищется", shown($r));

echo "── 5. третий сегмент — не имя ──\n";
foreach(array("/t/ai/agent", "/t/ai/agent/settings", "/t/ai/chat") as $uri){
	$r = route($uri);
	ok($r["id"] === "" && $r["code"] === NULL && $r["sql"] === array(), "$uri — пустой id без запросов", shown($r));
}

echo $failed ? "\nПРОВАЛЕНО: $failed\n" : "\nroute-id-5704: всё прошло\n";
exit($failed ? 1 : 0);
