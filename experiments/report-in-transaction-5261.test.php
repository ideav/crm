<?php
# issue #5261: галка InTransaction (BOOLEAN) у Запроса — выборка и все изменения запроса идут одной
# транзакцией; отказ посреди запроса (my_die) откатывает уже записанное. Реквизит ищется по имени
# термина (rep_params["InTransaction"]), без него и при снятой галке запрос работает как раньше.
#
# Report_tx_begin/Report_tx_commit/Report_tx_rollback, my_die и InBatchOp берутся из index.php как есть
# и исполняются в пространстве имён Test5261, где mysqli_* подменены SQLite в памяти с настоящими
# транзакциями: запись доходит до таблицы, откат и фиксация видны по её содержимому.
#
# Прогон: php experiments/report-in-transaction-5261.test.php  (нужен pdo_sqlite — есть в php:8.2-cli)
# Отказ — только exit(1): die("…") выходит с кодом 0 и обёртка засчитала бы PASS.

namespace Test5261;

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new \Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new \Exception("not closed: ".$name);
}

# ---- поддельный mysqli поверх SQLite ----------------------------------------------------
$GLOBALS["PDO"] = new \PDO("sqlite::memory:");
$GLOBALS["PDO"]->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_SILENT);
$GLOBALS["PDO"]->exec("CREATE TABLE z (id INTEGER PRIMARY KEY AUTOINCREMENT, up INTEGER, ord INTEGER, t INTEGER, val TEXT)");
$GLOBALS["TX_LOG"] = array();

function mysqli_begin_transaction($c){ $GLOBALS["TX_LOG"][] = "BEGIN"; return $GLOBALS["PDO"]->beginTransaction(); }
function mysqli_commit($c){ $GLOBALS["TX_LOG"][] = "COMMIT"; return $GLOBALS["PDO"]->commit(); }
function mysqli_rollback($c){ $GLOBALS["TX_LOG"][] = "ROLLBACK"; return $GLOBALS["PDO"]->rollBack(); }
function mysqli_error($c){ return implode(" ", $GLOBALS["PDO"]->errorInfo()); }
function trace($t){}
function t9n($s){ return $s; }
function isApi(){ return TRUE; }
function header($h){}
function api_dump($json){ throw new \Exception("api_dump: ".$json); }  # в ядре api_dump завершает запрос
function die_info($m){ throw new \Exception("die_info: ".$m); }
class IntegramOpError extends \Exception {}

define("REP_COL_SET", 132);
$GLOBALS["connection"] = null;

$source = file_get_contents(__DIR__."/../index.php");
$code = "namespace Test5261;\n";
foreach(array("Report_tx_begin", "Report_tx_commit", "Report_tx_rollback", "my_die", "InBatchOp") as $fn){
    try{ $code .= extract_function_source($source, $fn)."\n"; }
    catch(\Exception $e){ fwrite(STDERR, "FAIL: ".$e->getMessage()." — в index.php нет функции\n"); exit(1); }
}
eval($code);

# ---- проверки ---------------------------------------------------------------------------
$fails = 0;
function ok($cond, $msg){
    global $fails;
    if($cond) echo "ok   - $msg\n";
    else { echo "FAIL - $msg\n"; $fails++; }
}
function write_row($val){ $GLOBALS["PDO"]->exec("INSERT INTO z (up, ord, t, val) VALUES (1, 1, 3, '$val')"); }
function count_rows($val){ return (int)$GLOBALS["PDO"]->query("SELECT COUNT(*) FROM z WHERE val='$val'")->fetchColumn(); }
# По умолчанию — запрос на изменение: колонка «Присвоить» (t132) и подтверждённый вызов (#5265)
function report($id, $params, $set = TRUE, $confirmed = TRUE){
    $GLOBALS["STORED_REPS"][$id] = array("rep_params" => $params);
    if($set)
        $GLOBALS["STORED_REPS"][$id][REP_COL_SET] = array(1 => "[THIS]+1");
    unset($_REQUEST["confirmed"]);
    if($confirmed)
        $_REQUEST["confirmed"] = "1";
    unset($GLOBALS["REPORT_TX"]);
    $GLOBALS["TX_LOG"] = array();
}

# 1. Галка стоит: изменения фиксируются одной транзакцией
report(101, array("InTransaction" => "1"));
ok(Report_tx_begin(101) === TRUE, "InTransaction=1: транзакция открыта");
write_row("a1"); write_row("a2");
ok(Report_tx_commit(101) === TRUE, "InTransaction=1: транзакция зафиксирована");
ok(count_rows("a1") === 1 && count_rows("a2") === 1, "после фиксации обе записи на месте");
ok($GLOBALS["TX_LOG"] === array("BEGIN", "COMMIT"), "порядок: BEGIN, COMMIT");

