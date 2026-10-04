<?php
# Тест 404 для несуществующих таблицы и отчёта (issue #5067): блок # <not-found-5067> в ядре.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/not-found-5067.test.php
#
# Что проверяется:
#   - несуществующая таблица (object/{id}) и несуществующий отчёт (report/{id}) — 404 Not Found;
#   - существующие таблица и отчёт проходят дальше как раньше.
# Колонка под грантом BARRED пропадает из ответа молча — это проверяет e2e (not-found-5067-e2e.sh).
# Exec_sql(), mysqli_fetch_array(), my_die() подменены в пространстве имён теста.

namespace Test5067;

mb_internal_encoding("UTF-8");
define("REPORT", 22);

class Died extends \Exception {
    public $code_str;
    function __construct($msg, $code){ parent::__construct($msg); $this->code_str = $code; }
}

$GLOBALS["T_ROWS"] = array();      # очередь ответов mysqli_fetch_array
$GLOBALS["T_SQL"] = array();
$z = "testdb";

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
if(!preg_match('~# <not-found-5067>(.*)# </not-found-5067>~s', $core, $m)){
    fwrite(STDERR, "FAIL В index.php не найден блок # <not-found-5067> … # </not-found-5067>\n");
    exit(1);
}
eval("namespace Test5067;\n".$m[1]);

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
