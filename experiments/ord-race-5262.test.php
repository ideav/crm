<?php
# Мерка к issue #5262: порядок среди равных (ord) при параллельных запросах под одним родителем.
# https://github.com/ideav/crm/issues/5262
#
# Новый ord считается отдельным запросом SELECT MAX(ord)+1 и записывается позже (INSERT/UPDATE).
# Два запроса, попавшие между этими шагами, получали одинаковый ord; _m_ord читал ord записи до
# чужой пересортировки и сдвигал соседей по устаревшему значению — в группе появлялся дубль.
# Здесь каждый запрос — Fiber; база в памяти, после КАЖДОГО SQL управление уходит другому запросу
# (худшее переплетение). GET_LOCK в фейковой базе ведёт себя как в MySQL: занятое имя ждёт
# освобождения, своё берётся повторно. Функции ядра — настоящие, из index.php: Calc_Order, Get_Ord,
# GetRefOrd, Insert, OrdLock, OrdLockOf, UniqueKeyUnlock и ветка case "_m_ord" главного switch.
#
# Запуск: php experiments/ord-race-5262.test.php (php 8.1+, нужен Fiber)

namespace OrdRaceTest5262;

$GLOBALS["failures"] = 0;
function expect($cond, $name){
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $GLOBALS["failures"]++; }
}
function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new \Exception("в index.php нет функции ".$name);
    $brace = strpos($source, "{", $start);
    for($i = $brace, $depth = 0, $len = strlen($source); $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}" && --$depth === 0) return substr($source, $start, $i - $start + 1);
    }
    throw new \Exception("не закрыта функция ".$name);
}

# ── База в памяти ───────────────────────────────────────────────────────────
class Db {
    static $rows = array();     # id => [t, up, ord, val]
    static $locks = array();    # имя => владелец (номер запроса)
    static $next = 1000;
    static $who = 0;            # чей запрос сейчас выполняется
}
class Result { public $rows; function __construct($rows){ $this->rows = $rows; } }
function maxOrd($cond){
    $m = null;
    foreach(Db::$rows as $id => $r)
        if($cond($r)) $m = $m === null ? $r[2] : max($m, $r[2]);
    return $m;
}
function Exec_sql($sql, $msg){
    $sql = trim(preg_replace('/\s+/', ' ', $sql));
    if(preg_match("/^SELECT GET_LOCK\('([^']+)', (\d+)\)$/", $sql, $m)){
        while(isset(Db::$locks[$m[1]]) && Db::$locks[$m[1]] !== Db::$who)
            \Fiber::suspend();      # ждём, пока владелец снимет
        if(isset($GLOBALS["LOCK_ANSWER"]))
            $r = new Result(array(array($GLOBALS["LOCK_ANSWER"])));
        else {
            Db::$locks[$m[1]] = Db::$who;
            $r = new Result(array(array("1")));
        }
    }
    elseif(preg_match("/^SELECT RELEASE_LOCK\('([^']+)'\)$/", $sql, $m)){
        unset(Db::$locks[$m[1]]);
        $r = new Result(array(array("1")));
    }
    elseif(preg_match("/^SELECT COALESCE\(MAX\(ord\)\+1, 1\) FROM z WHERE t=(\d+) AND up=(\d+)$/", $sql, $m)){
        $v = maxOrd(function($r) use ($m){ return $r[0] == $m[1] && $r[1] == $m[2]; });
        $r = new Result(array(array($v === null ? 1 : $v + 1)));
    }
    elseif(preg_match("/^SELECT max\(ord\) ord FROM z WHERE up=(\d+)(?: AND t=(\d+))?$/", $sql, $m)){
        $v = maxOrd(function($r) use ($m){ return $r[1] == $m[1] && (empty($m[2]) || $r[0] == $m[2]); });
        $r = new Result(array(array("ord" => $v, 0 => $v)));
    }
    elseif(preg_match("/^SELECT max\(ord\) ord FROM z WHERE up=(\d+) AND val='([^']*)'$/", $sql, $m)){
        $v = maxOrd(function($r) use ($m){ return $r[1] == $m[1] && $r[3] === $m[2]; });
        $r = new Result(array(array("ord" => $v, 0 => $v)));
    }
    elseif(preg_match("/^SELECT up FROM z WHERE id=(\d+)$/", $sql, $m)){
        $r = new Result(isset(Db::$rows[$m[1]]) ? array(array("up" => Db::$rows[$m[1]][1])) : array());
    }
    elseif(preg_match("/^SELECT obj\.ord, obj\.up FROM z obj, z par WHERE obj\.id=(\d+) AND par\.id=obj\.up AND par\.up!=0$/", $sql, $m)){
        $o = isset(Db::$rows[$m[1]]) ? Db::$rows[$m[1]] : null;
        $r = new Result($o ? array(array("ord" => (string)$o[2], "up" => (string)$o[1])) : array());
    }
    # _m_ord: один UPDATE — запись на новое место, соседи в диапазоне сдвигаются на 1
    elseif(preg_match("/^UPDATE z CROSS JOIN \(SELECT MAX\(ord\) as max_ord FROM z WHERE up = (\d+)\) m SET ord = CASE WHEN id = (\d+) THEN LEAST\((\d+), m\.max_ord\) ELSE ord \+ SIGN\((\d+) - (\d+)\) END WHERE up = (\d+) AND ord BETWEEN LEAST\((\d+), (\d+)\) AND GREATEST\((\d+), (\d+)\)$/", $sql, $m)){
        $up = (int)$m[1]; $rid = (int)$m[2]; $new = (int)$m[3]; $old = (int)$m[4];
        $max = maxOrd(function($r) use ($up){ return $r[1] == $up; });
        foreach(Db::$rows as $id => $row)
            if($row[1] == $up && $row[2] >= min($old, $new) && $row[2] <= max($old, $new))
                Db::$rows[$id][2] = $id == $rid ? min($new, $max) : $row[2] + ($old <=> $new);
        $r = new Result(array());
    }
    elseif(preg_match("/^INSERT INTO z \(up, ord, t, val\) VALUES \((\d+), (\d+), (\d+), '([^']*)'\)$/", $sql, $m)){
        $GLOBALS["insert_id"] = ++Db::$next;
        Db::$rows[Db::$next] = array((int)$m[3], (int)$m[1], (int)$m[2], $m[4]);
        $r = new Result(array());
    }
    else
        throw new \Exception("фейковая база не знает запрос: ".$sql);
    \Fiber::suspend();              # после каждого запроса — ход другому
    return $r;
}
function mysqli_fetch_array($r){ return $r instanceof Result ? array_shift($r->rows) : null; }
function t9n($s){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $s, $m) ? $m[1] : $s; }
class Died extends \Exception {}
function my_die($msg, $code = ""){ throw new Died($code." ".$msg); }
function Check_Grant($id, $t = 0){}
function Check_Rec_masks($id){}
if(!defined("UNIQUE_LOCK_WAIT")) define("UNIQUE_LOCK_WAIT", 10);
$GLOBALS["z"] = "z";

