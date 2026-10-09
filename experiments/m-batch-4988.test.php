<?php
# Мерка к issue #4988: создание и удаление записей в пакете (_m_batch) и ссылка :id на
# запись, созданную раньше в том же пакете.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/m-batch-4988.test.php
#
# Что здесь проверяется.
#   1. Часть «chain»: оркестровка пакета. Обработчики одиночных команд подменены, ApplyMBatch
#      и ApplyOp берутся ИЗ ЯДРА. :id — запись последней операции new, :idN — запись операции
#      с номером N. Ссылка на упавшую или отсутствующую операцию new — ошибка СВОЕЙ операции:
#      выполнить её с пустым id значило бы прицепить подчинённую запись неизвестно куда.
#   2. Часть «new»: настоящий обработчик _m_new (ApplyMNew из ядра) поверх заглушек БД.
#      Подчинённая запись встаёт под только что созданную, отказ проверки типа внутри пакета
#      остаётся ошибкой одной операции, а не обрывает весь запрос.
#
# Обращений к БД нет. Части гоняются разными процессами: в первой ApplyMNew — заглушка, во
# второй — код ядра, а в одном процессе их не объявить дважды.

namespace Test4988;

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
# Экстрактор — тот же, что в experiments/m-batch-4981.test.php.
function core_eval($src, $names){
    $code = "";
    foreach($names as $name)
        $code .= core_function($src, $name);
    eval("namespace Test4988;\n".$code);
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
    # exit(1), а не die("текст"): die со строкой выходит с кодом 0.
    fwrite(STDERR, "В ядре не найдена функция $name — мерка потеряла предмет\n");
    exit(1);
}

$coreSrc = file_get_contents(__DIR__."/../index.php");
$part = isset($argv[1]) ? $argv[1] : "";

if($part === ""){
    $bad = 0;
    foreach(array("chain", "new") as $one){
        echo "── часть: $one ──\n";
        passthru(escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." ".$one, $code);
        if($code !== 0)
            $bad++;
    }
    echo $bad ? "\nПРОВАЛЕНО частей: $bad\n" : "\nm-batch-4988: обе части пройдены\n";
    exit($bad ? 1 : 0);
}

function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function trace($msg){}
class IntegramOpError extends \Exception {}
define("BATCH_OPS_LIMIT", 1000);
function isApi(){ return TRUE; }
function api_dump($json, $name = "api.json"){
    $GLOBALS["DUMP"] = $json;
    throw new \Exception("api_dump");
}
function Insert_batch($up, $ord, $t, $val, $message, $multi = 0){}

function run($ops){
    $GLOBALS["CALLS"] = array();
    $GLOBALS["a"] = "_m_batch";
    $GLOBALS["arg"] = "";
    return ApplyMBatch(json_encode($ops));
}

