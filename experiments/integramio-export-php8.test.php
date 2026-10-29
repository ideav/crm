<?php
# Выгрузка (CSV таблицы, csv_all) падала 500 под PHP 8 на данных, которые PHP 7.4 переваривал с предупреждением:
#   A) вид DATE: текст длиннее 8 символов в поле-дате («не задана дата») — "Unsupported operand types: string + int";
#   B) вид FILE: имя файла с двоеточием («скан:паспорт.pdf») — GetSubdir("скан") — "Unsupported operand types: string / int".
# Ожидаемое поведение — как в PHP 7.4: без исключения, нечисловое значение считается нулём.
# Воспроизведено на дистрибутиве integram.io ~2025 года (PHP 8.2 + MariaDB, база r7ohr): /object/<тип>/?csv=1 и /csv_all.
#
# Запуск: php experiments/integramio-export-php8.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другое ядро (так тест виден красным на старых версиях).

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function no_error($fn){
    try { return array(true, $fn()); } catch(Throwable $e){ return array(false, get_class($e).": ".$e->getMessage()); }
}
function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}

$z = "abc";
define("UPLOAD_DIR", "download/$z/");
$GLOBALS["tzone"] = 0;
$GLOBALS["BT"] = array("DATE" => 9, "FILE" => 10);
$GLOBALS["REV_BT"] = array(9 => "DATE", 10 => "FILE");
function Salt($u, $v){ return "$u:$v"; }  # заглушка: соль ядра к проверяемому свойству не относится

$core = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../integram.io/index.php");
$missing = array();
foreach(array("GetSha", "GetSubdir", "GetFilename", "Format_Val_View") as $fn){
    try { eval(extract_function_source($core, $fn)); } catch(Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в ядре есть проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);  # PHP 7.4 давал тут предупреждения, проверяем исход

# ── A) вид DATE ────────────────────────────────────────────────────────────────────────────
foreach(array("не задана дата", "дата уточняется") as $in){
    list($ok, $got) = no_error(function() use ($in){ return Format_Val_View(9, $in); });
    expect($ok && $got === "01.01.1970", "A: вид DATE ".json_encode($in, JSON_UNESCAPED_UNICODE)." без исключения, как PHP 7.4 — 01.01.1970"
        .($ok ? " (вышло ".json_encode($got, JSON_UNESCAPED_UNICODE).")" : " ($got)"));
}
list($ok, $got) = no_error(function(){ return Format_Val_View(9, "1788000000"); });
expect($ok && $got === date("d.m.Y", 1788000000), "A: вид DATE от метки времени — дата");
list($ok, $got) = no_error(function(){ return Format_Val_View(9, "20260306"); });
expect($ok && $got === "06.03.2026", "A: вид DATE от Ymd — 06.03.2026");

# ── B) вид FILE и каталог файла ────────────────────────────────────────────────────────────
list($ok, $got) = no_error(function(){ return GetSubdir("скан"); });
expect($ok && $got === GetSubdir(0), "B: GetSubdir от нечислового id без исключения, как PHP 7.4 — каталог id=0".($ok ? "" : " ($got)"));
list($ok, $got) = no_error(function(){ return GetSubdir(12345); });
expect($ok && $got === UPLOAD_DIR."12".substr(GetSha(12), 0, 8), "B: GetSubdir(12345) — прежний каталог");
list($ok, $got) = no_error(function(){ return Format_Val_View(10, "скан:паспорт.pdf", 7); });
expect($ok && strpos($got, "паспорт.pdf</a>") !== false, "B: вид FILE с двоеточием в имени без исключения".($ok ? "" : " ($got)"));

echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
