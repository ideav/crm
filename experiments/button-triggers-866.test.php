<?php
# Триггеры колонок-кнопок (python2node#866): CREATE / UPDATE / DELETE на сервере.
#
# Движок include/button_triggers.php проверяется со стаб-портом (база в памяти), связка с
# ядром — реальными функциями из index.php (извлекаются по имени, как в test-issue-3410-*)
# с заглушками БД и агента. Паритет формул с JS — по общим векторам
# experiments/button-formula-vectors.fixture.json (их же проверяет
# experiments/integram-table-866-button-triggers.test.js).
#
# Запуск: php experiments/button-triggers-866.test.php (php:8.2-cli)

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

require __DIR__."/../include/field_attrs.php";

# ── 1. Нормализатор: on / recompute / when / user ───────────────────────────
$n = FieldAttrsNormalizeAction('{"type":"formula","formula":"1","write":true,"on":"update, create","recompute":true,"when":" {A}=1 ","user":"17"}', $err);
eq($n, array("type" => "formula", "formula" => "1", "write" => true, "on" => array("CREATE", "UPDATE"), "when" => "{A}=1", "user" => 17), "normalizer: string on → canonical array, recompute dropped without READ, user id → int");
$n = FieldAttrsNormalizeAction(array("type" => "query", "query" => "Q", "on" => array("read"), "recompute" => 1, "user" => "petrov"), $err);
eq(array($n["on"], $n["recompute"], $n["user"]), array(array("READ"), true, "petrov"), "normalizer: READ keeps recompute, login kept for _d_action to resolve");
$n = FieldAttrsNormalizeAction(array("type" => "formula", "formula" => "{Цена}*2", "write" => true, "on" => array("PRESS"), "when" => " ", "user" => ""), $err);
eq(json_encode($n, JSON_UNESCAPED_UNICODE), '{"type":"formula","formula":"{Цена}*2","write":true}', "normalizer: defaults (PRESS, empty when/user) are omitted — old modifiers stay byte-identical");
eq(FieldAttrsNormalizeAction(array("type" => "formula", "formula" => "1", "on" => array("LATER")), $err), false, "normalizer: unknown event rejected");
expect(strpos($err, "LATER") !== false, "normalizer: the reason names the event");
eq(FieldAttrsNormalizeAction(array("type" => "link", "url" => "x", "on" => array("CREATE")), $err), false, "normalizer: a link runs on PRESS only");
eq(FieldAttrsNormalizeAction(array("type" => "query", "query" => "Q", "on" => array("CREATE", "DELETE"), "write" => true), $err)["on"], array("CREATE", "DELETE"), "normalizer: query on CREATE/DELETE is accepted (owner: trusted)");

if(!is_file(__DIR__."/../include/button_triggers.php")){
    echo "FAIL: include/button_triggers.php is missing\n\nFAILED: ".($failures + 1)."\n";
    exit(1);
}
require __DIR__."/../include/button_triggers.php";

# ── 2. Паритет формул с JS ──────────────────────────────────────────────────
$fx = json_decode(file_get_contents(__DIR__."/button-formula-vectors.fixture.json"), true);
$bad = array();
foreach($fx["vectors"] as $v){
    try { $got = array("result" => BtFormulaFormat(BtFormulaEval($v["formula"], $fx["ctx"]))); }
    catch(Exception $e){ $got = array("error" => $e->getMessage()); }
    $want = isset($v["error"]) ? array("error" => $v["error"]) : array("result" => $v["result"]);
    if($got !== $want)
        $bad[] = $v["formula"]." → ".json_encode($got, JSON_UNESCAPED_UNICODE)." ≠ ".json_encode($want, JSON_UNESCAPED_UNICODE);
}
expect(count($fx["vectors"]) > 100 && !count($bad), "formula parity: ".count($fx["vectors"])." shared vectors".(count($bad) ? "\n  ".implode("\n  ", $bad) : ""));
eq(BtSubstitute("report/5?FR_A=[VAL]&x={Нет}&k={цена}", $fx["ctx"], "BtEncodeUriComponent"), "report/5?FR_A=".rawurlencode("Заказ 7")."&x={Нет}&k=".rawurlencode("1 250,5"), "substitute: same as JS");
eq(BtCleanAnswer("  ```text\nСтул за 100\n```  "), "Стул за 100", "cleanAnswer: lone fence unwrapped");