# ══════════════════════════════════════════════════════════════════════════════════════════
if($part === "chain"){

    # Заглушки обработчиков: каждая новая запись получает следующий номер с 1000.
    function ApplyMNew($id, $up, $files){
        $GLOBALS["CALLS"][] = array("op" => "new", "id" => $id, "up" => $up, "request" => $_REQUEST);
        if(isset($_REQUEST["boom"]))
            my_die("Проверка типа неуспешна");
        if(isset($_REQUEST["escalate"]))
            $GLOBALS["GRANTS"][900] = "WRITE";    # так _m_new открывает реквизит со значением по умолчанию
        if(isset($_REQUEST["dup"])){
            return array("rec" => 77, "id" => 77, "json" => "", "warning" => "Запись уже существует");
        }
        $rec = ++$GLOBALS["NEXT_ID"];
        return array("rec" => $rec, "id" => $rec, "json" => "");
    }
    function ApplyMDel($id){
        $GLOBALS["CALLS"][] = array("op" => "del", "id" => $id);
        if($id == 666)
            my_die("Нельзя удалить объект, на который существуют ссылки");
        return 18;
    }
    function ApplyMSave($id, $req, $files){
        $GLOBALS["CALLS"][] = array("op" => "save", "id" => $id, "fields" => $req);
        return $id;
    }
    function ApplyMSet($id, $req, $files){
        $GLOBALS["CALLS"][] = array("op" => "set", "id" => $id, "fields" => $req);
        if(isset($GLOBALS["GRANTS"][900]))
            $GLOBALS["SAW_GRANT"] = TRUE;
        return $id;
    }

    core_eval($coreSrc, array("my_die", "InBatchOp", "OpFail", "Reset_Reqs_Cache", "ApplyOp", "BatchRefs", "ApplyMBatch"));
    $GLOBALS["NEXT_ID"] = 1000;

    # ── цепочка вглубь: запись → подчинённая → её подчинённая ─────────────────────────────
    $r = run(array(
        array("op" => "new", "id" => 18,  "up" => 1,     "fields" => array("t18" => "Заказ")),
        array("op" => "new", "id" => 300, "up" => ":id", "fields" => array("t300" => "Позиция")),
        array("op" => "new", "id" => 400, "up" => ":id", "fields" => array("t400" => "1")),
        array("op" => "set", "id" => ":id",              "fields" => array("t401" => "5")),
    ));
    ok($r["ok"] === 4 && $r["failed"] === 0, "цепочка из трёх уровней создана", shown($r));
    ok($GLOBALS["CALLS"][1]["up"] === 1001 && $GLOBALS["CALLS"][2]["up"] === 1002,
        ":id в up — запись предыдущей операции new", shown($GLOBALS["CALLS"]));
    ok($GLOBALS["CALLS"][3]["id"] === 1003, ":id в id правки — последняя созданная запись", shown($GLOBALS["CALLS"][3]));
    ok($r["results"][0]["id"] === 1001 && $r["results"][2]["id"] === 1003,
        "строка ответа new несёт id созданной записи", shown($r["results"]));
    ok($GLOBALS["CALLS"][0]["request"] === array("t18" => "Заказ"), "на время new \$_REQUEST равен её полям");

    # ── соседи под одним родителем: :idN ──────────────────────────────────────────────────
    $r = run(array(
        array("op" => "new", "id" => 18,  "up" => 1,      "fields" => array("t18" => "Заказ")),
        array("op" => "new", "id" => 300, "up" => ":id0", "fields" => array("t300" => "Позиция 1")),
        array("op" => "new", "id" => 300, "up" => ":id0", "fields" => array("t300" => "Позиция 2")),
        array("op" => "set", "id" => ":id1",              "fields" => array("t301" => ":id2")),
    ));
    ok($r["failed"] === 0, "соседи под одной записью созданы", shown($r));
    ok($GLOBALS["CALLS"][1]["up"] === 1004 && $GLOBALS["CALLS"][2]["up"] === 1004,
        ":id0 — запись операции 0 для обеих позиций", shown($GLOBALS["CALLS"]));
    ok($GLOBALS["CALLS"][3]["id"] === 1005 && $GLOBALS["CALLS"][3]["fields"] === array("t301" => "1006"),
        ":idN подставляется и в id, и в значение поля (ссылка)", shown($GLOBALS["CALLS"][3]));

    # ── упавшая new: ссылки на неё — ошибки своих операций ────────────────────────────────
    $r = run(array(
        array("op" => "new", "id" => 18,  "up" => 1,     "fields" => array("boom" => "1")),
        array("op" => "new", "id" => 300, "up" => ":id", "fields" => array("t300" => "Позиция")),
        array("op" => "set", "id" => 5,                  "fields" => array("t1" => "x")),
        array("op" => "set", "id" => ":id0",             "fields" => array("t1" => "y")),
    ));
    ok($r["ok"] === 1 && $r["failed"] === 3, "упала new и обе операции, ссылающиеся на неё", shown($r));
    ok(count($GLOBALS["CALLS"]) === 2 && $GLOBALS["CALLS"][1]["id"] === 5,
        "операции со ссылкой на упавшую new до обработчика не дошли", shown($GLOBALS["CALLS"]));
    ok(strpos($r["results"][1]["error"], ":id") !== FALSE && strpos($r["results"][1]["error"], "0") !== FALSE,
        "ошибка называет ссылку и упавшую операцию", shown($r["results"][1]));
    ok($r["results"][2]["ok"] === TRUE, "операция без ссылки выполнена как обычно");

    # ── :id без предшествующей new и :idN на не-new / на будущее ──────────────────────────
    $r = run(array(
        array("op" => "set", "id" => ":id",  "fields" => array("t1" => "x")),
        array("op" => "set", "id" => 7,      "fields" => array("t1" => "x")),
        array("op" => "set", "id" => ":id1", "fields" => array("t1" => "x")),
        array("op" => "set", "id" => ":id9", "fields" => array("t1" => "x")),
    ));
    ok($r["ok"] === 1 && $r["failed"] === 3, ":id без new, :idN на правку и на будущую операцию отклонены", shown($r));
    ok(count($GLOBALS["CALLS"]) === 1, "до обработчика дошла только операция без ссылки");

    # ── new без полей допустима, del удаляет и принимает :id ──────────────────────────────
    $r = run(array(
        array("op" => "new", "id" => 18, "up" => 1),
        array("op" => "del", "id" => ":id"),
        array("op" => "del", "id" => 666),
        array("op" => "del", "id" => 0),
    ));
    ok($r["ok"] === 2 && $r["failed"] === 2, "new без полей и del применены, негодные del отклонены", shown($r));
    ok($GLOBALS["CALLS"][1] === array("op" => "del", "id" => 1007), "del получил id созданной записи", shown($GLOBALS["CALLS"][1]));
    ok(strpos($r["results"][2]["error"], "ссылки") !== FALSE, "отказ удаления — ошибка своей операции", shown($r["results"][2]));
    ok(count($GLOBALS["CALLS"]) === 3, "del без id до обработчика не дошёл");

    # ── «запись уже существует»: :id ведёт на неё, предупреждение в строке ────────────────
    $r = run(array(
        array("op" => "new", "id" => 18, "up" => 1, "fields" => array("dup" => "1")),
        array("op" => "set", "id" => ":id", "fields" => array("t1" => "x")),
    ));
    ok($r["results"][0]["id"] === 77 && strpos($r["results"][0]["warnings"], "существует") !== FALSE,
        "существующая запись: её id и предупреждение", shown($r["results"][0]));
    ok($GLOBALS["CALLS"][1]["id"] === 77, ":id указывает на существующую запись");

    # ── права, открытые одной new, не достаются следующей операции ────────────────────────
    $GLOBALS["GRANTS"] = array(1 => "READ");
    unset($GLOBALS["SAW_GRANT"]);
    $r = run(array(
        array("op" => "new", "id" => 18, "up" => 1, "fields" => array("escalate" => "1")),
        array("op" => "set", "id" => 9, "fields" => array("t900" => "x")),
    ));
    ok(!isset($GLOBALS["SAW_GRANT"]) && $GLOBALS["GRANTS"] === array(1 => "READ"),
        "права после new восстановлены", shown($GLOBALS["GRANTS"]));

    # ── :id — только точное значение, текст с двоеточием не трогается ─────────────────────
    $r = run(array(
        array("op" => "new", "id" => 18, "up" => 1),
        array("op" => "set", "id" => 9, "fields" => array("t1" => "время :id и 12:00")),
    ));
    ok($GLOBALS["CALLS"][1]["fields"] === array("t1" => "время :id и 12:00"), "текст с :id внутри не изменён",
        shown($GLOBALS["CALLS"][1]));
    ok(InBatchOp() === FALSE, "после пакета режим операции снят");
}

