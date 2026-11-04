<?php
# Issue #5269: web-socket в ядре — PHP-сторона. Ядро копит изменения данных из журнала
# (logChange), после ответа превращает их в события с цепочкой типов (запись → её объект →
# родитель … → объект первого уровня) и отправляет подписанным POST демону ws-server/.
# Демон по типам из цепочки раздаёт события подписчикам таблиц.
#
# Проверяет include/ws_push.php и проводку в index.php (настоящие logChange и
# Report_tx_rollback, вырезанные из index.php).
#
# Запуск: php experiments/ws-push-5269.test.php

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
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("Function not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("Unbalanced: ".$name);
}
function rec($op, $id, $up, $t, $extra = array()){
    return array_merge(array("v" => 1, "op" => $op, "id" => $id, "up" => $up, "t" => $t, "user" => "ann", "uid" => 7), $extra);
}
function reset_buf(){ unset($GLOBALS["WS_BUF"], $GLOBALS["REPORT_TX"]); }
function ws_changes(){ return isset($GLOBALS["WS_BUF"]["changes"]) ? $GLOBALS["WS_BUF"]["changes"] : array(); }

define("TOKEN", 125); define("XSRF", 40); define("ACTIVITY", 124); define("PASSWORD", 20); define("SECRET", 130);
define("WS_MAX_CHANGES", 5);
$lib = __DIR__."/../include/ws_push.php";
if(!is_file($lib)){
    echo "FAIL: include/ws_push.php отсутствует\n";
    exit(1);
}
require_once $lib;

# ── Выключено: без адреса демона ядро ничего не копит ──
reset_buf();
Ws_collect(rec("insert", 10, 1, 500));
expect(!Ws_enabled() && empty($GLOBALS["WS_BUF"]["changes"]), "без WS_PUSH_URL изменения не копятся");

define("WS_PUSH_URL", "http://127.0.0.1:8790/push");
define("WS_SECRET", "s3cret");

# ── Сбор: строки данных копятся, служебные (токен, xsrf, активность) — нет ──
reset_buf();
Ws_collect(rec("insert", 10, 1, 500));
Ws_collect(rec("update", 11, 10, 501, array("old" => "a", "new" => "b")));
Ws_collect(rec("delete", 12, 10, 502));
Ws_collect(rec("update", 13, 7, TOKEN));
Ws_collect(rec("insert", 14, 7, XSRF));
Ws_collect(rec("update", 15, 7, ACTIVITY));
eq(array_map(function($c){ return $c["op"].":".$c["id"]; }, $GLOBALS["WS_BUF"]["changes"])
    , array("insert:10", "update:11", "delete:12"), "служебные строки авторизации не уходят в события");
expect(!isset($GLOBALS["WS_BUF"]["changes"][1]["old"]), "значения в событие не попадают — только адрес строки");
eq($GLOBALS["WS_BUF"]["bulk"], FALSE, "построчные изменения — не массовые");

# ── Массовые: сырой SQL, DDL, импорт, переполнение ──
reset_buf();
Ws_collect(array("op" => "sql", "sql" => "UPDATE x SET id=1 WHERE id=2", "n" => 1));
eq($GLOBALS["WS_BUF"]["bulk"], TRUE, "op:sql без адреса строки — массовое изменение");
reset_buf();
Ws_collect(array("op" => "import", "inserted" => 100));
eq($GLOBALS["WS_BUF"]["bulk"], TRUE, "сводка импорта — массовое изменение");
reset_buf();
Ws_collect(rec("insert", 1, 1, 500, array("err" => "Duplicate")));
expect(empty($GLOBALS["WS_BUF"]["changes"]) && empty($GLOBALS["WS_BUF"]["bulk"]), "неудавшаяся запись (err) — не событие");
reset_buf();
for($i = 1; $i <= WS_MAX_CHANGES + 2; $i++)
    Ws_collect(rec("insert", 100 + $i, 1, 500));
eq(count($GLOBALS["WS_BUF"]["changes"]), WS_MAX_CHANGES, "сверх WS_MAX_CHANGES строки не копятся");
eq($GLOBALS["WS_BUF"]["bulk"], TRUE, "переполнение — массовое изменение");