# ── 3. Стаб-порт: таблица «Заказ» (500) в памяти ─────────────────────────────
function act($a){ return json_encode(array("action" => $a), JSON_UNESCAPED_UNICODE); }
function world($buttons){
    $cols = array(
        array("id" => 502, "name" => "Цена", "base" => "SHORT", "ref" => false, "attrs" => ""),
        array("id" => 503, "name" => "Кол", "base" => "SHORT", "ref" => false, "attrs" => ""),
    );
    foreach($buttons as $id => $b)
        $cols[] = array("id" => $id, "name" => $b[0], "base" => "BUTTON", "ref" => false, "attrs" => act($b[1]));
    $GLOBALS["W"] = array(
        "meta" => array(500 => array("id" => 500, "name" => "Заказ", "base" => "SHORT", "cols" => $cols)),
        "recs" => array(), "writes" => array(), "queue" => array(), "warn" => array(), "log" => array(),
        "queries" => array(), "prompts" => array(), "gate" => "", "onQuery" => null, "writeFail" => array(),
        "users" => array(17 => array("user" => "petrov", "user_id" => 17)), "current" => "ivanov"
    );
    $GLOBALS["BT_GONE"] = array();
}
function rec($id, $values, $val="Заказ"){ $GLOBALS["W"]["recs"][$id] = array("id" => $id, "type" => 500, "val" => $val, "values" => $values); return $GLOBALS["W"]["recs"][$id]; }
function port(){
    return array(
        "meta" => function($t){ return isset($GLOBALS["W"]["meta"][$t]) ? $GLOBALS["W"]["meta"][$t] : null; },
        "record" => function($id){ return isset($GLOBALS["W"]["recs"][$id]) ? $GLOBALS["W"]["recs"][$id] : null; },
        "write" => function($rec, $col, $value, $runAs, $asAi, $chain){
            if(isset($GLOBALS["W"]["writeFail"][$col]))
                throw new Exception($GLOBALS["W"]["writeFail"][$col]);
            $who = ($runAs ? $runAs["user"] : $GLOBALS["W"]["current"]).($asAi ? "~ai" : "");
            $GLOBALS["W"]["writes"][] = array($rec, $col, $value, $who);
            $GLOBALS["W"]["recs"][$rec]["values"][$col] = $value;
        },
        "query" => function($name, $params, $runAs, $chain){
            $GLOBALS["W"]["queries"][] = array($name, $params, $runAs ? $runAs["user"] : $GLOBALS["W"]["current"], $chain);
            if($GLOBALS["W"]["onQuery"]) return call_user_func($GLOBALS["W"]["onQuery"], $name, $params, $chain);
            return array(array("v" => "17"));
        },
        "prompt" => function($job){ $GLOBALS["W"]["prompts"][] = $job; return array("job" => "j".count($GLOBALS["W"]["prompts"])); },
        "promptGate" => function($key){ return $GLOBALS["W"]["gate"]; },
        "user" => function($ref){
            if(isset($GLOBALS["W"]["users"][$ref])) return $GLOBALS["W"]["users"][$ref];
            throw new Exception("пользователь «".$ref."» не найден — действие не выполнено");
        },
        "defer" => function($key, $fn){ $GLOBALS["W"]["queue"][$key] = $fn; },
        "warn" => function($m){ $GLOBALS["W"]["warn"][] = $m; },
        "log" => function($m){ $GLOBALS["W"]["log"][] = $m; },
    );
}
# То, что делает BtRunDeferred после ответа: очередь по порядку, сбой одного — в журнал
function flush_queue(){
    while(count($GLOBALS["W"]["queue"])){
        reset($GLOBALS["W"]["queue"]);
        $k = key($GLOBALS["W"]["queue"]);
        $fn = $GLOBALS["W"]["queue"][$k];
        unset($GLOBALS["W"]["queue"][$k]);
        try { $fn(); } catch(Throwable $e){ $GLOBALS["W"]["log"][] = "$k: ".$e->getMessage(); }
    }
}
function writes(){ return array_map(function($w){ return $w[0].":".$w[1]."=".$w[2]."@".$w[3]; }, $GLOBALS["W"]["writes"]); }

