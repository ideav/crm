<?php
# Тест явных ответов вместо тишины (issue #5067): блок # <denied-columns-5067> в ядре.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/denied-columns-5067.test.php
#
# Что проверяется:
#   - колонка, скрытая грантом BARRED, попадает в denied_columns ({ord, columnId, name})
#     и в заголовок X-Denied-Columns; ответ-объект получает ключ denied_columns, пустой список — нет;
#   - несуществующая таблица (object/{id}) и несуществующий отчёт (report/{id}) — 404 Not Found.
# header(), Exec_sql(), mysqli_fetch_array(), my_die() подменены в пространстве имён теста.

namespace Test5067;

mb_internal_encoding("UTF-8");
define("REPORT", 22);

class Died extends \Exception {
    public $code_str;
    function __construct($msg, $code){ parent::__construct($msg); $this->code_str = $code; }
}

$GLOBALS["T_HEADERS"] = array();
$GLOBALS["T_ROWS"] = array();      # очередь ответов mysqli_fetch_array
$GLOBALS["T_SQL"] = array();
$z = "testdb";

function header($h){
    list($name) = explode(":", $h, 2);
    $GLOBALS["T_HEADERS"][strtolower(trim($name))] = trim(substr($h, strlen($name) + 1));
}
function headers_sent(){ return FALSE; }
function t9n($s){ return preg_replace('~^\[RU\].*\[EN\]~s', '', $s); }
function Exec_sql($sql, $label){ $GLOBALS["T_SQL"][] = $sql; return "rs"; }
function mysqli_fetch_array($rs){ return array_shift($GLOBALS["T_ROWS"]); }
function my_die($msg, $code = ""){ throw new Died($msg, $code === "" ? "400 Bad Request" : $code); }

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
function died_with($fn){
    try { $fn(); return NULL; }
    catch(Died $e){ return $e->code_str; }
}

$core = str_replace("\r\n", "\n", file_get_contents(__DIR__."/../index.php"));
if(!preg_match('~# <denied-columns-5067>(.*)# </denied-columns-5067>~s', $core, $m)){
    echo "FAIL В index.php не найден блок # <denied-columns-5067> … # </denied-columns-5067>\n";
    exit(1);
}
eval("namespace Test5067;\n".$m[1]);

echo "denied_columns:\n";
unset($GLOBALS["DENIED_COLUMNS"]);
$api = array("type" => array("id" => 300), "object" => array());
ok(Api_with_denied($api) === $api, "без скрытых колонок ответ не меняется (ключа denied_columns нет)");
ok(!isset($GLOBALS["T_HEADERS"]["x-denied-columns"]), "без скрытых колонок заголовка X-Denied-Columns нет");

Deny_column(301, 2, "Цена");
Deny_column("305", 5, "Маржа");
Deny_column(301, 2, "Цена");   # тот же реквизит из второго блока шаблона — не дублируется
ok($GLOBALS["DENIED_COLUMNS"] === array(
        array("ord" => 2, "columnId" => 301, "name" => "Цена"),
        array("ord" => 5, "columnId" => 305, "name" => "Маржа")),
    "скрытые колонки собраны как {ord, columnId, name} без повторов", json_encode($GLOBALS["DENIED_COLUMNS"], JSON_UNESCAPED_UNICODE));
ok(($GLOBALS["T_HEADERS"]["x-denied-columns"] ?? NULL) === "301,305", "заголовок X-Denied-Columns = id скрытых колонок",
    $GLOBALS["T_HEADERS"]["x-denied-columns"] ?? "нет заголовка");
ok(strpos($GLOBALS["T_HEADERS"]["access-control-expose-headers"] ?? "", "X-Denied-Columns") !== FALSE,
    "заголовок открыт для чтения из браузера (Access-Control-Expose-Headers)");
$out = Api_with_denied($api);
ok(isset($out["denied_columns"]) && count($out["denied_columns"]) === 2 && $out["type"] === $api["type"],
    "ответ-объект получает ключ denied_columns, прочие ключи целы");
ok(array_keys($out["denied_columns"][0]) === array("ord", "columnId", "name"), "в denied_columns только ord, columnId, name — без значений");

echo "404 для несуществующих таблицы и отчёта:\n";
$GLOBALS["T_ROWS"] = array(array(0 => "Заказ", 1 => 3, 2 => NULL, "ord" => 0));
$row = NULL;
$code = died_with(function() use (&$row){ $row = Find_table_or_404(300); });
ok($code === NULL && $row[0] === "Заказ", "существующая таблица читается как раньше", (string)$code);

$GLOBALS["T_ROWS"] = array(FALSE);
ok(died_with(function(){ Find_table_or_404(999999); }) === "404 Not Found", "object/{нет такой таблицы} → 404 Not Found");

$GLOBALS["T_ROWS"] = array(array("id" => 8384));
ok(died_with(function(){ Report_exists_or_404(8384); }) === NULL, "существующий отчёт проходит дальше, к проверке гранта");
ok(strpos(end($GLOBALS["T_SQL"]), "t=22") !== FALSE, "отчётом считается только запись типа REPORT", end($GLOBALS["T_SQL"]));

$GLOBALS["T_ROWS"] = array(FALSE);
ok(died_with(function(){ Report_exists_or_404(999999); }) === "404 Not Found", "report/{нет такого отчёта} → 404 Not Found, а не 403");

if($failed){
    fwrite(STDERR, "FAIL: $failed\n");
    exit(1);
}
echo "PASS\n";
