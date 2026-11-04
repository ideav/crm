<?php
# Web-socket ядра (issue #5269), сторона PHP. Описание — docs/kb/realtime.md.
#
# Ядро не держит соединений: их держит демон ws-server/ (Node). Ядро только сообщает ему,
# что изменилось:
#   1. logChange (журнал изменений) отдаёт каждую записанную строку в Ws_collect — в буфер
#      запроса попадает адрес строки (операция, id, родитель, тип), без значений;
#   2. после ответа (shutdown) Ws_flush достраивает каждой строке цепочку типов — тип строки,
#      тип её объекта, тип родителя … до объекта первого уровня — и шлёт пачку событий одним
#      POST на WS_PUSH_URL с подписью HMAC-SHA256 (WS_SECRET) в заголовке X-Ws-Signature;
#   3. демон отдаёт событие тем, кто подписан на любой тип из цепочки (подписка проверена
#      ядром: действие ws_auth и Ws_type_readable).
# Клиент по событию перечитывает данные обычным API — со всеми проверками прав и масок,
# поэтому значения в событие не попадают.
#
# Без WS_PUSH_URL или WS_SECRET (include/connection.php, INTEGRAM_WS_*) модуль ничего не делает.

if(!defined("WS_MAX_CHANGES"))
    define("WS_MAX_CHANGES", 500);     # строк в пачке; больше — одно событие «перечитать всё»
if(!defined("WS_PUSH_TIMEOUT_MS"))
    define("WS_PUSH_TIMEOUT_MS", 500); # демон на этом же сервере; лежит — ответ не ждёт