# 3.1 Выбор триггеров и правило UPDATE
world(array(
    510 => array("Сумма", array("type" => "formula", "formula" => "{Цена}*{Кол}", "write" => true, "on" => array("CREATE", "UPDATE"))),
    511 => array("Описание", array("type" => "prompt", "prompt" => "Опиши заказ на {Сумма}", "write" => true, "on" => array("CREATE"))),
    512 => array("Скидка", array("type" => "formula", "formula" => "{Сумма}/10", "write" => true, "on" => array("UPDATE"))),
    513 => array("Кнопка", array("type" => "formula", "formula" => "1", "write" => true)),
    514 => array("Метка", array("type" => "formula", "formula" => "[ID]", "write" => true, "on" => array("UPDATE"))),
));
$meta = $W["meta"][500];
eq(array_map(function($c){ return $c["id"]; }, BtTriggerColumns($meta, "CREATE")), array(510, 511), "selection: CREATE columns in column order, PRESS-only column excluded");
eq(array_map(function($c){ return $c["id"]; }, BtTriggerColumns($meta, "PRESS")), array(513), "selection: missing on means PRESS");
$a510 = BtColumnAction($meta["cols"][2]);
expect(BtUpdateFires($a510, 510, array(502), $meta), "UPDATE: change of a referenced column ({Цена}) fires");
expect(!BtUpdateFires($a510, 510, array(511), $meta), "UPDATE: change of an unreferenced column does not fire");
$a514 = BtColumnAction($meta["cols"][6]);
expect(BtUpdateFires($a514, 514, array(502), $meta) && !BtUpdateFires($a514, 514, array(514), $meta), "UPDATE: an action without references fires on any change except its own column");
eq(BtDiff(rec(1, array(502 => "1")), array("id" => 1, "type" => 500, "val" => "Новое", "values" => array(502 => "2", 503 => "3"))), array(500, 502, 503), "diff: main value (table id) and changed columns");

# 3.2 CREATE: формула пишет после ответа, по порядку колонок, каскад UPDATE по цепочке
world(array(
    510 => array("Сумма", array("type" => "formula", "formula" => "{Цена}*{Кол}", "write" => true, "on" => array("CREATE", "UPDATE"))),
    511 => array("Описание", array("type" => "prompt", "prompt" => "Опиши заказ на {Сумма}", "write" => true, "on" => array("CREATE"))),
    512 => array("Скидка", array("type" => "formula", "formula" => "{Сумма}/10", "write" => true, "on" => array("UPDATE"))),
));
BtFire(port(), "CREATE", rec(1, array(502 => "10", 503 => "3")));
eq($W["writes"], array(), "out-of-band: nothing is written while the user's request is answered");
flush_queue();
eq(writes(), array("1:510=30@ivanov", "1:512=3@ivanov"), "CREATE: formula written, its UPDATE cascade (Скидка over Сумма) followed");
eq(count($W["prompts"]), 1, "CREATE: the prompt column queued one agent job");
$job = $W["prompts"][0];
expect(strpos($job["message"], "Опиши заказ на 30") === 0, "column order: the prompt (2nd column) sees the formula result of the 1st");
expect(strpos($job["message"], "Ответь только итоговым значением для поля «Описание» записи #1 — без пояснений") !== false, "prompt: write adds the answer-only suffix (buildPrompt)");
eq(array($job["context"]["page"], $job["context"]["object_id"], $job["context"]["event"], $job["context"]["column"]), array("trigger", 1, "CREATE", "Описание"), "prompt: context page=trigger, record, event, column");
eq(array($job["trigger"]["write"], $job["trigger"]["start"], $job["trigger"]["key"], $job["trigger"]["chain"]), array(true, "", "1:511", array(511)), "prompt: trigger metadata in the job");