# ── Цепочка типов ──
# Схема: тип 500 (up=0), его реквизит-определение 600 (up=500); объект 10 (t=500, up=1);
# значение реквизита 11 (t=501, up=10); подчинённый объект 20 (t=700, up=10);
# его значение 21 (t=701, up=20).
$db = array(
    500 => array("up" => 0, "t" => 3), 600 => array("up" => 500, "t" => 501),
    10 => array("up" => 1, "t" => 500), 11 => array("up" => 10, "t" => 501),
    20 => array("up" => 10, "t" => 700), 21 => array("up" => 20, "t" => 701),
);
$calls = array();
$lookup = function($ids) use (&$db, &$calls){
    $calls[] = $ids;
    $out = array();
    foreach($ids as $id)
        if(isset($db[$id])) $out[$id] = $db[$id];
    return $out;
};
function by_id($events){
    $out = array();
    foreach($events as $e)
        $out[$e["k"].":".(isset($e["id"]) ? $e["id"] : $e["t"])] = $e;
    return $out;
}
$ch = function($op, $id, $up, $t, $extra = array()){ return array_merge(array("op" => $op, "id" => $id, "up" => $up, "t" => $t), $extra); };

$ev = by_id(Ws_resolve(array(
    $ch("insert", 10, 1, 500),       # объект первого уровня
    $ch("update", 11, 10, 501),      # значение реквизита объекта 10
    $ch("insert", 21, 20, 701),      # значение у подчинённого объекта 20
    $ch("update", 600, 500, 501),    # определение реквизита — схема типа 500
    $ch("update", 500, 0, 3),        # сам тип — схема
    $ch("insert", 30, 999, 500),     # родителя нет в базе — адрес не установить
), $lookup));
eq($ev["change:10"]["types"], array(500), "объект первого уровня: цепочка из своего типа");
eq($ev["change:11"]["types"], array(501, 500), "значение реквизита: свой тип и тип объекта");
eq($ev["change:21"]["types"], array(701, 700, 500), "подчинённый: до объекта первого уровня");
eq(array($ev["change:11"]["op"], $ev["change:11"]["up"]), array("update", 10), "в событии операция и родитель");
expect(isset($ev["schema:500"]) && !isset($ev["change:600"]) && !isset($ev["change:500"]), "правка метаданных — событие схемы типа");
eq(count(array_filter(array_keys($ev), function($k){ return $k === "schema:500"; })), 1, "схема типа — одним событием");
expect(!isset($ev["change:30"]), "строка с неизвестным родителем не рассылается");
expect(count($calls) <= 3, "родители читаются пачками по уровням, а не по строке (".count($calls)." запроса)");

# Удаление объекта вместе со значениями: родителя в базе уже нет, адрес берётся из той же пачки
$calls = array();
$ev = by_id(Ws_resolve(array($ch("delete", 41, 40, 501), $ch("delete", 40, 1, 500)), $lookup));
eq($ev["change:41"]["types"], array(501, 500), "удалённый родитель берётся из той же пачки изменений");
eq(count($calls), 0, "все адреса известны из пачки — без чтения базы");

# Перенос к другому родителю: событие получают подписчики и старого, и нового места
$db[50] = array("up" => 1, "t" => 800);
$ev = by_id(Ws_resolve(array($ch("update", 22, 50, 700, array("old_up" => 10))), $lookup));
eq($ev["change:22"]["types"], array(700, 800, 500), "перенос: типы нового и старого родителя");

# Повторные правки одной строки — одно событие
$ev = Ws_resolve(array($ch("update", 11, 10, 501), $ch("update", 11, 10, 501), $ch("delete", 11, 10, 501)), $lookup);
eq(count($ev), 1, "правки одной строки за запрос сливаются");
eq($ev[0]["op"], "delete", "итог — последняя операция");

# ── Транзакция запроса (InTransaction): откат и незафиксированное — не рассылаются ──
reset_buf();
Ws_collect(rec("insert", 10, 1, 500));
$GLOBALS["REPORT_TX"] = 77;
Ws_collect(rec("insert", 11, 10, 501));
Ws_tx_end(FALSE);
unset($GLOBALS["REPORT_TX"]);
eq(array_column($GLOBALS["WS_BUF"]["changes"], "id"), array(10), "откат транзакции убирает её изменения");
$GLOBALS["REPORT_TX"] = 78;
Ws_collect(rec("insert", 12, 10, 501));
unset($GLOBALS["REPORT_TX"]);
Ws_tx_end(TRUE);
$GLOBALS["REPORT_TX"] = 79;
Ws_collect(rec("insert", 13, 10, 501));    # die посреди транзакции: соединение закроется без COMMIT
$sent = array();
$sender = function($url, $body, $sig) use (&$sent){ $sent[] = array($url, $body, $sig); return TRUE; };
Ws_flush($sender, $lookup);
unset($GLOBALS["REPORT_TX"]);
$p = json_decode($sent[0][1], TRUE);
eq(array_column($p["events"], "id"), array(10, 12), "зафиксированное уходит, незафиксированное на выходе — нет");