# ══════════════════════════════════════════════════════════════════════════════════════════
if($part === "new"){

    define("PASSWORD", -1);
    define("UPLOAD_DIR", "/tmp/nowhere");

    class FakeResult {
        public $rows;
        public $i = 0;
        function __construct($rows){ $this->rows = $rows; }
    }
    # Типы: 18 — независимая таблица без реквизитов, 300 — подчинённая без реквизитов.
    # Тип 999 не существует. Родитель найден, если он создан в этом прогоне.
    function Exec_sql($sql, $err_msg, $log = TRUE, $fatal = TRUE){
        if($err_msg === "Check Obj type&reqs"){
            if(preg_match('/WHERE obj\.id=(\d+) AND obj\.up=0/', $sql, $m) && in_array((int)$m[1], array(18, 300)))
                return new FakeResult(array(array("t" => 3, "ord" => 0, "id" => "", "reqt" => NULL, "val" => NULL, "base" => NULL)));
            return new FakeResult(array());
        }
        if($err_msg === "Check the object "){
            preg_match('/WHERE id=(\d+)/', $sql, $m);
            return new FakeResult(isset($GLOBALS["ROWS"][(int)$m[1]]) ? array(array(0 => 18)) : array());
        }
        return new FakeResult(array());
    }
    function mysqli_fetch_array($res){
        if(!($res instanceof FakeResult))
            return FALSE;
        return isset($res->rows[$res->i]) ? $res->rows[$res->i++] : FALSE;
    }
    function mysqli_fetch_assoc($res){ return mysqli_fetch_array($res); }
    function Insert($up, $ord, $t, $val, $msg){
        $id = ++$GLOBALS["NEXT_ID"];
        $GLOBALS["ROWS"][$id] = array("up" => $up, "t" => $t, "val" => $val);
        return $id;
    }
    function Check_Grant($id, $t = 0, $grant = "WRITE", $fatal = TRUE){ return TRUE; }
    function Grant_1level($id){ return "WRITE"; }
    function Calc_Order($up, $t){ return 1; }
    function BuiltIn($v){ return $v; }
    function Format_Val($t, $v){ return $v; }
    function Format_Val_View($t, $v){ return $v; }
    function UniqueKeyReqs($id){ return array(); }
    function FindUniqueRecordDuplicateFromRequest($id, $rec, $up, $val, $req, $unique){ return FALSE; }
    function FieldAttrsHasMulti($attrs){ return FALSE; }
    function FieldAttrsDefaultValue($attrs){ return ""; }
    function CheckRepColGranted($v){}
    function Get_Current_Values($i, $t){}
    function ApplyMSave($id, $req, $files){ return $id; }
    function ApplyMSet($id, $req, $files){ return $id; }
    function ApplyMDel($id){ return 0; }

    core_eval($coreSrc, array("my_die", "InBatchOp", "OpFail", "Reset_Reqs_Cache", "ApplyOp", "BatchRefs", "ApplyMBatch", "ApplyMNew"));
    $GLOBALS["z"] = "testdb";
    $GLOBALS["basics"] = array(3 => "SHORT");
    $GLOBALS["REV_BT"] = array(3 => "SHORT");
    $GLOBALS["NEXT_ID"] = 5000;
    $GLOBALS["ROWS"] = array();

    $r = run(array(
        array("op" => "new", "id" => 18,  "up" => 1,     "fields" => array("t18" => "Заказ")),
        array("op" => "new", "id" => 300, "up" => ":id", "fields" => array("t300" => "Позиция")),
        array("op" => "new", "id" => 999, "up" => 1,     "fields" => array("t999" => "x")),
        array("op" => "new", "id" => 300, "up" => ":id0", "fields" => array("t300" => "Позиция 2")),
    ));
    ok($r["ok"] === 3 && $r["failed"] === 1, "три записи созданы, неизвестный тип отклонён", shown($r));
    ok(isset($GLOBALS["ROWS"][5001]) && $GLOBALS["ROWS"][5001]["up"] === 1 && $GLOBALS["ROWS"][5001]["val"] === "Заказ",
        "запись верхнего уровня создана", shown($GLOBALS["ROWS"]));
    ok(isset($GLOBALS["ROWS"][5002]) && $GLOBALS["ROWS"][5002]["up"] === 5001 && $GLOBALS["ROWS"][5002]["t"] === 300,
        "подчинённая запись встала под созданную", shown($GLOBALS["ROWS"]));
    ok(isset($GLOBALS["ROWS"][5003]) && $GLOBALS["ROWS"][5003]["up"] === 5001,
        "вторая позиция — под ту же запись", shown($GLOBALS["ROWS"]));
    ok($r["results"][1]["id"] === 5002, "ответ new несёт id созданной записи", shown($r["results"][1]));
    ok($r["results"][2]["ok"] === FALSE && strpos($r["results"][2]["error"], "Проверка типа") !== FALSE,
        "отказ проверки типа — ошибка операции, а не обрыв запроса", shown($r["results"][2]));
}

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nчасть «{$part}»: все проверки пройдены\n";
exit($failed ? 1 : 0);