# 3.3 Ответ агента: запись с ~ai; цикл не повторяет свою колонку
expect(BtApplyAnswer(port(), $job["trigger"], "```\nКрасный стул\n```", null), "callback: answer written");
eq(array_slice(writes(), -1), array("1:511=Красный стул@ivanov~ai"), "callback: cleaned answer written as login~ai");
flush_queue();
eq(count($W["prompts"]), 1, "loop: the agent's write does not re-fire its own column");

# 3.4 Цепочка: длина ≤ 3, одна колонка — один раз
world(array(
    521 => array("A", array("type" => "formula", "formula" => "{Цена}+1", "write" => true, "on" => array("UPDATE"))),
    522 => array("B", array("type" => "formula", "formula" => "{A}+1", "write" => true, "on" => array("UPDATE"))),
    523 => array("C", array("type" => "formula", "formula" => "{B}+1", "write" => true, "on" => array("UPDATE"))),
    524 => array("D", array("type" => "formula", "formula" => "{C}+1", "write" => true, "on" => array("UPDATE"))),
    525 => array("E", array("type" => "formula", "formula" => "{E}+{A}", "write" => true, "on" => array("UPDATE"))),
));
BtFire(port(), "UPDATE", rec(2, array(502 => "1")), array("changed" => array(502)));
flush_queue();
$cols = array_map(function($w){ return $w[1]; }, $W["writes"]);
eq(array_values(array_intersect($cols, array(521, 522, 523, 524))), array(521, 522, 523), "depth: A→B→C written, D (4th link) is not");
eq(count(array_keys($cols, 525)), 1, "same column: E (references itself and A) runs once in the chain");

# 3.5 Исполнитель action.user и отказ
world(array(
    530 => array("Итог", array("type" => "query", "query" => "Остаток", "params" => "FR_K=[ID]", "write" => true, "on" => array("CREATE"), "user" => 17)),
    531 => array("Чужой", array("type" => "formula", "formula" => "1", "write" => true, "on" => array("CREATE"), "user" => 99)),
));
BtFire(port(), "CREATE", rec(3, array()), array("chain" => array(700)));
expect(count($W["warn"]) === 1 && strpos($W["warn"][0], "«Чужой»") !== false && strpos($W["warn"][0], "не найден") !== false, "run-as: deleted/blocked user → warning, trigger not run");
flush_queue();
eq($W["queries"], array(array("Остаток", "FR_K=3", "petrov", array(700, 530))), "run-as: the query runs as the configured user; the chain from the request goes on (700→530)");
eq(writes(), array("3:530=17@petrov"), "run-as: the result is written as that user (log label = login)");

# ── 4. Конфликты ────────────────────────────────────────────────────────────
# 4.1 Запрос триггера удаляет саму запись: запись не делается, остальные триггеры по ней — тоже
world(array(
    540 => array("X", array("type" => "query", "query" => "Удалить", "write" => true, "on" => array("CREATE"))),
    541 => array("Y", array("type" => "formula", "formula" => "1", "write" => true, "on" => array("CREATE"))),
));
$W["onQuery"] = function(){ unset($GLOBALS["W"]["recs"][4]); return array(array("v" => "x")); };
BtFire(port(), "CREATE", rec(4, array()));
flush_queue();
eq($W["writes"], array(), "conflict 1: the record deleted by the trigger's query is not written to, the next trigger is skipped");
expect(count(preg_grep('/#4 удалена/u', $W["log"])) >= 1, "conflict 1: logged");

# 4.2 Ответ агента после удаления / смены записи / ручной правки
world(array(550 => array("Ответ", array("type" => "prompt", "prompt" => "?", "write" => true, "on" => array("CREATE")))));
rec(5, array(550 => ""));
$trg = array("rec" => 5, "type" => 500, "col" => 550, "colName" => "Ответ", "write" => true, "chain" => array(550), "start" => "");
$W["recs"][5]["values"][550] = "поправил человек";
expect(!BtApplyAnswer(port(), $trg, "ИИ", null) && !count($W["writes"]), "conflict 2: a field changed by a human since the job start is not overwritten");
expect(count(preg_grep('/изменилось/u', $W["log"])) === 1, "conflict 2: logged");
$W["recs"][5]["type"] = 777;
$W["recs"][5]["values"][550] = "";
expect(!BtApplyAnswer(port(), $trg, "ИИ", null) && !count($W["writes"]), "conflict 2: id reused by a record of another type — not written");
unset($W["recs"][5]);
$GLOBALS["BT_GONE"] = array();
expect(!BtApplyAnswer(port(), $trg, "ИИ", null) && !count($W["writes"]), "conflict 2: deleted record is not resurrected");