# ── Отправка: подпись, адрес, очистка буфера ──
$GLOBALS["z"] = "demo";
$GLOBALS["GLOBAL_VARS"] = array("user" => "ann", "user_id" => 7);
reset_buf();
Ws_collect(rec("insert", 10, 1, 500));
Ws_notify(array("Bob", "carl"), array("msg" => "Готово", "link" => "/demo/object/500"));
$sent = array();
Ws_flush($sender, $lookup);
eq(count($sent), 1, "одна отправка за запрос");
eq($sent[0][0], WS_PUSH_URL, "адрес демона — WS_PUSH_URL");
eq($sent[0][2], hash_hmac("sha256", $sent[0][1], WS_SECRET), "тело подписано HMAC-SHA256 общим секретом");
$p = json_decode($sent[0][1], TRUE);
eq(array($p["db"], $p["by"], $p["bulk"]), array("demo", "ann", FALSE), "в теле база, автор, признак массовости");
eq($p["notify"], array(array("to" => array("bob", "carl"), "from" => "ann", "data" => array("msg" => "Готово", "link" => "/demo/object/500")))
    , "уведомление адресовано логинам в нижнем регистре, отправитель — текущий пользователь");
$sent = array();
Ws_flush($sender, $lookup);
eq(count($sent), 0, "после отправки буфер пуст — повторно ничего не уходит");
reset_buf();
Ws_collect(array("op" => "sql", "sql" => "x", "err" => "boom"));
Ws_flush($sender, $lookup);
eq(count($sent), 0, "только ошибки — нечего отправлять");

# ── Право подписки на таблицу (тип) ──
# Тип 700 — подчинённая таблица типа 500 (строка-массив 650: up=500, t=700).
$arr = function($t){ return $t == 700 ? array("id" => 650, "up" => 500) : NULL; };
$ctx = function($user, $grants, $grant1) use ($arr){
    return array("user" => $user, "grants" => $grants, "arr" => $arr, "grant1" => $grant1);
};
$g1none = function($t){ return FALSE; };
$g1read = function($t){ return $t == 500 ? "READ" : FALSE; };
expect(Ws_type_readable(500, $ctx("admin", array(), $g1none)), "admin видит всё");
expect(Ws_type_readable(500, $ctx("ann", array(500 => "READ"), $g1none)), "явное READ на тип");
expect(Ws_type_readable(500, $ctx("ann", array(500 => "WRITE"), $g1none)), "WRITE включает чтение");
expect(!Ws_type_readable(500, $ctx("ann", array(500 => "BARRED"), $g1read)), "явный запрет сильнее общего права");
expect(Ws_type_readable(500, $ctx("ann", array(), $g1read)), "тип первого уровня — по правилу Grant_1level");
expect(!Ws_type_readable(500, $ctx("ann", array(), $g1none)), "нет права — нет подписки");
expect(Ws_type_readable(700, $ctx("ann", array(), $g1read)), "подчинённая таблица — по праву на родительский тип");
expect(Ws_type_readable(700, $ctx("ann", array(650 => "READ"), $g1none)), "подчинённая таблица — по праву на свой реквизит-массив");
expect(!Ws_type_readable(700, $ctx("ann", array(), $g1none)), "подчинённая без прав на родителя — нет");
expect(!Ws_type_readable(0, $ctx("ann", array(), $g1read)) && !Ws_type_readable(-5, $ctx("ann", array(), $g1read)), "неположительный тип — нет");

# ── Проводка в index.php: настоящий logChange отдаёт изменения в Ws_collect ──
$src = file_get_contents(__DIR__."/../index.php");
define("LOG_IMPORT_ROWS", 16);
$GLOBALS["LOGGED"] = array();
function logWrite($mode, $rec){ $GLOBALS["LOGGED"][] = $rec; }
eval(extract_function_source($src, "logChange"));
reset_buf();
logChange(rec("insert", 10, 1, 500));
eq(array_column(ws_changes(), "id"), array(10), "logChange передаёт изменение в Ws_collect");
$GLOBALS["LOG_IMPORT"] = array("inserted" => 0, "updated" => 0, "deleted" => 0, "errors" => 0, "over" => FALSE, "rows" => array());
logChange(rec("insert", 11, 1, 500));
unset($GLOBALS["LOG_IMPORT"]);
eq(array_column(ws_changes(), "id"), array(10, 11), "и во время импорта");

function trace($msg){ }
eval(extract_function_source($src, "Report_tx_rollback"));
reset_buf();
$GLOBALS["REPORT_TX"] = 5;
Ws_collect(rec("insert", 10, 1, 500));
$GLOBALS["connection"] = NULL;
try{ Report_tx_rollback(); } catch(Throwable $e){ }   # mysqli_rollback без соединения
eq(count($GLOBALS["WS_BUF"]["changes"]), 0, "Report_tx_rollback сбрасывает события транзакции");

echo $failures ? "\nFAILED: $failures\n" : "\nOK\n";
exit($failures ? 1 : 0);
