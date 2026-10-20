<?php
# issue #5000: фильтры журнала по любым полям — «равно / не равно / начинается / заканчивается /
# содержит / не содержит», по одному полю или по всем сразу (поле «*»). Условия приходят JSON-массивом
# в параметре where: [{"f":"path","op":"starts","v":"/acme/_m_"}, …]; условия сочетаются по И.
# Регистр не важен. Функции берутся из index.php как есть.
# Прогон: php experiments/journal-filter-5000.test.php
# Отказ — только exit(1): die("…") выходит с кодом 0 и обёртка засчитала бы PASS.

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}

define("ADMINROLE", 145);
function t9n($s){ return $s; }
$z = "acme";

$source = file_get_contents(__DIR__."/../index.php");
preg_match_all('/^define\("(LOG_[A-Z_]+)",\s*(\d+)\);/m', $source, $d, PREG_SET_ORDER);
foreach($d as $def)
    define($def[1], (int)$def[2]);
foreach(array("logJournalFilter", "logJournalMatch") as $need)
    if(strpos($source, "function $need(") === false){
        fwrite(STDERR, "FAIL: в index.php нет $need()\n\nFAILED: 1 check(s) failed\n");
        exit(1);
    }
eval(extract_function_source($source, "logJournalFilter"));
eval(extract_function_source($source, "logJournalMatch"));
if(strpos($source, "function logJournalCond(") !== false)
    eval(extract_function_source($source, "logJournalCond"));

$failures = 0;
function check($cond, $label){
    global $failures;
    if($cond) echo "  ok  $label\n";
    else { echo "FAIL  $label\n"; $failures++; }
}

function filt($where){
    $_REQUEST = array("where" => is_string($where) ? $where : json_encode($where, JSON_UNESCAPED_UNICODE));
    return logJournalFilter();
}
function hit($rec, $where){
    $f = filt($where);
    if(isset($f["error"])) return "error: ".$f["error"];
    $stop = FALSE;
    return logJournalMatch($rec, $f, $stop);
}

$req = array("user" => "Petrov", "path" => "/acme/_m_save/42", "ip" => "10.0.0.7", "st" => 200
           , "params" => array("t" => 18, "val" => "Привет, мир"), "msg" => "slow query");

check(hit($req, array(array("f" => "path", "op" => "starts", "v" => "/acme/_m_")) ) === TRUE, "starts: совпало");
check(hit($req, array(array("f" => "path", "op" => "starts", "v" => "_m_")) ) === FALSE, "starts: не с начала — мимо");
check(hit($req, array(array("f" => "path", "op" => "ends", "v" => "/42")) ) === TRUE, "ends: совпало");
check(hit($req, array(array("f" => "path", "op" => "contains", "v" => "_M_SAVE")) ) === TRUE, "contains: регистр не важен");
check(hit($req, array(array("f" => "user", "op" => "eq", "v" => "petrov")) ) === TRUE, "eq: регистр не важен");
check(hit($req, array(array("f" => "user", "op" => "eq", "v" => "petro")) ) === FALSE, "eq: часть строки — мимо");
check(hit($req, array(array("f" => "user", "op" => "ne", "v" => "ivanov")) ) === TRUE, "ne: другое значение");
check(hit($req, array(array("f" => "path", "op" => "notcontains", "v" => "_d_")) ) === TRUE, "notcontains: нет подстроки");
check(hit($req, array(array("f" => "path", "op" => "notcontains", "v" => "save")) ) === FALSE, "notcontains: есть подстрока");
check(hit($req, array(array("f" => "st", "op" => "eq", "v" => "200")) ) === TRUE, "число сравнивается как строка");
check(hit($req, array(array("f" => "params", "op" => "contains", "v" => "Привет")) ) === TRUE, "вложенное поле ищется по JSON без \\u-кодов");
check(hit($req, array(array("f" => "ai_job", "op" => "eq", "v" => "")) ) === TRUE, "нет поля = пустая строка (eq пусто)");
check(hit($req, array(array("f" => "ai_job", "op" => "contains", "v" => "x")) ) === FALSE, "нет поля: contains мимо");
check(hit($req, array(array("f" => "*", "op" => "contains", "v" => "10.0.0")) ) === TRUE, "«*»: найдено в одном из полей");
check(hit($req, array(array("f" => "*", "op" => "contains", "v" => "нету")) ) === FALSE, "«*»: нет нигде");
check(hit($req, array(array("f" => "*", "op" => "notcontains", "v" => "slow")) ) === FALSE, "«*» notcontains: есть в msg — мимо");
check(hit($req, array(array("f" => "*", "op" => "notcontains", "v" => "zzz")) ) === TRUE, "«*» notcontains: нигде нет");
check(hit($req, array(array("f" => "path", "op" => "starts", "v" => "/acme"), array("f" => "st", "op" => "eq", "v" => "500"))) === FALSE, "условия по И: второе не прошло");
check(hit($req, array(array("f" => "path", "op" => "starts", "v" => "/acme"), array("f" => "st", "op" => "eq", "v" => "200"))) === TRUE, "условия по И: оба прошли");
check(hit($req, "[]") === TRUE, "пустой список условий — всё подходит");

# старые фильтры живут рядом
$_REQUEST = array("user" => "Petrov", "where" => json_encode(array(array("f" => "st", "op" => "eq", "v" => "200"))));
$f = logJournalFilter(); $stop = FALSE;
check(logJournalMatch($req, $f, $stop) === TRUE, "where + user: оба сошлись");
$_REQUEST["user"] = "ivanov"; $f = logJournalFilter();
check(logJournalMatch($req, $f, $stop) === FALSE, "where + user: user не сошёлся");

# ошибки ввода
foreach(array("не json", "{\"f\":1}", json_encode(array(array("f" => "path", "op" => "regex", "v" => "x")))
            , json_encode(array(array("f" => "pa th", "op" => "eq", "v" => "x")))
            , json_encode(array(array("f" => "path", "op" => "eq")))
            , json_encode(array_fill(0, 11, array("f" => "path", "op" => "eq", "v" => "x")))) as $bad)
    check(is_string(@hit($req, $bad)) && strpos((string)hit($req, $bad), "error") === 0, "ошибка ввода: ".substr($bad, 0, 30));

if($failures){
    echo "\nFAILED: $failures check(s) failed\n";
    exit(1);
}
echo "\nOK: all checks passed\n";