# 4.3 Два триггера одного события — по порядку колонок, каждый пишет свою колонку
world(array(
    561 => array("П1", array("type" => "formula", "formula" => "\"один\"", "write" => true, "on" => array("UPDATE"))),
    562 => array("П2", array("type" => "formula", "formula" => "{П1} & \"+два\"", "write" => true, "on" => array("UPDATE"))),
));
BtFire(port(), "UPDATE", rec(6, array(502 => "1")), array("changed" => array(502)));
flush_queue();
eq(writes(), array("6:561=один@ivanov", "6:562=один+два@ivanov"), "conflict 3: column order, the later sees the earlier");

# 4.4 Запрос меняет другие записи той же таблицы: цепочка общая для всех записей
world(array(570 => array("Сосед", array("type" => "query", "query" => "Тронуть соседа", "write" => false, "on" => array("UPDATE")))));
$W["onQuery"] = function($name, $params, $chain){
    # так приходит запрос отчёта: изменение соседней записи с цепочкой из bt_chain
    rec(8, array(502 => "5"));
    BtFire(port(), "UPDATE", $GLOBALS["W"]["recs"][8], array("changed" => array(502), "chain" => $chain));
    return array();
};
BtFire(port(), "UPDATE", rec(7, array(502 => "1")), array("changed" => array(502)));
flush_queue();
eq(count($W["queries"]), 1, "conflict 4: the same column does not fire on the neighbour record (chain crosses records)");
eq($W["queries"][0][3], array(570), "conflict 4: the chain is passed with the query (bt_chain)");

# 4.5 Отказ ядра во вложенной записи не останавливает остальное
world(array(
    581 => array("Ключ", array("type" => "formula", "formula" => "1", "write" => true, "on" => array("CREATE"))),
    582 => array("Другое", array("type" => "formula", "formula" => "2", "write" => true, "on" => array("CREATE"))),
));
$W["writeFail"][581] = "Запись уже существует";
BtFire(port(), "CREATE", rec(9, array()));
flush_queue();
eq(writes(), array("9:582=2@ivanov"), "conflict 5: a failed nested write (uniqueness) is logged, the next trigger still runs");
expect(count(preg_grep('/уже существует/u', $W["log"])) === 1, "conflict 5: the core's refusal is in the log");

# 4.6 Пакет: два изменения одной записи — один запуск с последним состоянием
world(array(590 => array("Сумма", array("type" => "formula", "formula" => "{Цена}*2", "write" => true, "on" => array("UPDATE")))));
BtFire(port(), "UPDATE", rec(10, array(502 => "1")), array("changed" => array(502)));
BtFire(port(), "UPDATE", rec(10, array(502 => "5")), array("changed" => array(502)));
flush_queue();
eq(writes(), array("10:590=10@ivanov"), "conflict 6: per op, deduplicated by record:column:event, run once after the batch with the latest state");

# 4.8 Лимит/дубль промпта — предупреждение в ответ
world(array(599 => array("ИИ", array("type" => "prompt", "prompt" => "?", "write" => true, "on" => array("CREATE")))));
$W["gate"] = "лимит промпт-задач триггеров исчерпан (60 в час на базу) — промпт не отправлен";
BtFire(port(), "CREATE", rec(11, array()));
flush_queue();
expect(count($W["prompts"]) === 0 && count(preg_grep('/лимит промпт-задач/u', $W["warn"])) === 1, "cap: over the hourly cap the prompt is not sent, the response gets a warning");
$W["gate"] = FALSE;
$W["warn"] = array();
BtFire(port(), "CREATE", rec(12, array()));
flush_queue();
expect(count($W["prompts"]) === 0 && !count($W["warn"]), "payment: not paid → skipped silently (log only, by the port)");

