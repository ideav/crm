<?php
# Мерка к issue #4981: пакетная запись (_m_batch) и правка первой колонки через _m_set.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/m-batch-4981.test.php
#
# Что здесь проверяется.
#   1. Пакет выполняется обработчиками одиночных команд, а не их копией, поэтому мерка
#      берёт ApplyMBatch/ApplyOp/ApplyMSet ИЗ ЯДРА токенайзером и подаёт им заглушки.
#   2. Главное свойство пакета: транзакций в платформе нет, откатывать нечем — значит
#      ошибка одной операции (в том числе my_die из проверки прав глубоко внутри) не
#      должна ни отменять уже применённые операции, ни прекращать оставшиеся.
#   3. _m_set по первой колонке (t{tableId}) сохраняет главное значение тем же
#      обработчиком, что и _m_save. Раньше JOIN не находил реквизита с таким id, ветка
#      не срабатывала, и запрос отвечал 200 с "id":"" — молча теряя данные.
#
# Обращений к БД нет: Exec_sql и mysqli_fetch_array подменены, данные подаёт заглушка.
# Части гоняются разными процессами: в первой ApplyMSave/ApplyMSet — заглушки, во второй
# ApplyMSet берётся из ядра, а в одном процессе их не объявить дважды.

namespace Test4981;

error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
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
function shown($v){ return str_replace("\n", " ", var_export($v, TRUE)); }

# ── Код берём ИЗ ЯДРА ──────────────────────────────────────────────────────────────────────
# Копировать тела в мерку нельзя: она сторожила бы копию. Границы функции ищем токенайзером,
# а не счётом скобок (в телах есть строки со скобками). Экстрактор — тот же, что в
# experiments/dir-admin-template-4624.test.php.
# eval() начинает в глобальном пространстве имён, а заглушки живут в Test4981 (иначе не
# подменить mysqli_fetch_array) — поэтому объявление пространства едет вместе с кодом.
function core_eval($src, $names){
    $code = "";
    foreach($names as $name)
        $code .= core_function($src, $name);
    eval("namespace Test4981;\n".$code);
}
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
    # Именно exit(1), а не die("текст"): die со строкой выходит с кодом 0, и обёртка гейта
    # засчитала бы потерю предмета как успех.
    fwrite(STDERR, "В ядре не найдена функция $name — мерка потеряла предмет\n");
    exit(1);
}

$coreSrc = file_get_contents(__DIR__."/../index.php");
$part = isset($argv[1]) ? $argv[1] : "";

# Без аргумента мерка перезапускает себя по части на процесс.
if($part === ""){
    $bad = 0;
    foreach(array("batch", "firstcol") as $one){
        echo "── часть: $one ──\n";
        passthru(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." ".$one, $code);
        if($code !== 0)
            $bad++;
    }
    echo $bad ? "\nПРОВАЛЕНО частей: $bad\n" : "\nm-batch-4981: обе части пройдены\n";
    exit($bad ? 1 : 0);
}

# Общее окружение обеих частей.
function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function trace($msg){}

