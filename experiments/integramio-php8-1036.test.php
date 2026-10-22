<?php
# Мерка #1036: ядро integram.io (integram.io/index.php) и include/funcs.php под PHP 8.
# PHP 8 сравнивает нечисловую строку с числом как строки и бросает TypeError на арифметике над ""/«abc»,
# PHP 7 приводил такие строки к числу. Ядро писалось под 7.x — проверяем, что поведение 7.x сохранено:
#   A) вид NUMBER: нечисловое значение показывается как есть, а не «0»;
#   B) разбор DATETIME: строка-дата не принимается за метку времени (было 01.01.1970 00:00:31);
#   C) разбор DATE с мусором и вид DATE с меткой-строкой — без TypeError;
#   D) abn_RUB2STR / abn_NUM2STR от пустого и текстового значения — без TypeError;
#   E) трассировка отчёта (mywrite) без каталога базы — без TypeError на fwrite(false).
#
# Запуск: php experiments/integramio-php8-1036.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь>, FUNCS_PHP=<путь> — проверить другие версии (так тест виден красным на старых).

$failures = 0;
ob_start();
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function no_error($fn){
    try { return array(true, $fn()); } catch(Throwable $e){ return array(false, get_class($e).": ".$e->getMessage()); }
}

$z = "abc";
$GLOBALS["tzone"] = 0;
$GLOBALS["BT"] = array("DATE" => 9, "DATETIME" => 4, "NUMBER" => 13, "SIGNED" => 14);
$GLOBALS["REV_BT"] = array(9 => "DATE", 4 => "DATETIME", 13 => "NUMBER", 14 => "SIGNED");
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }

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
$core = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../integram.io/index.php");
$missing = array();
foreach(array("Format_Val", "Format_Val_View", "mywrite") as $fn){
    try { eval(extract_function_source($core, $fn)); } catch(Exception $e){ $missing[] = $fn; }
}
expect(!$missing, "в ядре integram.io есть проверяемые функции".($missing ? " (нет: ".implode(", ", $missing).")" : ""));
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);  # PHP 7 давал тут предупреждения, проверяем исход
# funcs.php открывается коротким тегом «<?» (на хостах short_open_tag включён) — подключаем через eval
$funcs = file_get_contents(getenv("FUNCS_PHP") ?: __DIR__."/../include/funcs.php");
eval("?>".preg_replace('/^<\?(?!php)/', '<?php', $funcs));

# ── A) вид NUMBER ──────────────────────────────────────────────────────────────────────────
foreach(array("З-1" => "З-1", "abc" => "abc", "12" => "12", "1500.7" => "1501", "0" => "0") as $in => $want){
    list($ok, $got) = no_error(function() use ($in){ return Format_Val_View(13, $in); });
    expect($ok && (string)$got === $want, "A: вид NUMBER ".json_encode($in, JSON_UNESCAPED_UNICODE)." → ".json_encode($want, JSON_UNESCAPED_UNICODE)." (вышло ".json_encode($got, JSON_UNESCAPED_UNICODE).")");
}

# ── B) разбор DATETIME ─────────────────────────────────────────────────────────────────────
list($ok, $ts) = no_error(function(){ return Format_Val(4, "22.10.2026 10:00:00"); });
expect($ok && (int)$ts === strtotime("22.10.2026 10:00:00"), "B: дата-время строкой разбирается в метку времени");
list($ok, $ts) = no_error(function(){ return Format_Val(4, "31.02.2026 25:61"); });
expect($ok && (int)$ts > 100000, "B: неверная дата-время не превращается в «31 секунду от 1970» (вышло ".json_encode($ts).")");
list($ok, $ts) = no_error(function(){ return Format_Val(4, "1788000000"); });
expect($ok && (int)$ts === 1788000000, "B: метка времени остаётся меткой");

# ── C) DATE ────────────────────────────────────────────────────────────────────────────────
foreach(array("не..дата", "1.2.ab", "", "31.12.26") as $in){
    list($ok, $got) = no_error(function() use ($in){ return Format_Val(9, $in); });
    expect($ok, "C: разбор DATE ".json_encode($in, JSON_UNESCAPED_UNICODE)." без исключения".($ok ? "" : " ($got)"));
}
list($ok, $got) = no_error(function(){ return Format_Val_View(9, "2026-10-22 10:00"); });
expect($ok, "C: вид DATE от строки длиннее 8 символов без исключения".($ok ? "" : " ($got)"));

# ── D) прописью ────────────────────────────────────────────────────────────────────────────
foreach(array("", "много", "1 000,5") as $in){
    list($ok, $got) = no_error(function() use ($in){ return abn_RUB2STR($in); });
    expect($ok, "D: abn_RUB2STR(".json_encode($in, JSON_UNESCAPED_UNICODE).") без исключения".($ok ? "" : " ($got)"));
    list($ok, $got) = no_error(function() use ($in){ return abn_NUM2STR($in); });
    expect($ok, "D: abn_NUM2STR(".json_encode($in, JSON_UNESCAPED_UNICODE).") без исключения".($ok ? "" : " ($got)"));
}
list($ok, $got) = no_error(function(){ return abn_RUB2STR("1000"); });
expect($ok && mb_strpos($got, "тысяча") !== false && mb_strpos($got, "рубл") !== false, "D: abn_RUB2STR(1000) — «тысяча рублей»");

# ── E) трассировка без каталога ────────────────────────────────────────────────────────────
$tmp = sys_get_temp_dir()."/php8-1036-".getmypid();
@mkdir($tmp); $cwd = getcwd(); chdir($tmp);
$z = "nodir";
@touch("templates");  # каталог создать нельзя: на месте templates/ лежит файл
list($ok, $got) = no_error(function(){ mywrite("trace"); return true; });
expect($ok, "E: mywrite без каталога базы не роняет отчёт".($ok ? "" : " ($got)"));
@unlink("templates"); chdir($cwd); @rmdir($tmp);

$out = ob_get_clean();
echo $out;
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