$source = file_get_contents(__DIR__."/../index.php");
foreach(array("Calc_Order", "Get_Ord", "GetRefOrd", "Insert", "UniqueKeyUnlock") as $fn){
    try { eval("namespace OrdRaceTest5262; ".extract_function_source($source, $fn)); }
    catch(\Exception $e){ expect(false, $e->getMessage()); }
}
# Блокировки порядка могут отсутствовать (ядро до фикса) — тогда гонки ниже должны покраснеть
foreach(array("OrdLock", "OrdLockOf") as $fn){
    try { eval("namespace OrdRaceTest5262; ".extract_function_source($source, $fn)); }
    catch(\Exception $e){ echo "NOTE: ".$e->getMessage()."\n"; eval("namespace OrdRaceTest5262; function $fn(\$x){}"); }
}
$from = strpos($source, "\t\tcase \"_m_ord\":");
$to = $from === false ? false : strpos($source, "\t\tcase \"_m_id\":", $from);
if($from === false || $to === false) expect(false, "в index.php нет ветки case \"_m_ord\"");
else eval('namespace OrdRaceTest5262; function run_m_ord($id){ global $z; $a = "_m_ord"; switch($a){ '.substr($source, $from, $to - $from).' } }');
if($GLOBALS["failures"]){ fwrite(STDERR, "FAILED: ".$GLOBALS["failures"]."\n"); exit(1); }

# ── Запросы ─────────────────────────────────────────────────────────────────
# Каждый запрос в конце снимает свои блокировки, как конец скрипта / BtRunDeferred
function request($job){
    switch($job[0]){
        case "calc":    # добавление элемента массива (_m_new, сохранение формы, копирование)
            $ord = Calc_Order($job[1], $job[2]);
            Insert($job[1], $ord, $job[2], "x", "Add Object");
            break;
        case "getord":  # добавление реквизита (_d_req, импорт)
            Insert($job[1], Get_Ord($job[1]), $job[2], "", "Add Req");
            break;
        case "reford":  # значение множественной ссылки
            Insert($job[1], GetRefOrd($job[1], $job[2]), $job[3], (string)$job[2], "Insert new Ref Attr");
            break;
        case "mord":    # _m_ord: поставить запись на место N
            run_m_ord($job[1]);
            break;
    }
    UniqueKeyUnlock();
    return "ok";
}
function race($jobs){
    $fibers = array(); $out = array(); $locks = array();
    foreach($jobs as $n => $job){
        $fibers[$n] = new \Fiber(function() use ($job){ return request($job); });
        $locks[$n] = array();
    }
    for($step = 0; count($fibers) && $step < 1000; $step++)
        foreach($fibers as $n => $f){
            Db::$who = $n;
            $GLOBALS["UNIQUE_LOCKS"] = $locks[$n];
            $_REQUEST = $jobs[$n][0] === "mord" ? array("order" => (string)$jobs[$n][2]) : array();
            try {
                $f->isStarted() ? $f->resume() : $f->start();
            } catch(Died $e){ $out[$n] = "died ".$e->getMessage(); unset($fibers[$n]); continue; }
            $locks[$n] = isset($GLOBALS["UNIQUE_LOCKS"]) ? $GLOBALS["UNIQUE_LOCKS"] : array();
            if($f->isTerminated()){ $out[$n] = $f->getReturn(); unset($fibers[$n]); }
        }
    expect(!count($fibers), "все запросы завершились (нет взаимной блокировки)");
    return $out;
}
# ord записей под родителем (по возрастанию), с фильтром по t или val
function ords($up, $cond = null){
    $o = array();
    foreach(Db::$rows as $r) if($r[1] == $up && (!$cond || $cond($r))) $o[] = $r[2];
    sort($o);
    return $o;
}
function seed($rows){ Db::$rows = $rows; Db::$locks = array(); Db::$next = 1000; }