# ── 5. Связка с ядром (функции index.php) ───────────────────────────────────
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
define("AI_AGENT_JOBS_MAX", 20);
define("AI_AGENT_JOBS_TTL", 24 * 3600);
define("ADMINROLE", 145);
define("ADMINHASH", "test");
class IntegramOpError extends Exception {}
class ApiDone extends Exception { public $json; function __construct($json){ $this->json = $json; parent::__construct("done"); } }
function api_dump($json, $name="api.json"){ throw new ApiDone($json); }
function aiAgentError($message, $code=400, $extra=array()){ throw new Exception($message, $code); }
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function aiConfigValue($names){ return ""; }
function aiAgentRawInput(){ return $GLOBALS["__raw"]; }
function wlog($text, $mode="log"){ $GLOBALS["__wlog"][] = $text; }
function getGrants($r){ $GLOBALS["GRANTS"] = array("role" => $r); }
function isApi(){ return true; }
$GLOBALS["__pay_ok"] = true;
function checkAiAgentPayment($db){ return !empty($GLOBALS["__pay_ok"]) ? array("ok" => true, "status" => "active", "paidUntil" => 0) : array("ok" => false); }
$GLOBALS["__agent_calls"] = array();
function callIntegramAgent($db, $message, $attachments, $payment, $jobId="", $callbackUrl="", $callbackSecret="", $context=null, $extra=array()){
    $GLOBALS["__agent_calls"][] = array("user" => $GLOBALS["GLOBAL_VARS"]["user"], "token" => $GLOBALS["GLOBAL_VARS"]["token"], "context" => $context);
    return array("pending" => true, "status" => "queued", "agentJobId" => "a1");
}
function aiAgentCallbackUrl($db){ return "https://h/$db/ai/agent/callback"; }

$source = file_get_contents(__DIR__."/../index.php");
foreach(array("aiLogUser", "InBatchOp", "my_die", "OpFail", "BtCorePort", "BtWarn", "BtDrainWarnings", "BtSkipRequest", "BtChainFromRequest",
        "BtAsUser", "BtCoreWrite", "BtJobsStore", "BtPromptGate", "BtJobPending", "BtPromptSubmit", "BtCallbackApply", "BtActionRequest",
        "BtHookBefore", "handleAiAgentCallback", "aiAgentCurrentUser", "aiAgentJobIsOf",
        "aiAgentJobsFile", "aiAgentJobId", "aiAgentJobNew", "aiAgentJobsAppend", "aiAgentJobsFind", "aiAgentJobsLatest", "aiAgentJobsPrune",
        "aiAgentJobsApplyChanges", "aiAgentJobsReplace", "aiAgentJobPublic", "aiAgentJobsEncode", "aiAgentJobsDecode", "aiAgentJobsLoadRaw",
        "aiAgentJobsMutate", "aiAgentJobCreate", "aiAgentJobUpdate", "aiAgentJobGet", "aiAgentProgressClean", "aiAgentBlocksClean", "aiAgentPlanPublic") as $fn)
    eval(extract_function_source($source, $fn));

# Ядро для связки: запись в памяти, ApplyOp пишет как _m_set и журналирует логином aiLogUser()
function BtLog($m){ $GLOBALS["__wlog"][] = $m; }
function BtMeta($t){ return isset($GLOBALS["W"]["meta"][$t]) ? $GLOBALS["W"]["meta"][$t] : null; }
function BtRecord($id){ return isset($GLOBALS["W"]["recs"][$id]) ? $GLOBALS["W"]["recs"][$id] : null; }
function BtQueryLoopback($name, $params, $runAs, $chain){ $GLOBALS["W"]["queries"][] = array($name, $params, $runAs ? $runAs["user"] : "?", $chain); return array(array("v" => "42")); }
function BtLoadUser($ref){
    if(isset($GLOBALS["W"]["users"][$ref])) return $GLOBALS["W"]["users"][$ref];
    throw new Exception("пользователь «".$ref."» не найден — действие не выполнено");
}
function BtDefer($key, $fn){ $GLOBALS["W"]["queue"][$key] = $fn; }
function Check_Grant($id, $t=0, $grant="WRITE", $fatal=TRUE){ return true; }
function ApplyOp($op, $rec, $fields, $up=0, &$r=NULL){
    $saved = $_REQUEST;
    $_REQUEST = $fields;
    try{
        foreach($fields as $k => $v)
            if($k[0] === "t"){
                if($v === "дубль") my_die("Запись уже существует");
                $GLOBALS["W"]["recs"][$rec]["values"][(int)substr($k, 1)] = $v;
                $GLOBALS["__sqllog"][] = array("user" => aiLogUser(), "rec" => $rec, "t" => (int)substr($k, 1), "val" => $v);
            }
    }
    finally{ $_REQUEST = $saved; }
    return "";
}
$users = array(17 => array("user" => "petrov", "user_id" => 17, "role" => "manager", "role_id" => 900, "token" => "tok-petrov", "xsrf" => "x", "grants" => TRUE));

