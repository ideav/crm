<?php
# Issue #5290: перенос записи к другому родителю (_m_move) — событие UPDATE для триггеров
# колонок-кнопок. Смена родителя попадает в набор изменённых колонок служебным признаком
# BT_POSITION_CHANGED (0): действие без ссылок на колонки срабатывает, действие со ссылкой
# ({Цена}) — нет. Перенос под того же родителя — без события.
#
# Исполняется настоящая ветка case "_m_move" из index.php и настоящие BtRecord / BtHookBefore /
# BtHookAfter на заглушке БД в памяти (Exec_sql отвечает по описанию запроса).
#
# Запуск: php experiments/button-triggers-move-5290.test.php

ob_start();
$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function eq($got, $want, $name){
    $ok = $got === $want;
    expect($ok, $name.($ok ? "" : " — got ".json_encode($got, JSON_UNESCAPED_UNICODE)." want ".json_encode($want, JSON_UNESCAPED_UNICODE)));
}
function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("Function not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}

require __DIR__."/../include/field_attrs.php";
require __DIR__."/../include/button_triggers.php";

# ── База в памяти: таблица «Заказ» (500) с колонкой «Цена» и двумя кнопками ──
$z = "test";
function act($a){ return json_encode(array("action" => $a), JSON_UNESCAPED_UNICODE); }
function world(){
    $GLOBALS["META"] = array(500 => array("id" => 500, "name" => "Заказ", "base" => "SHORT", "cols" => array(
        array("id" => 502, "name" => "Цена", "base" => "SHORT", "ref" => false, "attrs" => ""),
        array("id" => 510, "name" => "Пересчёт", "base" => "BUTTON", "ref" => false
            , "attrs" => act(array("type" => "formula", "formula" => "{Цена}*2", "on" => array("UPDATE")))),
        array("id" => 511, "name" => "Журнал", "base" => "BUTTON", "ref" => false
            , "attrs" => act(array("type" => "formula", "formula" => "1", "on" => array("UPDATE")))),
    )));
    # Записи: id => [t, val, up, ord]; 1 — корень, 70 и 71 — родители (тип 400)
    $GLOBALS["DB"] = array(
        70 => array(400, "Клиент А", 1, 1), 71 => array(400, "Клиент Б", 1, 2),
        80 => array(500, "Заказ 1", 70, 1), 81 => array(500, "Заказ 2", 70, 2),
        90 => array(502, "100", 80, 1),
    );
    $GLOBALS["SQL"] = array();
    $GLOBALS["FIRED"] = array();
    $GLOBALS["BT_WARN"] = array();
    $GLOBALS["BT_GONE"] = array();
    unset($GLOBALS["warning"]);
}
class Rows { public $rows; function __construct($rows){ $this->rows = $rows; } }
function fake_fetch($r){ return ($r instanceof Rows && count($r->rows)) ? array_shift($r->rows) : null; }
function Exec_sql($sql, $desc){
    $DB =& $GLOBALS["DB"];
    $GLOBALS["SQL"][] = $desc;
    $id = preg_match('/\bid=(\d+)/', $sql, $m) ? (int)$m[1] : 0;
    switch($desc){
        case "Button triggers: record type":
            return new Rows(isset($DB[$id]) && $DB[$id][2] != 0 ? array(array("t" => $DB[$id][0])) : array());
        case "Button triggers: record":
            return new Rows(isset($DB[$id]) ? array(array("t" => $DB[$id][0], "val" => $DB[$id][1], "up" => $DB[$id][2])) : array());
        case "Button triggers: record values":
            preg_match('/c\.up=(\d+)/', $sql, $m);
            $out = array();
            foreach($DB as $k => $r)
                if($r[2] == (int)$m[1]) $out[] = array("t" => $r[0], "val" => $r[1], "rval" => null);
            return new Rows($out);
        case "Get Obj to move":
            preg_match('/a\.id=(\d+) AND target\.id=(\d+)/', $sql, $m);
            $a = $DB[(int)$m[1]]; $target = (int)$m[2];
            $ord = 0;
            foreach($DB as $r) if($r[2] == $target) $ord = max($ord, $r[3]);
            return new Rows(array(array("up" => $a[2], "t" => $a[0], "ut" => $DB[$a[2]][0], "ord" => $a[3], "tt" => $DB[$target][0], "new_ord" => $ord + 1)));
        case "Move Obj":
            preg_match('/SET ord=(\d+), up=(\d+) WHERE id=(\d+)/', $sql, $m);
            $DB[(int)$m[3]][3] = (int)$m[1];
            $DB[(int)$m[3]][2] = (int)$m[2];
            return true;
        case "Move peers up":
            return true;
    }
    throw new Exception("unexpected SQL: $desc");
}
function BtMeta($t){ return isset($GLOBALS["META"][$t]) ? $GLOBALS["META"][$t] : null; }
function BtDefer($key, $fn){ $GLOBALS["FIRED"][] = $key; }
function BtLog($m){ $GLOBALS["LOG"][] = $m; }
function BtViewValue($base, $val){ return (string)$val; }
function Check_Grant($id, $t=0){}
function Check_Rec_masks($id){}
function Grant_1level($t){ return "WRITE"; }
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }

