<?php
# issue #5104: журнал базы в JSON Lines — logs/<db>_log.jsonl (строка на запрос) и
# logs/<db>_sql.jsonl (строка на изменение с old/new, rid, uid, ~ai, сводка импорта).
#
# Функции журнала и записи (Exec_sql, Insert, Update_Val, Delete, wlog, log*) берутся из
# index.php как есть и исполняются в пространстве имён Test5104, где mysqli_* подменены
# SQLite в памяти: SQL ядра доходит до настоящей таблицы, old/new читаются из неё же.
#
# Прогон: php experiments/jsonl-log-5104.test.php  (нужен pdo_sqlite — есть в php:8.2-cli)
# Отказ — только exit(1): die("…") выходит с кодом 0 и обёртка засчитала бы PASS.

namespace Test5104;

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
class FakeResult {
    public $rows; public $i = 0;
    function __construct($rows){ $this->rows = $rows; }
}
$GLOBALS["PDO"] = new \PDO("sqlite::memory:");
$GLOBALS["PDO"]->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_SILENT);
$GLOBALS["PDO"]->exec("CREATE TABLE z (id INTEGER PRIMARY KEY AUTOINCREMENT, up INTEGER, ord INTEGER, t INTEGER, val TEXT)");
$GLOBALS["PDO"]->exec("INSERT INTO z (id, up, ord, t, val) VALUES (1, 0, 0, 1, 'root')");
$GLOBALS["FAKE"] = array("insert_id" => 0, "affected" => 0, "errno" => 0, "error" => "", "log" => array());

function mysqli_query($c, $sql){
    $GLOBALS["FAKE"]["log"][] = $sql;
    $pdo = $GLOBALS["PDO"];
    $q = str_replace("`", "", $sql);
    $GLOBALS["FAKE"]["errno"] = 0; $GLOBALS["FAKE"]["error"] = "";
    if(preg_match('/^\s*SELECT/i', $q)){
        $st = $pdo->query($q);
        if(!$st){ $GLOBALS["FAKE"]["errno"] = 1064; $GLOBALS["FAKE"]["error"] = implode(" ", $pdo->errorInfo()); return false; }
        return new FakeResult($st->fetchAll(\PDO::FETCH_ASSOC));
    }
    $n = $pdo->exec($q);
    if($n === false){ $GLOBALS["FAKE"]["errno"] = 1064; $GLOBALS["FAKE"]["error"] = implode(" ", $pdo->errorInfo()); return false; }
    $GLOBALS["FAKE"]["affected"] = $n;
    if(preg_match('/^\s*INSERT/i', $q))  # как MySQL: id ПЕРВОЙ строки многострочной вставки
        $GLOBALS["FAKE"]["insert_id"] = (int)$pdo->lastInsertId() - $n + 1;
    return true;
}
function mysqli_fetch_array($r){ return $r->i < count($r->rows) ? $r->rows[$r->i++] : null; }
function mysqli_fetch_assoc($r){ return mysqli_fetch_array($r); }
function mysqli_num_rows($r){ return count($r->rows); }
function mysqli_insert_id($c){ return $GLOBALS["FAKE"]["insert_id"]; }
function mysqli_affected_rows($c){ return $GLOBALS["FAKE"]["affected"]; }
function mysqli_errno($c){ return $GLOBALS["FAKE"]["errno"]; }
function mysqli_error($c){ return $GLOBALS["FAKE"]["error"]; }
function trace($t){}
function Sql_running($s){}
function Sql_running_done(){}
function Sql_timeout_errno($e){ return false; }
function die_info($m){ throw new \Exception($m); }
function login(){ throw new \Exception("login"); }
function t9n($s){ return $s; }

# ---- окружение index.php ----------------------------------------------------------------
define("USER", 18); define("PASSWORD", 20); define("XSRF", 40); define("TOKEN", 125); define("SECRET", 130);
define("LOG_ROTATE_MB", 0.004);  # ~4 КБ: ротация срабатывает много раз за прогон
$dir = sys_get_temp_dir()."/jsonl-5104-".getmypid()."/";
@mkdir($dir);
define("LOGS_DIR", $dir);
$GLOBALS["z"] = "z";
$GLOBALS["connection"] = null;
$_SERVER["REMOTE_ADDR"] = "10.0.0.7";

$source = file_get_contents(__DIR__."/../index.php");
preg_match_all('/^define\("(LOG_[A-Z_]+)",\s*(\d+)\);/m', $source, $d, PREG_SET_ORDER);
foreach($d as $def)
    define($def[1], (int)$def[2]);
