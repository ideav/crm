<?php
// Issue #5481: «Расход» базы в ЛК = ord её записи (t=DATABASE) в my; его наращивает
// updateBilling() на каждом запросе к базе. Новая база начинает счёт с нуля.
// Исполняется настоящий блок case "_new_db" из index.php; БД и создание базы — заглушки.
// rules: none (defect #5481)

define("DATABASE", 271);
define("EMAIL", 41);
define("USER_DB_MASK", "/^[a-z][a-z0-9]{2,14}$/");
$GLOBALS["GLOBAL_VARS"] = array("user_id" => 777);
$z = "my";
$_GET = array("db" => "cources");
$_REQUEST = array("template" => "ru");
$_POST = array("descr" => "");
$INSERTS = array();
$NEXT_ID = 239153;

function t9n($s) { return $s; }
function my_die($m) { throw new Exception($m); }
function checkDbNameReserved($db) { return false; }
function checkDbName($mask, $db) { return preg_match($mask, $db); }
function isDbVacant($db) { return true; }
function Exec_sql($sql, $msg) { return "rs"; }
function mysqli_fetch_array($rs) { return array("dbs" => 1, "plan" => null, "name" => "u", "email" => "u@x"); }
function newDb($db, $template, $name, $email, $x) {}
function api_dump($json, $file) { $GLOBALS["DUMP"] = $json; }
function Insert($up, $ord, $t, $val, $message) {
    $GLOBALS["INSERTS"][] = array("up" => $up, "ord" => $ord, "t" => $t, "val" => $val);
    return $GLOBALS["NEXT_ID"]++;
}

$src = file_get_contents(__DIR__ . "/../index.php");
$from = strpos($src, "\t\tcase \"_new_db\":");
$to = strpos($src, "break;", $from);
if ($from === false || $to === false) { fwrite(STDERR, "case _new_db не найден в index.php\n"); exit(2); }
$body = substr($src, $from, $to + strlen("break;") - $from);

$a = "_new_db";
eval("switch(\$a) {\n" . $body . "\n}");

$fail = 0;
$dbRec = null;
foreach ($INSERTS as $r)
    if ($r["t"] === DATABASE) $dbRec = $r;
if (!$dbRec) { echo "✖ запись базы (t=DATABASE) не вставлена\n"; exit(1); }
if ($dbRec["up"] !== 777 || $dbRec["val"] !== "cources") { echo "✖ запись базы не того пользователя/имени\n"; $fail = 1; }
if ((int)$dbRec["ord"] !== 0) { echo "✖ счётчик (ord) новой базы = " . $dbRec["ord"] . ", ожидается 0\n"; $fail = 1; }
else echo "✔ счётчик (ord) новой базы = 0\n";
if (strpos($GLOBALS["DUMP"], "\"status\":\"Ok\"") === false) { echo "✖ ответ не Ok\n"; $fail = 1; }
exit($fail);
