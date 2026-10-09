<?php
# Callback ИИ-агента обрабатывается до подключения к БД (диспетчер index.php, блок
# «Callback асинхронного ИИ-агента»), а любой его ответ уходит через api_dump().
# api_dump() в конце зовёт updateBilling(), и при $connection = null запрос в БД
# падал TypeError → HTTP 500 на каждый callback: агент считал доставку неудачной
# и повторял её, хотя результат задачи уже был записан.
#
# Мерка: настоящие api_dump() и updateBilling() из index.php в дочернем PHP-процессе
# (api_dump завершается die(), поэтому только в отдельном процессе):
#   1) без соединения с БД — тело ответа отдано, процесс завершился без Fatal;
#   2) с соединением — биллинг по-прежнему выполняется (ровно один UPDATE).

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
$fns = extract_function_source($source, "api_dump")."\n".extract_function_source($source, "updateBilling")."\n";

# Дочерний скрипт: стабы окружения + настоящие функции + вызов api_dump().
# $mode = "nodb" — соединения нет; "db" — соединение-заглушка, запросы считаются.
function child_script($fns, $mode){
    # Функции объявлены в namespace billingtest, поэтому mysqli_query внутри
    # updateBilling() попадает в заглушку: она считает запросы и, как настоящая
    # (аргумент типизирован mysqli), бросает TypeError на null. От расширения
    # mysqli в окружении мерка не зависит.
    return '<?php
namespace billingtest;
define("DATABASE", 1);
function sendJsonHeaders($name){}
function mysqli_query($c, $sql){
    if(!is_object($c))
        throw new \TypeError("mysqli_query(): Argument #1 must be of type mysqli, null given");
    $GLOBALS["__queries"][] = $sql;
    return true;
}
register_shutdown_function(function(){ echo "\n#QUERIES=".count(isset($GLOBALS["__queries"]) ? $GLOBALS["__queries"] : array()); });
$GLOBALS["z"] = "ateh";
$GLOBALS["time_start"] = microtime(TRUE);
$GLOBALS["connection"] = '.($mode === "db" ? 'new \stdClass()' : 'null').';
'.$fns.'
api_dump(json_encode(array("ok" => true, "status" => "done")), "ai-agent.json");
';
}

function run_child($script){
    $file = tempnam(sys_get_temp_dir(), "apidump");
    file_put_contents($file, $script);
    $out = array(); $code = 0;
    exec(escapeshellarg(PHP_BINARY)." -d display_errors=stdout ".escapeshellarg($file)." 2>&1", $out, $code);
    @unlink($file);
    return array(implode("\n", $out), $code);
}

# 1) Без БД (путь callback): ответ отдан, без Fatal.
list($out, $code) = run_child(child_script($fns, "nodb"));
expect(strpos($out, '{"ok":true,"status":"done"}') === 0, "без БД: тело ответа отдано первым");
expect(stripos($out, "Fatal") === false, "без БД: нет Fatal error (было: mysqli_query(null) → 500)");
expect($code === 0, "без БД: процесс завершился с кодом 0 (код $code)");
expect(strpos($out, "#QUERIES=0") !== false, "без БД: запросов в БД нет");
if(stripos($out, "Fatal") !== false) echo "  вывод: ".substr($out, 0, 300)."\n";

# 2) С БД: биллинг выполняется, как раньше.
list($out, $code) = run_child(child_script($fns, "db"));
expect(strpos($out, '{"ok":true,"status":"done"}') === 0, "с БД: тело ответа отдано");
expect(strpos($out, "#QUERIES=1") !== false, "с БД: updateBilling выполнил один UPDATE");
if(strpos($out, "#QUERIES=1") === false) echo "  вывод: ".substr($out, 0, 300)."\n";

echo $failures ? "\n$failures FAILED\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