preg_match_all('/^function (log[A-Z][A-Za-z_]*)\(/m', $source, $m);
$names = array_unique(array_merge(array("aiLogUser", "maskSensitiveLogValue", "wlog", "Exec_sql", "Insert", "Update_Val", "Delete"), $m[1]));
foreach($names as $name){
    try { eval("namespace Test5104; ".extract_function_source($source, $name)); }
    catch(\Exception $e){
        fwrite(STDERR, "FAIL: в index.php нет $name() — ".$e->getMessage()."\n\nFAILED: 1 check(s) failed\n");
        exit(1);
    }
}
foreach(array("logRequest", "logImportBegin", "logImportEnd") as $need)
    if(!function_exists("Test5104\\$need")){
        fwrite(STDERR, "FAIL: в index.php нет $need()\n\nFAILED: 1 check(s) failed\n");
        exit(1);
    }

# ---- помощники ----------------------------------------------------------------------------
$failures = 0;
function check($cond, $label){
    global $failures;
    if($cond) echo "  ok  $label\n";
    else { echo "FAIL  $label\n"; $failures++; }
}
# Все строки журнала по порядку: архивы ротации <db>_<mode>.N.jsonl по возрастанию N, затем текущий.
function read_log($mode){
    $files = glob(LOGS_DIR."z_$mode.*.jsonl");
    usort($files, function($a, $b){ return (int)preg_replace('/\D/', '', basename($a)) - (int)preg_replace('/\D/', '', basename($b)); });
    if(is_file(LOGS_DIR."z_$mode.jsonl")) $files[] = LOGS_DIR."z_$mode.jsonl";
    $out = array();
    foreach($files as $f)
        foreach(file($f, FILE_IGNORE_NEW_LINES) as $line){
            $rec = json_decode($line, true);
            $out[] = is_array($rec) ? $rec : array("BROKEN" => $line);
        }
    return $out;
}
function mark(){ return array("sql" => count(read_log("sql")), "log" => count(read_log("log"))); }
function since($mode, $mark){ return array_slice(read_log($mode), $mark[$mode]); }
function new_request($user, $uid, $get = array(), $post = array()){
    $GLOBALS["GLOBAL_VARS"] = array("user" => $user, "user_id" => $uid, "role" => "manager");
    $_GET = $get; $_POST = $post; $_REQUEST = array_merge($get, $post);
    unset($GLOBALS["LOG_RID"]);
}
function by_op($recs, $op){ return array_values(array_filter($recs, function($r) use ($op){ return isset($r["op"]) && $r["op"] === $op; })); }