# 5.1 client=ai: собственные записи агента триггеры не запускают
$_GET = array(); $_POST = array("client" => "ai"); $_REQUEST = $_POST;
expect(BtSkipRequest() && BtHookBefore("set", 1) === null, "client=ai: the agent's own writes do not run triggers");
$_POST = array(); $_REQUEST = array();
$_GET = array("bt_chain" => "510,x,511");
eq(BtChainFromRequest(), array(510, 511), "chain from the request (bt_chain) — numbers only");
$_GET = array();

# 5.2 Запись триггера: от имени исполнителя, логин в журнале; агент — логин~ai; отказ ядра — исключение, не exit
$GLOBALS["GLOBAL_VARS"] = array("user" => "ivanov", "user_id" => 5, "role" => "admin", "role_id" => 145, "token" => "tok-ivanov", "xsrf" => "xi");
$GLOBALS["GRANTS"] = array("mine" => 1);
world(array());
$W["users"] = $users;
rec(20, array());
$GLOBALS["__sqllog"] = array();
BtCoreWrite(20, 600, "v1", $users[17], false, array(600));
BtCoreWrite(20, 600, "v2", $users[17], true, array(600));
BtCoreWrite(20, 600, "v3", null, false, array(600));
eq(array_map(function($l){ return $l["user"]; }, $GLOBALS["__sqllog"]), array("petrov", "petrov~ai", "ivanov"), "log label: run-as login, login~ai for the agent's answer, current user by default");
eq(array($GLOBALS["GLOBAL_VARS"]["user"], $GLOBALS["GRANTS"]), array("ivanov", array("mine" => 1)), "run-as: the user's context and grants are restored");
$thrown = false;
try { BtCoreWrite(20, 600, "дубль", null, false, array(600)); } catch(IntegramOpError $e){ $thrown = true; }
expect($thrown && !InBatchOp(), "conflict 5: my_die inside a trigger write throws (not exit) and BATCH_OP is restored");

# 5.3 Промпт: задача в отдельном хранилище, токен исполнителя, дубль не ставится, лимит в час
$z = "t866_".getmypid();
$GLOBALS["z"] = $z;
@unlink(aiAgentJobsFile("trg:".$z));
expect(aiAgentJobsFile("trg:".$z) !== aiAgentJobsFile($z), "jobs: trigger jobs live in their own file (chat jobs are not evicted)");
$pjob = array("message" => "?", "context" => array("page" => "trigger"), "runAs" => $users[17],
    "trigger" => array("rec" => 21, "type" => 500, "col" => 601, "colName" => "Ответ", "event" => "CREATE", "write" => true, "chain" => array(601), "start" => "", "key" => "21:601"));