# 1. Два добавления элемента массива под одним родителем — разные ord
seed(array());
race(array(1 => array("calc", 50, 700), 2 => array("calc", 50, 700)));
expect(ords(50) === array(1, 2), "Calc_Order: два параллельных добавления получили ord 1 и 2, не 1 и 1 (".implode(",", ords(50)).")");

seed(array(10 => array(700, 50, 1, "a"), 11 => array(700, 50, 2, "b")));
race(array(1 => array("calc", 50, 700), 2 => array("calc", 50, 700), 3 => array("calc", 50, 700), 4 => array("calc", 50, 700)));
expect(ords(50) === array(1, 2, 3, 4, 5, 6), "Calc_Order: четыре добавления к двум записям — ord 1..6 без повторов (".implode(",", ords(50)).")");

# 2. Реквизиты (Get_Ord) и значения множественной ссылки (GetRefOrd)
seed(array(20 => array(5, 60, 1, "")));
race(array(1 => array("getord", 60, 6), 2 => array("getord", 60, 7)));
expect(ords(60) === array(1, 2, 3), "Get_Ord: два параллельных реквизита — ord 2 и 3 (".implode(",", ords(60)).")");

seed(array());
race(array(1 => array("reford", 70, 333, 901), 2 => array("reford", 70, 333, 902), 3 => array("reford", 70, 333, 903)));
expect(ords(70) === array(1, 2, 3), "GetRefOrd: три значения одной ссылки — ord 1..3 (".implode(",", ords(70)).")");

# 3. Разные родители друг друга не ждут и не путаются
seed(array());
race(array(1 => array("calc", 80, 700), 2 => array("calc", 81, 700)));
expect(ords(80) === array(1) && ords(81) === array(1), "разные родители: у каждого свой ord 1");

# 4. Две пересортировки (_m_ord) в одной группе: a1 b2 c3 d4; «d на 1-е место» и «c на 4-е»
seed(array(31 => array(700, 90, 1, "a"), 32 => array(700, 90, 2, "b"), 33 => array(700, 90, 3, "c"), 34 => array(700, 90, 4, "d")));
race(array(1 => array("mord", 34, 1), 2 => array("mord", 33, 4)));
$o = ords(90);
expect($o === array(1, 2, 3, 4), "_m_ord: две параллельные пересортировки — ord 1..4 без повторов (".implode(",", $o).")");
expect(Db::$rows[34][2] === 1, "_m_ord: d встала на 1-е место");

# 5. Пересортировка и добавление одновременно
seed(array(41 => array(700, 95, 1, "a"), 42 => array(700, 95, 2, "b"), 43 => array(700, 95, 3, "c")));
race(array(1 => array("mord", 43, 1), 2 => array("calc", 95, 700), 3 => array("mord", 41, 3)));
$o = ords(95);
expect($o === array(1, 2, 3, 4), "_m_ord + добавление: ord 1..4 без повторов (".implode(",", $o).")");

expect(!count(Db::$locks), "после запросов блокировок не осталось");

# 6. Блокировку не дали за время ожидания (GET_LOCK ответил 0) — 409, ord не вычислен и запись не вставлена
seed(array());
$GLOBALS["LOCK_ANSWER"] = "0";
$out = race(array(7 => array("calc", 50, 700)));
unset($GLOBALS["LOCK_ANSWER"]);
expect(strpos($out[7], "died 409") === 0 && !count(Db::$rows), "тайм-аут блокировки — 409 и записи нет (".$out[7].")");

if($GLOBALS["failures"]){ fwrite(STDERR, "FAILED: ".$GLOBALS["failures"]."\n"); exit(1); }
echo "OK\n";
