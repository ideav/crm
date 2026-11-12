<?php
# Мерка к issue #5465: два одновременных _m_new с одним значением уникальной таблицы.
# https://github.com/ideav/crm/issues/5465
#
# Проверка дубля (SELECT) и вставка (INSERT) — разные запросы. На ideav.ru/timepad 12 гостей
# одновременно бронировали один слот: из 25 слотов два получили по две записи.
# Здесь два «запроса» — два Fiber; база в памяти, и после КАЖДОГО SQL управление уходит другому
# запросу (худшее переплетение). GET_LOCK в фейковой базе ведёт себя как в MySQL: занятое имя
# ждёт освобождения, своё — берётся повторно. Функции ядра — настоящие, из index.php:
# UniqueKeyLock, UniqueKeyUnlock, FindUniqueRecordDuplicateFromRequest, FindUniqueRecordDuplicate, Insert.
# Последовательность одного запроса: проверка → вставка → конец запроса (снятие блокировки).
#
# Запуск: php experiments/unique-key-race-5465.test.php (php 8.1+, нужен Fiber)

namespace RaceTest5465;

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
    static $rows = array();     # id => [t, up, val]
    static $locks = array();    # имя => владелец (номер запроса)
    static $next = 1000;
    static $who = 0;            # чей запрос сейчас выполняется
    static $log = array();
}
class Result { public $rows; function __construct($rows){ $this->rows = $rows; } }
function Exec_sql($sql, $msg){
    Db::$log[] = Db::$who.": ".$sql;
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
    elseif(preg_match("/^SELECT obj.id, obj.ord FROM z obj WHERE obj.t=(\d+) AND obj.up=(\d+) AND obj.val='([^']*)' LIMIT 1$/", $sql, $m)){
        $found = array();
        foreach(Db::$rows as $id => $row)
            if($row[0] == $m[1] && $row[1] == $m[2] && $row[2] === $m[3])
                $found[] = array("id" => $id, "ord" => 1, 0 => $id, 1 => 1);
        $r = new Result(array_slice($found, 0, 1));
    }
    elseif(preg_match("/^INSERT INTO z \(up, ord, t, val\) VALUES \((\d+), (\d+), (\d+), '([^']*)'\)$/", $sql, $m)){
        $GLOBALS["insert_id"] = ++Db::$next;
        Db::$rows[Db::$next] = array((int)$m[3], (int)$m[1], $m[4]);
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
function UniqueKeyReqs($typ){ return array(); }
function UniqueKeyValuesFromRequest($typ, $skipId, $request, $keyReqs){ return array(); }
if(!defined("UNIQUE_LOCK_WAIT")) define("UNIQUE_LOCK_WAIT", 10);
$GLOBALS["z"] = "z";

$source = file_get_contents(__DIR__."/../index.php");
foreach(array("UniqueKeyLock", "UniqueKeyUnlock", "FindUniqueRecordDuplicateFromRequest", "FindUniqueRecordDuplicate", "Insert") as $fn){
    try { eval("namespace RaceTest5465; ".extract_function_source($source, $fn)); }
    catch(\Exception $e){ expect(false, $e->getMessage()); }
}
if($GLOBALS["failures"]){ fwrite(STDERR, "FAILED: ".$GLOBALS["failures"]."\n"); exit(1); }

# Один запрос _m_new в уникальную таблицу: как в ApplyMNew
function create($typ, $up, $val){
    $dup = FindUniqueRecordDuplicateFromRequest($typ, 0, $up, $val, array(), true);
    if($dup){ UniqueKeyUnlock(); return "exists #".$dup["id"]; }
    $id = Insert($up, 1, $typ, $val, "Add Object");
    UniqueKeyUnlock();
    return "created #".$id;
}
# Запросы по очереди, по одному SQL за ход; у каждого запроса свои глобальные блокировки
function race($jobs){
    Db::$rows = array(); Db::$locks = array(); Db::$log = array();
    $fibers = array(); $out = array(); $locks = array();
    foreach($jobs as $n => $job){
        $fibers[$n] = new \Fiber(function() use ($job){ return create($job[0], $job[1], $job[2]); });
        $locks[$n] = array();
    }
    for($step = 0; count($fibers) && $step < 1000; $step++)
        foreach($fibers as $n => $f){
            Db::$who = $n;
            $GLOBALS["UNIQUE_LOCKS"] = $locks[$n];
            $f->isStarted() ? $f->resume() : $f->start();
            $locks[$n] = isset($GLOBALS["UNIQUE_LOCKS"]) ? $GLOBALS["UNIQUE_LOCKS"] : array();
            if($f->isTerminated()){ $out[$n] = $f->getReturn(); unset($fibers[$n]); }
        }
    expect(!count($fibers), "все запросы завершились (нет взаимной блокировки)");
    ksort($out);
    return $out;
}
function created($out){ return count(array_filter($out, function($r){ return strpos($r, "created") === 0; })); }

$out = race(array(1 => array(857, 1, "700|2026-11-15|10:00"), 2 => array(857, 1, "700|2026-11-15|10:00")));
expect(created($out) === 1, "один слот, два запроса вперемешку: создана ровно одна запись (".implode(", ", $out).")");
expect(count(Db::$rows) === 1, "в базе одна запись на ключ");
expect(strpos($out[2], "exists") === 0, "второй получает «уже существует» с id первой записи");

$out = race(array(1 => array(857, 1, "K"), 2 => array(857, 1, "K"), 3 => array(857, 1, "K"), 4 => array(857, 1, "K"), 5 => array(857, 1, "K")));
expect(created($out) === 1 && count(Db::$rows) === 1, "пять запросов на один ключ — одна запись");

$out = race(array(1 => array(857, 1, "A"), 2 => array(857, 1, "B")));
expect(created($out) === 2, "разные значения не ждут друг друга и создаются оба");
$out = race(array(1 => array(857, 1, "A"), 2 => array(858, 1, "A"), 3 => array(857, 5, "A")));
expect(created($out) === 3, "то же значение в другой таблице или у другого родителя — не дубль");

expect(!count(Db::$locks), "после запросов блокировок не осталось");

# Блокировку не дали за время ожидания (GET_LOCK ответил 0) — отказ 409, а не вставка без проверки
$GLOBALS["LOCK_ANSWER"] = "0";
$GLOBALS["UNIQUE_LOCKS"] = array();
$denied = "";
$f = new \Fiber(function(){ create(857, 1, "Z"); });
Db::$rows = array(); Db::$locks = array(); Db::$who = 7;
try { for($f->start(); !$f->isTerminated(); ) $f->resume(); }
catch(Died $e){ $denied = $e->getMessage(); }
unset($GLOBALS["LOCK_ANSWER"]);
expect(strpos($denied, "409") === 0 && !count(Db::$rows), "тайм-аут блокировки — 409 и записи нет (".trim($denied).")");

if($GLOBALS["failures"]){ fwrite(STDERR, "FAILED: ".$GLOBALS["failures"]."\n"); exit(1); }
echo "OK\n";