$r1 = BtPromptSubmit($pjob);
$r2 = BtPromptSubmit($pjob);
expect(!empty($r1["job"]) && empty($r2["job"]) && count($GLOBALS["__agent_calls"]) === 1, "conflict 8: a second job for the same record+column is not queued while the first runs");
eq(array($GLOBALS["__agent_calls"][0]["user"], $GLOBALS["__agent_calls"][0]["token"]), array("petrov", "tok-petrov"), "run-as: the agent gets the configured user's token");
$stored = aiAgentJobGet("trg:".$z, $r1["job"]);
eq(array($stored["user"], $stored["trigger"]["uid"], $stored["status"]), array("petrov", 17, "processing"), "jobs: trigger metadata and executor stored with the job");
eq(BtPromptGate("21:601"), "по этой записи уже выполняется задача ИИ-агента — повторная не ставится", "gate: the duplicate is reported synchronously");
aiAgentJobsMutate("trg:".$z, function($jobs){
    for($i = 0; $i < BT_PROMPT_HOURLY_CAP; $i++)
        $jobs[] = array("id" => "c$i", "createdAt" => time(), "status" => "done", "trigger" => array("key" => "x:$i"));
    return array($jobs, null);
});
expect(strpos(BtPromptGate("99:601"), "лимит промпт-задач триггеров исчерпан (60 в час на базу)") === 0, "cap: ".BT_PROMPT_HOURLY_CAP." trigger prompts per hour per database");
$GLOBALS["__pay_ok"] = false;
eq(BtPromptGate("99:601"), false, "payment: not paid → silent skip");
$GLOBALS["__pay_ok"] = true;

# 5.4 Callback: ответ пишется от имени исполнителя с ~ai, без сессии пользователя
world(array(601 => array("Ответ", array("type" => "prompt", "prompt" => "?", "write" => true, "on" => array("CREATE")))));
$W["users"] = $users;
rec(21, array(601 => ""));
$GLOBALS["__sqllog"] = array();
$GLOBALS["GLOBAL_VARS"] = array();
$job = aiAgentJobGet("trg:".$z, $r1["job"]);
$_SERVER["REQUEST_METHOD"] = "POST";
$_SERVER["HTTP_X_AGENT_SECRET"] = $job["callbackSecret"];
$GLOBALS["__raw"] = json_encode(array("job_id" => $r1["job"], "status" => "done", "content" => "```\nЗелёный\n```"));
unset($GLOBALS["BT_CALLBACK"]);
handleAiAgentCallback($z);
eq($GLOBALS["BT_CALLBACK"], array("job" => $r1["job"]), "callback: a trigger job with write continues to BtCallbackApply after the DB connects");
eq(aiAgentJobGet("trg:".$z, $r1["job"])["status"], "done", "callback: job marked done in the trigger store");
$out = null;
try { BtCallbackApply(); } catch(ApiDone $d){ $out = json_decode($d->json, true); }
eq($out, array("ok" => true, "status" => "done", "applied" => "written"), "callback: answers the agent");
eq($GLOBALS["__sqllog"], array(array("user" => "petrov~ai", "rec" => 21, "t" => 601, "val" => "Зелёный")), "callback: cleaned answer written as petrov~ai");
eq(aiAgentJobGet("trg:".$z, $r1["job"])["applied"], "written", "callback: the job remembers it was applied");
$GLOBALS["__sqllog"] = array();
try { BtCallbackApply(); } catch(ApiDone $d){ $out = json_decode($d->json, true); }
eq($GLOBALS["__sqllog"], array(), "callback: a repeated apply does not write twice");

# 5.5 _m_action: нажатие выполняется на сервере от имени action.user
world(array(
    610 => array("Остаток", array("type" => "query", "query" => "Остаток", "params" => "FR_K=[ID]", "write" => true, "user" => 17)),
    611 => array("Никто", array("type" => "formula", "formula" => "1", "user" => 99)),
));
$W["users"] = $users;
rec(30, array());
$GLOBALS["GLOBAL_VARS"] = array("user" => "ivanov", "user_id" => 5, "role" => "admin", "role_id" => 145, "token" => "tok-ivanov", "xsrf" => "xi");
$GLOBALS["__sqllog"] = array();
$res = BtActionRequest(30, 610, false);
eq(array($res["result"], $res["written"]), array("42", true), "_m_action: result returned and written");
eq($W["queries"][0], array("Остаток", "FR_K=30", "petrov", array(610)), "_m_action: the query runs as the configured user");
eq($GLOBALS["__sqllog"][0]["user"], "petrov", "_m_action: the write is logged as the configured user");
$err = "";
try { BtActionRequest(30, 611, false); } catch(ApiDone $d){ $err = $d->json; }
expect(strpos($err, "не найден") !== false, "_m_action: an unusable executor is refused with a message");

@unlink(aiAgentJobsFile("trg:".$z));
echo $failures ? "\nFAILED: $failures\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