# ══════════════════════════════════════════════════════════════════════════════════════════
if($part === "batch"){

    class IntegramOpError extends \Exception {}

    # Предел берём из ядра, чтобы мерка не разошлась с ним при правке.
    if(!preg_match('/define\("BATCH_OPS_LIMIT",\s*(\d+)\)/', $coreSrc, $m)){
        fwrite(STDERR, "В ядре не найден BATCH_OPS_LIMIT — мерка потеряла предмет\n");
        exit(1);
    }
    define("BATCH_OPS_LIMIT", (int)$m[1]);

    function isApi(){ return TRUE; }
    function api_dump($json, $name = "api.json"){
        $GLOBALS["DUMP"] = $json;
        throw new \Exception("api_dump");     # настоящая функция завершает запрос
    }
    function Insert_batch($up, $ord, $t, $val, $message, $multi = 0){
        $GLOBALS["FLUSHED"][] = $message;
    }

    # Обработчики одиночных команд подменены: здесь проверяется оркестровка пакета,
    # а не запись в БД. Каждый вызов записывается вместе с тем, что видел $_REQUEST.
    function ApplyMSave($id, $req, $files){
        $GLOBALS["CALLS"][] = array("op" => "save", "id" => $id, "fields" => $req, "request" => $_REQUEST);
        if(isset($req["boom"]))
            my_die("нет доступа к реквизиту объекта");    # так падают проверки прав в ядре
        if(isset($req["leak"]))
            $GLOBALS["REF_typs"][777] = "подсмотренный тип";
        if(isset($req["warn"]))
            $GLOBALS["warning"] = "поле обязательно";
        return $id;
    }
    function ApplyMSet($id, $req, $files){
        $GLOBALS["CALLS"][] = array("op" => "set", "id" => $id, "fields" => $req, "request" => $_REQUEST);
        if(isset($req["leak"]) && isset($GLOBALS["REF_typs"][777]))
            $GLOBALS["SAW_LEAK"] = TRUE;
        return $id;
    }

    core_eval($coreSrc, array("my_die", "InBatchOp", "OpFail", "Reset_Reqs_Cache", "ApplyOp", "ApplyMBatch"));

    function run($ops){
        $GLOBALS["CALLS"] = array();
        $GLOBALS["FLUSHED"] = array();
        unset($GLOBALS["SAW_LEAK"], $GLOBALS["REF_typs"], $GLOBALS["warning"]);
        $GLOBALS["a"] = "_m_batch";
        $GLOBALS["arg"] = "";
        return ApplyMBatch(json_encode($ops));
    }

    # ── смешанный пакет доходит до конца ──────────────────────────────────────────────────
    $r = run(array(
        array("op" => "save", "id" => 101, "fields" => array("t1078" => "1790106240")),
        array("op" => "set",  "id" => 102, "fields" => array("t1085" => "12")),
        array("op" => "save", "id" => 103, "fields" => array("t1078" => "1790106900")),
    ));
    ok($r["ok"] === 3 && $r["failed"] === 0, "смешанный пакет: три операции применены", shown($r));
    ok(count($GLOBALS["CALLS"]) === 3, "каждая операция дошла до обработчика", shown(count($GLOBALS["CALLS"])));
    ok($GLOBALS["CALLS"][1]["op"] === "set" && $GLOBALS["CALLS"][1]["id"] === 102
        && $GLOBALS["CALLS"][1]["fields"] === array("t1085" => "12"), "set попал в свой обработчик с своими полями");
    ok($GLOBALS["CALLS"][0]["request"] === array("t1078" => "1790106240"),
        "на время операции \$_REQUEST равен её полям", shown($GLOBALS["CALLS"][0]["request"]));

    # ── ошибка операции не отменяет остальные ─────────────────────────────────────────────
    $r = run(array(
        array("op" => "save", "id" => 201, "fields" => array("t1078" => "1")),
        array("op" => "save", "id" => 202, "fields" => array("boom" => "1")),
        array("op" => "set",  "id" => 203, "fields" => array("t1085" => "3")),
    ));
    ok($r["ok"] === 2 && $r["failed"] === 1, "падение одной операции: остальные применены", shown($r));
    ok($r["results"][1]["ok"] === FALSE && strpos($r["results"][1]["error"], "нет доступа") !== FALSE,
        "ошибка операции попала в её строку ответа", shown($r["results"][1]));
    ok($r["results"][2]["ok"] === TRUE && count($GLOBALS["CALLS"]) === 3,
        "операция после упавшей всё равно выполнена");
    ok($r["results"][0]["id"] === 201 && $r["results"][2]["op"] === "set",
        "строки ответа привязаны к своим операциям");

    # ── кеш реквизитов не протекает между операциями ──────────────────────────────────────
    $r = run(array(
        array("op" => "save", "id" => 301, "fields" => array("leak" => "1")),
        array("op" => "set",  "id" => 302, "fields" => array("leak" => "1")),
    ));
    ok(!isset($GLOBALS["SAW_LEAK"]), "метаданные первой записи не видны второй операции");

    # ── предупреждения ────────────────────────────────────────────────────────────────────
    $r = run(array(
        array("op" => "save", "id" => 401, "fields" => array("warn" => "1")),
        array("op" => "save", "id" => 402, "fields" => array("t1078" => "1")),
    ));
    ok(isset($r["results"][0]["warnings"]) && strpos($r["results"][0]["warnings"], "обязательно") !== FALSE,
        "предупреждение операции попало в её строку", shown($r["results"][0]));
    ok(!isset($r["results"][1]["warnings"]), "предупреждение не протекло в следующую операцию");

    # ── разбор операций ───────────────────────────────────────────────────────────────────
    $r = run(array(
        array("op" => "delete", "id" => 501, "fields" => array("t1" => "1")),
        array("op" => "save",   "id" => 0,   "fields" => array("t1" => "1")),
        array("op" => "save",   "id" => 503, "fields" => array()),
        array("op" => "save",   "id" => 504, "fields" => array("copybtn" => "1")),
        array("op" => "save",   "id" => 505, "fields" => array("t1" => "1")),
    ));
    ok($r["failed"] === 4 && $r["ok"] === 1, "негодные операции отклонены поимённо, годная применена", shown($r["ok"]."/".$r["failed"]));
    ok(strpos($r["results"][0]["error"], "delete") !== FALSE, "неизвестная операция названа в ошибке", shown($r["results"][0]));
    ok(strpos($r["results"][3]["error"], "оп") !== FALSE || strpos($r["results"][3]["error"], "Копия") !== FALSE,
        "копия записи в пакете отклонена", shown($r["results"][3]));
    ok(count($GLOBALS["CALLS"]) === 1, "до обработчика дошла только годная операция");

    # ── флаг пакета снимается ─────────────────────────────────────────────────────────────
    # Иначе следующий my_die в том же процессе бросит исключение вместо ответа клиенту.
    ok(InBatchOp() === FALSE, "после пакета режим операции снят");
    ok(count($GLOBALS["FLUSHED"]) === 1, "отложенные вставки досылаются один раз за пакет");

    # ── негодный конверт: это ошибка запроса, а не операции ───────────────────────────────
    foreach(array("" => "пустое тело", "не json" => "мусор вместо JSON", "[]" => "пустой массив") as $payload => $name){
        $GLOBALS["DUMP"] = "";
        try{
            ApplyMBatch($payload);
            ok(FALSE, "$name отклонено");
        }
        catch(\Exception $e){
            ok(strpos($GLOBALS["DUMP"], "error") !== FALSE, "$name отклонено ответом об ошибке", shown($GLOBALS["DUMP"]));
        }
    }
    $GLOBALS["DUMP"] = "";
    $tooMany = array_fill(0, BATCH_OPS_LIMIT + 1, array("op" => "save", "id" => 1, "fields" => array("t1" => "1")));
    try{
        ApplyMBatch(json_encode($tooMany));
        ok(FALSE, "пакет сверх предела отклонён");
    }
    catch(\Exception $e){
        ok(strpos($GLOBALS["DUMP"], "error") !== FALSE, "пакет сверх предела отклонён", shown($GLOBALS["DUMP"]));
    }
    ok(InBatchOp() === FALSE, "после отказа по конверту режим операции не включён");
}