# 2. Отказ посреди запроса (my_die) откатывает всё записанное до него — одиночный вызов
report(102, array("InTransaction" => "1"));
Report_tx_begin(102);
write_row("b1"); write_row("b2");
try{ my_die("Ошибка в середине запроса"); ok(FALSE, "my_die должен завершить запрос"); }
catch(\Exception $e){}
ok(count_rows("b1") === 0 && count_rows("b2") === 0, "my_die: записанное до отказа откатилось");
ok(!isset($GLOBALS["REPORT_TX"]), "my_die: признак транзакции снят");
ok(Report_tx_commit(102) === FALSE, "после отката фиксировать нечего");

# 3. Отказ внутри операции пакета: PHP продолжает работу, откат всё равно явный
report(103, array("InTransaction" => "1"));
Report_tx_begin(103);
write_row("c1");
$GLOBALS["BATCH_OP"] = 1;
$thrown = FALSE;
try{ my_die("Ошибка операции пакета"); }
catch(IntegramOpError $e){ $thrown = TRUE; }
unset($GLOBALS["BATCH_OP"]);
ok($thrown, "в пакете my_die бросает ошибку операции, как и раньше");
ok(count_rows("c1") === 0, "в пакете: записанное запросом откатилось");
write_row("c2");  # следующая операция пакета пишет вне транзакции и остаётся
ok(count_rows("c2") === 1 && !$GLOBALS["PDO"]->inTransaction(), "после отката следующие записи не висят в открытой транзакции");

# 4. Галки нет / снята / реквизита в базе нет — запрос работает без транзакции, ничего не ломается
foreach(array("снята (0)" => array("InTransaction" => "0"), "пустая" => array("InTransaction" => ""),
              "реквизита нет" => array("EXECUTE" => "1"), "параметров нет" => array()) as $case => $params){
    report(104, $params);
    ok(Report_tx_begin(104) === FALSE, "галка $case: транзакция не открыта");
    ok(Report_tx_commit(104) === FALSE && $GLOBALS["TX_LOG"] === array(), "галка $case: ни BEGIN, ни COMMIT");
}
$GLOBALS["STORED_REPS"] = array();
ok(Report_tx_begin(999) === FALSE, "запрос без rep_params вовсе: без транзакции и без предупреждений");
ok(Report_tx_rollback() === FALSE, "откат без открытой транзакции — без действий");

# 5. Вложенный запрос: свою транзакцию не открывает и чужую не фиксирует
report(105, array("InTransaction" => "1"));
$GLOBALS["STORED_REPS"][106] = array("rep_params" => array("InTransaction" => "1"), REP_COL_SET => array(1 => "1"));
Report_tx_begin(105);
ok(Report_tx_begin(106) === FALSE, "вложенный запрос: вторая транзакция не открывается");
write_row("e1");
ok(Report_tx_commit(106) === FALSE && $GLOBALS["PDO"]->inTransaction(), "вложенный запрос не фиксирует транзакцию внешнего");
ok(Report_tx_commit(105) === TRUE && count_rows("e1") === 1, "внешний запрос фиксирует всё");
ok($GLOBALS["TX_LOG"] === array("BEGIN", "COMMIT"), "вложенность: один BEGIN и один COMMIT");

# 6. #5265: галка действует только на запрос на изменение
report(107, array("InTransaction" => "1"), FALSE);
ok(Report_tx_begin(107) === FALSE && $GLOBALS["TX_LOG"] === array(), "чистая выборка (нет «Присвоить»): транзакции нет");
report(108, array("InTransaction" => "1"), TRUE, FALSE);
ok(Report_tx_begin(108) === FALSE && $GLOBALS["TX_LOG"] === array(), "превью SET-запроса без confirmed: транзакции нет");
report(109, array("InTransaction" => "1", "EXECUTE" => "1"), TRUE, FALSE);
ok(Report_tx_begin(109) === TRUE, "SET-запрос с EXECUTE без confirmed: транзакция открыта");
Report_tx_commit(109);
report(110, array("InTransaction" => "1", "EXECUTE" => "1"), FALSE, FALSE);
ok(Report_tx_begin(110) === FALSE, "EXECUTE без «Присвоить» — запрос ничего не пишет: транзакции нет");
report(111, array("InTransaction" => "1"));
ok(Report_tx_begin(111) === TRUE, "SET-запрос с confirmed: транзакция открыта");
Report_tx_commit(111);

if($fails){ fwrite(STDERR, "$fails проверок упало\n"); exit(1); }
echo "Все проверки #5261/#5265 прошли\n";