# В CI у php есть mysqli — mysqli_fetch_array не переопределить, вызовы ядра идут в заглушку
function fake_db($code){ return str_replace("mysqli_fetch_array(", "fake_fetch(", $code); }

$source = file_get_contents(__DIR__."/../index.php");
foreach(array("BtCorePort", "BtWarn", "BtDrainWarnings", "BtSkipRequest", "BtChainFromRequest",
        "BtRecord", "BtHookBefore", "BtHookAfter", "BtHookAfterWarn") as $fn)
    eval(fake_db(extract_function_source($source, $fn)));

# Ветка case "_m_move" главного switch ядра — как есть
$from = strpos($source, "\t\tcase \"_m_move\":");
$to = strpos($source, "\t\tcase \"_m_del\":", $from);
if($from === false || $to === false) throw new Exception("case _m_move not found");
eval('function run_move($id, $up){ global $z; $a = "_m_move"; switch($a){ '.fake_db(substr($source, $from, $to - $from)).' } return $a; }');

# ── 1. Движок: смена родителя — служебный признак в наборе изменённых колонок ──
world();
$pos = defined("BT_POSITION_CHANGED") ? constant("BT_POSITION_CHANGED") : "undefined";
$before = BtRecord(80);
$GLOBALS["DB"][80][2] = 71;
eq(BtDiff($before, BtRecord(80)), array($pos), "diff: a new parent is reported as BT_POSITION_CHANGED");
eq($pos, 0, "BT_POSITION_CHANGED is 0 (as POSITION_CHANGED in the ai2o core) — never a column id");

# ── 2. _m_move к другому родителю: UPDATE, кнопка без ссылок срабатывает ──
world();
run_move(80, 71);
eq($GLOBALS["DB"][80][2], 71, "_m_move: the record is moved to the new parent");
eq($GLOBALS["FIRED"], array("80:511:UPDATE"), "_m_move: UPDATE fires the action without column references, not the one with {Цена}");

# ── 3. Перенос под того же родителя — записи нет, события нет ──
world();
run_move(80, 70);
eq($GLOBALS["FIRED"], array(), "_m_move to the same parent: no event");

# ── 4. Запрос пишет ИИ-агент (client=ai) — триггеры не запускаются, как в _m_set ──
world();
$_GET["client"] = "ai";
run_move(80, 71);
unset($_GET["client"]);
eq($GLOBALS["FIRED"], array(), "_m_move by the AI agent (client=ai): no trigger");

echo $failures ? "\nFAILED: $failures\n" : "\nALL PASSED\n";
ob_end_flush();
exit($failures ? 1 : 0);