# ---- 1. вставка и правка: _m_new / _m_set ------------------------------------------------
echo "1. insert/update: old/new, rid, uid\n";
new_request("ivanov", 512);
$mk = mark();
$obj = Insert(1, 1, 118, "В работе", "Test new");
Update_Val($obj, "Закрыта");
$recs = since("sql", $mk);
$ins = by_op($recs, "insert"); $upd = by_op($recs, "update");
check(count($ins) === 1 && $ins[0]["id"] === $obj && $ins[0]["up"] === 1 && $ins[0]["t"] === 118 && $ins[0]["new"] === "В работе", "insert: id, up, t, new");
check(count($upd) === 1 && $upd[0]["id"] === $obj && $upd[0]["old"] === "В работе" && $upd[0]["new"] === "Закрыта" && $upd[0]["t"] === 118, "update: old до правки, new после");
check(count($recs) === 2 && $recs[0]["rid"] === $recs[1]["rid"] && strlen($recs[0]["rid"]) >= 6 && strlen($recs[0]["rid"]) <= 8, "один rid на все изменения запроса (6–8 символов)");
check($recs[0]["v"] === 1 && $recs[0]["user"] === "ivanov" && $recs[0]["uid"] === 512, "v=1, user, uid");
check((bool)preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/', $recs[0]["ts"]), "ts — ISO 8601 с миллисекундами и поясом: ".$recs[0]["ts"]);
check(!isset($upd[0]["sql"]), "в строке изменения нет текста SQL");

# ---- 2. удаление с поддеревом: _m_del -----------------------------------------------------
echo "2. delete с поддеревом\n";
new_request("ivanov", 512);
$p = Insert(1, 2, 118, "Заказ 7", "Test");
$c1 = Insert($p, 1, 119, "Позиция 1", "Test");
$c2 = Insert($p, 2, 119, "Позиция 2", "Test");
$g = Insert($c1, 1, 120, "Деталь", "Test");
$mk = mark();
Delete($p);
$recs = since("sql", $mk);
$del = by_op($recs, "delete");
$got = array(); foreach($del as $d) $got[$d["id"]] = $d["old"];
ksort($got);
check($got === array($p => "Заказ 7", $c1 => "Позиция 1", $c2 => "Позиция 2", $g => "Деталь"), "строка delete на каждую строку поддерева, old — значение до удаления");
check(count(array_unique(array_column($recs, "rid"))) === 1, "все удаления — с одним rid");
check(count($del) === count($recs), "кроме delete ничего не записано");
$gd = array_values(array_filter($del, function($d) use ($g){ return $d["id"] === $g; }));
check($gd && $gd[0]["up"] === $c1 && $gd[0]["t"] === 120, "delete несёт up и t удалённой строки");

# ---- 3. секреты: токен, пароль, xsrf ------------------------------------------------------
echo "3. секреты не попадают в журнал\n";
new_request("petrov", 77, array("c" => "qr-code-get-1", "s" => "qr-secret-get-2"), array("login" => "petrov", "pwd" => "Pa55-word-77", "_xsrf" => "xsrf-abc-123", "t20" => "NewPa55-777", "token" => "tok-zzz-999", "s" => "qr-secret-post-3"));
$_SERVER["REQUEST_URI"] = "/z/qrpoll?JSON&c=qr-code-get-1&s=qr-secret-get-2";
$u = Insert(1, 3, USER, "petrov", "Test user");
$tok = Insert($u, 1, TOKEN, "tok-secret-0001", "Insert token");
Update_Val($tok, "tok-secret-0002");
$pw = Insert($u, 2, PASSWORD, "hash-of-password-0003", "Insert pwd");
$xs = Insert($u, 3, XSRF, "xsrf-secret-0004", "Insert xsrf");
Exec_sql("UPDATE z SET val='tok-secret-0005' WHERE up=$u AND t=".TOKEN, "Update token by up");
wlog("Authenticate petrov", "log");
logRequest();
$all = "";
foreach(glob(LOGS_DIR."*") as $f) $all .= file_get_contents($f);
foreach(array("tok-secret-0001", "tok-secret-0002", "hash-of-password-0003", "xsrf-secret-0004", "tok-secret-0005", "Pa55-word-77", "xsrf-abc-123", "NewPa55-777", "tok-zzz-999", "qr-code-get-1", "qr-secret-get-2", "qr-secret-post-3") as $secret)
    check(strpos($all, $secret) === false, "в журнале нет «{$secret}»");
$tokRecs = array_values(array_filter(read_log("sql"), function($r) use ($tok){ return isset($r["id"]) && $r["id"] === $tok; }));
check(count($tokRecs) >= 2 && $tokRecs[0]["new"] === "***" && $tokRecs[1]["old"] === "***", "значения TOKEN — \"***\", но строки изменений есть");
$req = read_log("log"); $req = end($req);
check(isset($req["params"]["_xsrf"]) && $req["params"]["_xsrf"] === "***" && $req["params"]["login"] === "petrov", "параметры запроса: _xsrf замаскирован, прочее как есть");

# ---- 4. ИИ: client=ai и ai_job ---------------------------------------------------------------
echo "4. запрос ИИ\n";
new_request("ivanov", 512, array("client" => "ai", "ai_job" => "a1b2c3"));
$mk = mark();
$_SERVER["REQUEST_METHOD"] = "POST"; $_SERVER["REQUEST_URI"] = "/z/_m_set/$obj?JSON&client=ai&ai_job=a1b2c3";
Update_Val($obj, "Отменена");
logRequest();
$s = since("sql", $mk); $l = since("log", $mk);
check(count($s) === 1 && $s[0]["user"] === "ivanov~ai" && $s[0]["ai_job"] === "a1b2c3", "изменение: user с ~ai, ai_job из параметра");
check(count($l) === 1 && $l[0]["user"] === "ivanov~ai" && $l[0]["ai_job"] === "a1b2c3" && $l[0]["rid"] === $s[0]["rid"], "строка запроса: тот же rid, ~ai, ai_job");
check($l[0]["m"] === "POST" && $l[0]["path"] === "/z/_m_set/$obj" && $l[0]["uid"] === 512 && $l[0]["role"] === "manager" && $l[0]["ip"] === "10.0.0.7", "строка запроса: m, path без query, uid, role, ip");
check(isset($l[0]["st"]) && (is_int($l[0]["ms"]) || is_float($l[0]["ms"])), "строка запроса: st и ms");
check(isset($l[0]["sqls"]) && !array_key_exists("ai", $l[0]), "строка запроса: sqls; отдельного поля ai нет");

# ---- 5. массовый импорт: одна сводка ------------------------------------------------------
echo "5. импорт\n";
new_request("petrov", 77);
$mk = mark();
logImportBegin("csv", 118, "deals.csv");
for($i = 0; $i < 1000; $i++) Insert(1, 10 + $i, 118, "Сделка $i", "Plain import");
Update_Val($obj, "Импорт");
logImportEnd();
$s = since("sql", $mk);
check(count($s) === 1 && $s[0]["op"] === "import", "импорт 1000 строк — одна строка op:import (строк: ".count($s).")");
check($s && $s[0]["kind"] === "csv" && $s[0]["table"] === 118 && $s[0]["file"] === "deals.csv" && $s[0]["inserted"] === 1000 && $s[0]["updated"] === 1 && $s[0]["deleted"] === 0 && $s[0]["errors"] === 0 && isset($s[0]["ms"]), "сводка: kind, table, file, счётчики, ms");
$mk = mark();
logImportBegin("csv", 118, "small.csv");
for($i = 0; $i < 16; $i++) Insert(1, 2000 + $i, 118, "Мелкая $i", "Plain import");
logImportEnd();
$s = since("sql", $mk);
check(count($s) === 16 && count(by_op($s, "insert")) === 16, "импорт 16 записей пишется построчно");

# ---- 6. длинные значения, сдвиг ord, нераспознанный SQL -----------------------------------
echo "6. прочее\n";
new_request("ivanov", 512);
$mk = mark();
$long = Insert(1, 99, 118, str_repeat("я", 3000), "Long");
$s = since("sql", $mk);
check(strlen($s[0]["new"]) <= 2048 && $s[0]["new_len"] === 6000 && mb_check_encoding($s[0]["new"], "UTF-8"), "значение длиннее 2 КБ обрезано по UTF-8, new_len — полная длина");
$q = Insert(1, 1, 121, "Q", "T"); $q1 = Insert($q, 1, 122, "a", "T"); $q2 = Insert($q, 2, 122, "b", "T");
$mk = mark();
Exec_sql("UPDATE z SET ord=ord+1 WHERE up=$q", "Shift ord");
$s = since("sql", $mk);
check(count($s) === 2 && $s[0]["op"] === "update" && $s[0]["old_ord"] + 1 === $s[0]["ord"], "сдвиг ord нескольких строк — update на каждую с old_ord/ord");
$mk = mark();
Exec_sql("UPDATE z SET id=id+100000 WHERE id=$q2", "Renumber");
$s = since("sql", $mk);
check(count($s) === 1 && $s[0]["op"] === "sql" && strpos($s[0]["sql"], "UPDATE") === 0, "нераспознанное изменение — op:sql с текстом");
$mk = mark();
$r = Exec_sql("UPDATE z SET val='x' WHERE nosuchcol=1", "Broken", TRUE, FALSE);
$s = since("sql", $mk);
check(is_string($r) && count($s) === 1 && isset($s[0]["err"]), "ошибка изменения — строка с err");
$mk = mark();
Exec_sql("SELECT * FROM z WHERE id=1", "Read");
check(count(since("sql", $mk)) === 0, "SELECT в _sql.jsonl не пишется");

# ---- 7. формат файлов ---------------------------------------------------------------------
echo "7. файлы\n";
check(count(glob(LOGS_DIR."*.txt")) === 0, "старые .txt не пишутся");
check(count(glob(LOGS_DIR."z_sql.*.jsonl")) > 0, "ротация по размеру: есть z_sql.N.jsonl");
$broken = 0;
foreach(array("sql", "log") as $mode) foreach(read_log($mode) as $rec) if(isset($rec["BROKEN"]) || !isset($rec["v"])) $broken++;
check($broken === 0, "каждая строка каждого файла — JSON-объект с v");
$sizes = array(); foreach(glob(LOGS_DIR."z_sql.*.jsonl") as $f) $sizes[] = filesize($f);
check(max($sizes) < 4200 + 7000, "архив ротации не растёт сверх предела (+ одна строка)");

array_map("unlink", glob(LOGS_DIR."*")); @rmdir(LOGS_DIR);
if($failures){ fwrite(STDERR, "FAILED: $failures check(s) failed\n"); exit(1); }
echo "\nALL PASSED\n";