# ══════════════════════════════════════════════════════════════════════════════════════════
if($part === "firstcol"){

    define("PASSWORD", -1);          # в этой части пароли не встречаются
    define("UPLOAD_DIR", "/tmp/nowhere");

    class FakeResult {
        public $rows;
        public $i = 0;
        function __construct($rows){ $this->rows = $rows; }
    }

    # Заглушки БД. Настоящая ApplyMSet делает два разных запроса, различаем их по пояснению.
    function Exec_sql($sql, $err_msg, $log = TRUE, $fatal = TRUE){
        $GLOBALS["SQL"][] = $err_msg;
        if($err_msg === "Get Attr Type")
            return new FakeResult($GLOBALS["ATTR_ROWS"]);
        if($err_msg === "Get the Object's own Type")
            return new FakeResult($GLOBALS["OWN_TYPE"] === NULL ? array() : array(array("t" => $GLOBALS["OWN_TYPE"])));
        return new FakeResult(array());
    }
    function mysqli_fetch_array($res){
        if(!($res instanceof FakeResult))
            return FALSE;
        return isset($res->rows[$res->i]) ? $res->rows[$res->i++] : FALSE;
    }

    function Check_Grant($id, $t = 0, $grant = "WRITE", $fatal = TRUE){ $GLOBALS["GRANTED"][] = "$id/$t"; return TRUE; }
    function BuiltIn($v){ return $v; }
    function Format_Val($t, $v){ return $v; }
    function Update_Val($id, $val){ $GLOBALS["UPDATED"][] = array($id, $val); }
    function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["INSERTED"][] = array($up, $ord, $t, $val); return 555; }
    function Delete($id, $root = 0){ $GLOBALS["DELETED"][] = $id; }
    function checkDuplicatedReqs($id, $t){}
    function checkNewRef($val, $t, $fatal = TRUE){ return TRUE; }
    function GetRefOrd($obj, $t){ return 1; }
    function FieldAttrsHasMulti($attrs){ return FALSE; }
    function OpFail($msg){ throw new \Exception("OpFail: $msg"); }
    # Делегирование в обработчик _m_save записывается, но не исполняется: предмет этой
    # части — маршрут, а сам _m_save проверяется своими мерками.
    function ApplyOp($op, $rec_id, $fields){
        $GLOBALS["DELEGATED"][] = array("op" => $op, "id" => $rec_id, "fields" => $fields);
        return "";
    }

    core_eval($coreSrc, array("ApplyMSet"));

    $GLOBALS["z"] = "testdb";
    $GLOBALS["basics"] = array(7 => "STRING");
    $GLOBALS["REV_BT"] = array(7 => "STRING");

    function scene($attrRows, $ownType, $req){
        $GLOBALS["ATTR_ROWS"] = $attrRows;
        $GLOBALS["OWN_TYPE"] = $ownType;
        $GLOBALS["DELEGATED"] = array();
        $GLOBALS["UPDATED"] = array();
        $GLOBALS["INSERTED"] = array();
        $GLOBALS["SQL"] = array();
        $GLOBALS["GRANTED"] = array();
        return ApplyMSet(831921, $req, array());
    }

    # ── первая колонка: t{tableId} ────────────────────────────────────────────────────────
    # Реквизита с таким id нет (JOIN пуст) — это главное значение записи.
    $out = scene(array(), 1078, array("t1078" => "1790106240"));
    ok(count($GLOBALS["DELEGATED"]) === 1, "первая колонка ушла в обработчик _m_save", shown($GLOBALS["DELEGATED"]));
    ok($GLOBALS["DELEGATED"][0]["op"] === "save" && $GLOBALS["DELEGATED"][0]["id"] === 831921
        && $GLOBALS["DELEGATED"][0]["fields"] === array("t1078" => "1790106240"),
        "запись и значение переданы без изменений", shown($GLOBALS["DELEGATED"][0]));
    ok($out === 831921, "ответ несёт id записи, а не пустую строку", shown($out));
    ok(count($GLOBALS["UPDATED"]) === 0, "мимо _m_save главное значение не пишется");

    # ── обычный реквизит идёт прежним путём ───────────────────────────────────────────────
    $attr = array(array("ord" => 1, "id" => 900, "ref_val" => NULL, "val" => "старое", "t" => 7, "attrs" => ""));
    $out = scene($attr, 1078, array("t1085" => "новое"));
    ok($GLOBALS["UPDATED"] === array(array(900, "новое")), "реквизит обновлён как прежде", shown($GLOBALS["UPDATED"]));
    ok(count($GLOBALS["DELEGATED"]) === 0, "реквизит не уехал в обработчик первой колонки");
    ok(!in_array("Get the Object's own Type", $GLOBALS["SQL"]),
        "на обычном пути лишнего запроса за типом записи нет", shown($GLOBALS["SQL"]));

    # ── значение не изменилось — записи нет ───────────────────────────────────────────────
    scene($attr, 1078, array("t1085" => "старое"));
    ok(count($GLOBALS["UPDATED"]) === 0, "неизменившийся реквизит не переписывается");

    # ── ключ, который не реквизит и не тип записи ─────────────────────────────────────────
    $out = scene(array(), 1078, array("t9999" => "мимо"));
    ok(count($GLOBALS["DELEGATED"]) === 0 && count($GLOBALS["UPDATED"]) === 0,
        "посторонний ключ по-прежнему ничего не меняет", shown($GLOBALS["DELEGATED"]));

    # ── запись не найдена ─────────────────────────────────────────────────────────────────
    $out = scene(array(), NULL, array("t1078" => "1790106240"));
    ok(count($GLOBALS["DELEGATED"]) === 0, "для несуществующей записи ничего не сохраняется");
}

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nчасть «{$part}»: все проверки пройдены\n";
exit($failed ? 1 : 0);