function Ws_enabled(){
    return defined("WS_PUSH_URL") && strlen(WS_PUSH_URL) && defined("WS_SECRET") && strlen(WS_SECRET);
}
# Строки авторизации (токены, xsrf, отметки активности) пишутся на каждом входе — не события
function Ws_skip_type($t){
    foreach(array("TOKEN", "XSRF", "ACTIVITY", "PASSWORD", "SECRET") as $c)
        if(defined($c) && ((int)$t === (int)constant($c)))
            return TRUE;
    return FALSE;
}
function &Ws_buf(){
    if(!isset($GLOBALS["WS_BUF"]))
        $GLOBALS["WS_BUF"] = array("changes" => array(), "bulk" => FALSE, "notify" => array(), "scheduled" => FALSE);
    return $GLOBALS["WS_BUF"];
}
# Отправка — после ответа. Функция, добавленная во время shutdown, тоже выполнится, поэтому
# записи триггеров (BtRunDeferred) уходят следующей пачкой.
function Ws_schedule(){
    $buf = &Ws_buf();
    if($buf["scheduled"])
        return;
    $buf["scheduled"] = TRUE;
    register_shutdown_function("Ws_flush");
}
# Строка журнала изменений (logChange) → буфер запроса. Значения не копируются: событие —
# только адрес строки. Сырой SQL, DDL и сводка импорта адреса строк не дают — это «массовое»
# изменение, по нему клиенты перечитывают всё.
function Ws_collect($rec){
    if(!Ws_enabled() || isset($rec["err"]))
        return;
    $op = isset($rec["op"]) ? $rec["op"] : "";
    $buf = &Ws_buf();
    $tx = isset($GLOBALS["REPORT_TX"]);
    if(in_array($op, array("insert", "update", "delete"), TRUE) && isset($rec["id"])){
        if(Ws_skip_type(isset($rec["t"]) ? $rec["t"] : 0))
            return;
        if(count($buf["changes"]) >= WS_MAX_CHANGES)
            $buf[$tx ? "bulk_tx" : "bulk"] = TRUE;
        else{
            $c = array("op" => $op, "id" => (int)$rec["id"], "up" => (int)$rec["up"], "t" => (int)$rec["t"]);
            if(isset($rec["old_up"]))
                $c["old_up"] = (int)$rec["old_up"];
            if($tx)
                $c["tx"] = TRUE;
            $buf["changes"][] = $c;
        }
    }
    elseif(in_array($op, array("sql", "ddl", "import"), TRUE))
        $buf[$tx ? "bulk_tx" : "bulk"] = TRUE;
    else
        return;
    Ws_schedule();
}
# Конец транзакции запроса (Report_tx_commit / Report_tx_rollback): зафиксированные
# изменения остаются в буфере, откаченные — выбрасываются.
function Ws_tx_end($commit){
    if(!isset($GLOBALS["WS_BUF"]))
        return;
    $buf = &Ws_buf();
    $keep = array();
    foreach($buf["changes"] as $c){
        if(!isset($c["tx"]))
            $keep[] = $c;
        elseif($commit){
            unset($c["tx"]);
            $keep[] = $c;
        }
    }
    $buf["changes"] = $keep;
    if($commit && !empty($buf["bulk_tx"]))
        $buf["bulk"] = TRUE;
    unset($buf["bulk_tx"]);
}
# Уведомление пользователям базы (логины), уходит вместе с пачкой событий запроса
function Ws_notify($to, $data){
    if(!is_array($to))
        $to = explode(",", (string)$to);
    $list = array();
    foreach($to as $login){
        $login = mb_strtolower(trim((string)$login), "UTF-8");
        if(strlen($login))
            $list[$login] = TRUE;
    }
    if(!Ws_enabled() || !count($list))
        return FALSE;
    $from = isset($GLOBALS["GLOBAL_VARS"]["user"]) ? (string)$GLOBALS["GLOBAL_VARS"]["user"] : "";
    $buf = &Ws_buf();
    $buf["notify"][] = array("to" => array_keys($list), "from" => $from, "data" => $data);
    Ws_schedule();
    return TRUE;
}
# Изменения → события. $lookup(ids) → array(id => array("up" => …, "t" => …)) — строки базы.
# Родители читаются пачкой на уровень; адреса строк этой же пачки (удалённый вместе со
# значениями объект) берутся из неё самой. Событие данных получает цепочку типов "types":
# тип строки и типы её предков до объекта первого уровня (up=1), при переносе — и старого
# места. Строка метаданных (тип up=0 или определение его реквизита) — событие схемы типа.
# Строка, адрес которой не установить, не рассылается.
function Ws_resolve($changes, $lookup){
    $nodes = array();
    foreach($changes as $c)
        $nodes[$c["id"]] = array("up" => $c["up"], "t" => $c["t"]);
    for($round = 0; $round < 16; $round++){
        $missing = array();
        foreach($changes as $c)
            foreach(array("up", "old_up") as $k){
                $p = isset($c[$k]) ? (int)$c[$k] : 0;
                for($d = 0; ($p > 1) && ($d < 16); $d++){
                    if(!isset($nodes[$p])){
                        $missing[$p] = TRUE;
                        break;
                    }
                    if(($nodes[$p] === FALSE) || ((int)$nodes[$p]["up"] === 0))
                        break;
                    $p = (int)$nodes[$p]["up"];
                }
            }
        if(!count($missing))
            break;
        $found = call_user_func($lookup, array_keys($missing));
        foreach(array_keys($missing) as $id)
            $nodes[$id] = isset($found[$id]) ? array("up" => (int)$found[$id]["up"], "t" => (int)$found[$id]["t"]) : FALSE;
    }
    $events = array();
    $schema = array();
    foreach($changes as $c){
        if($c["up"] === 0){
            $schema[$c["id"]] = TRUE;
            continue;
        }
        $types = array($c["t"]);
        $ok = TRUE;
        $meta = 0;
        foreach(array("up", "old_up") as $k){
            $p = isset($c[$k]) ? (int)$c[$k] : 0;
            for($d = 0; ($p > 1) && ($d < 16); $d++){
                $n = isset($nodes[$p]) ? $nodes[$p] : FALSE;
                if($n === FALSE){
                    if($k === "up")
                        $ok = FALSE;
                    break;
                }
                if((int)$n["up"] === 0){
                    $meta = $p;
                    break;
                }
                $types[] = (int)$n["t"];
                $p = (int)$n["up"];
            }
            if($meta || !$ok)
                break;
        }
        if($meta)
            $schema[$meta] = TRUE;
        elseif($ok)
            $events[$c["id"]] = array("k" => "change", "op" => $c["op"], "id" => $c["id"], "up" => $c["up"]
                                    , "t" => $c["t"], "types" => array_values(array_unique($types)));
    }
    $out = array_values($events);
    foreach(array_keys($schema) as $t)
        $out[] = array("k" => "schema", "t" => (int)$t);
    return $out;
}
function Ws_sign($body, $secret){
    return hash_hmac("sha256", $body, (string)$secret);
}
# Родители строк из базы ядра — для Ws_resolve
function Ws_lookup_db($ids){
    $ids = array_filter(array_map("intval", $ids));
    if(!count($ids) || !function_exists("Exec_sql") || !isset($GLOBALS["z"]))
        return array();
    $res = Exec_sql("SELECT id, up, t FROM ".$GLOBALS["z"]." WHERE id IN (".implode(",", $ids).")", "WS: parents", FALSE, FALSE);
    $out = array();
    if(is_object($res))
        while($row = mysqli_fetch_assoc($res))
            $out[(int)$row["id"]] = array("up" => (int)$row["up"], "t" => (int)$row["t"]);
    return $out;
}
# POST демону. Короткие таймауты: демон на этом же сервере, лежит — запрос не ждёт.
function Ws_post($url, $body, $sig){
    if(!function_exists("curl_init"))
        return FALSE;
    $ch = curl_init($url);
    curl_setopt_array($ch, array(CURLOPT_POST => TRUE, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => TRUE
        , CURLOPT_NOSIGNAL => TRUE, CURLOPT_CONNECTTIMEOUT_MS => WS_PUSH_TIMEOUT_MS, CURLOPT_TIMEOUT_MS => WS_PUSH_TIMEOUT_MS
        , CURLOPT_HTTPHEADER => array("Content-Type: application/json", "X-Ws-Signature: ".$sig)));
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($code >= 200) && ($code < 300);
}
# Отправка буфера запроса (shutdown). Изменения транзакции запроса, не дошедшей до
# Ws_tx_end(TRUE) после COMMIT, откатятся с закрытием соединения — они не рассылаются.
function Ws_flush($send = NULL, $lookup = NULL){
    if(!isset($GLOBALS["WS_BUF"]))
        return FALSE;
    Ws_tx_end(FALSE);
    $buf = &Ws_buf();
    $changes = $buf["changes"];
    $bulk = $buf["bulk"];
    $notify = $buf["notify"];
    $buf["changes"] = array();
    $buf["bulk"] = FALSE;
    $buf["notify"] = array();
    $buf["scheduled"] = FALSE;
    if(!Ws_enabled() || (!count($changes) && !$bulk && !count($notify)))
        return FALSE;
    try{
        $events = count($changes) ? Ws_resolve($changes, $lookup ? $lookup : "Ws_lookup_db") : array();
        if(!count($events) && !$bulk && !count($notify))
            return FALSE;
        $body = json_encode(array("db" => isset($GLOBALS["z"]) ? (string)$GLOBALS["z"] : ""
                , "by" => isset($GLOBALS["GLOBAL_VARS"]["user"]) ? (string)$GLOBALS["GLOBAL_VARS"]["user"] : ""
                , "bulk" => $bulk, "events" => $events, "notify" => $notify)
            , JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        $sig = Ws_sign($body, defined("WS_SECRET") ? WS_SECRET : "");
        return call_user_func($send ? $send : "Ws_post", WS_PUSH_URL, $body, $sig);
    }
    catch(Throwable $e){
        if(function_exists("wlog"))
            wlog("[ws] ".$e->getMessage(), "log");
        return FALSE;
    }
}
# Может ли пользователь подписаться на таблицу (тип) $t — читать её записи.
# $ctx: user, grants ($GLOBALS["GRANTS"]), arr(t) → array("id","up") строки-массива, которой
# тип $t подчинён родительскому типу (или NULL — тип первого уровня), grant1(t) → Grant_1level.
# Явное право на тип или на его строку-массив решает сразу; иначе подчинённая таблица
# наследует право родительского типа, таблица первого уровня — по правилу Grant_1level.
function Ws_type_readable($t, $ctx){
    $t = (int)$t;
    if($t <= 0)
        return FALSE;
    if($ctx["user"] === "admin")
        return TRUE;
    $g = is_array($ctx["grants"]) ? $ctx["grants"] : array();
    $read = function($v){ return ($v === "READ") || ($v === "WRITE"); };
    for($d = 0; $d < 16; $d++){
        if(isset($g[$t]))
            return $read($g[$t]);
        $arr = call_user_func($ctx["arr"], $t);
        if(!$arr)
            return $read(call_user_func($ctx["grant1"], $t));
        if(isset($g[(int)$arr["id"]]))
            return $read($g[(int)$arr["id"]]);
        $t = (int)$arr["up"];
    }
    return FALSE;
}
# Контекст Ws_type_readable для текущего пользователя ядра (после Validate_Token)
function Ws_core_ctx(){
    return array("user" => isset($GLOBALS["GLOBAL_VARS"]["user"]) ? $GLOBALS["GLOBAL_VARS"]["user"] : ""
        , "grants" => isset($GLOBALS["GRANTS"]) ? $GLOBALS["GRANTS"] : array()
        , "arr" => function($t){
            $res = Exec_sql("SELECT arr.id, arr.up FROM ".$GLOBALS["z"]." arr JOIN ".$GLOBALS["z"]." par ON par.id=arr.up AND par.up=0"
                            ." WHERE arr.t=".(int)$t." AND arr.id!=arr.t LIMIT 1", "WS: array of type", FALSE);
            $row = mysqli_fetch_assoc($res);
            return $row ? array("id" => (int)$row["id"], "up" => (int)$row["up"]) : NULL;
        }
        , "grant1" => "Grant_1level");
}
