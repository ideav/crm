<?php
# Мерка к issue #5442: BOOLEAN хранит и отдаёт три состояния — "1" (да), "-1" (нет), строки нет (не задано).
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/boolean-tristate-5442.test.php
#
# Что проверяется (функции берутся ИЗ ЯДРА index.php, БД подменена заглушками):
#   1. Format_Val (запись): да — "1"/"true"/"X"/true -> "1"; нет — "-1"/"0"/"false"/false -> "-1";
#      пусто и пробел -> "" (строка реквизита удаляется).
#   2. Format_Val_View (показ): API — "1" / "-1"; интерфейс — "X" / "" (нет не показывается как да).
#   3. Construct_WHERE: фильтр «не пусто» (F_=%) по BOOLEAN = «да», "-1" в него не попадает;
#      F_=!% — «нет» и «не задано»; F_=0/false — явное «нет» ("-1").
#   4. Report_tx_begin: флаг InTransaction = "-1" (нет) транзакцию не открывает, "1" — открывает.

namespace Test5442;

error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
mb_internal_encoding("UTF-8");

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
function shown($v){ return str_replace("\n", " ", var_export($v, TRUE)); }

# Экстрактор функции из ядра — тот же, что в experiments/m-save-number-5220.test.php.
function core_function($src, $name){
    $tokens = token_get_all($src);
    $n = count($tokens);
    for($i = 0; $i < $n; $i++){
        if(!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION)
            continue;
        $j = $i + 1;
        while($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT)))
            $j++;
        if($j >= $n || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || $tokens[$j][1] !== $name)
            continue;
        $code = "";
        $depth = 0;
        $started = FALSE;
        for($k = $i; $k < $n; $k++){
            $t = $tokens[$k];
            $code .= is_array($t) ? $t[1] : $t;
            if(!is_array($t)){
                if($t === "{"){ $depth++; $started = TRUE; }
                elseif($t === "}"){
                    $depth--;
                    if($started && $depth === 0)
                        return $code."\n";
                }
            }
            elseif($t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES)
                $depth++;
        }
    }
    return "";
}

# ---- заглушки ----
function isApi(){ return !empty($GLOBALS["API"]); }
function trace($m){}
function t9n($s){ return $s; }
function BuiltIn($v){ return $v; }
function checkInjection($v){ return $v; }
function validateInList($v){ return $v; }
function die_info($s){ throw new \Exception("die_info: $s"); }
function my_die($s){ throw new \Exception("my_die: $s"); }
function Exec_sql($sql, $msg){ return FALSE; }
function mysqli_fetch_array($r){ return NULL; }
function mysqli_begin_transaction($c){ $GLOBALS["TX_BEGUN"] = TRUE; return TRUE; }
function mysqli_error($c){ return ""; }
if(!defined("REP_COL_SET"))
    define("REP_COL_SET", 132);

$coreSrc = file_get_contents(__DIR__."/../index.php");
$code = "";
foreach(array("Boolean_Store_Val", "Boolean_View_Val", "Boolean_Api_Val", "Boolean_Filter_Val"
        , "Format_Val", "Format_Val_View", "Escape_Filter_Val", "Construct_WHERE", "Report_tx_begin") as $fn){
    $f = core_function($coreSrc, $fn);
    if($f === "" && strpos($fn, "Boolean_") !== 0){
        fwrite(STDERR, "в ядре нет функции $fn\n");
        exit(1);
    }
    $code .= $f;
}
eval("namespace Test5442;\n".$code);

$z = "db";
$GLOBALS["basics"] = array(3 => "SHORT", 11 => "BOOLEAN", 13 => "NUMBER");
$GLOBALS["REV_BT"] = $GLOBALS["basics"];
$GLOBALS["BT"] = array_flip($GLOBALS["basics"]);
$GLOBALS["tzone"] = 0;
$GLOBALS["connection"] = NULL;

echo "1. Format_Val — что пишется в квинтет\n";
foreach(array("1", "true", "TRUE", "X", "x", 1) as $v)
    ok(Format_Val(11, $v) === "1", "да ".shown($v)." -> \"1\"", shown(Format_Val(11, $v)));
foreach(array("-1", "0", "false", "FALSE", -1, 0, FALSE) as $v)
    ok(Format_Val(11, $v) === "-1", "нет ".shown($v)." -> \"-1\" (хранится явно)", shown(Format_Val(11, $v)));
foreach(array("", " ") as $v)
    ok(Format_Val(11, $v) === "", "пусто ".shown($v)." -> \"\" (строка удаляется)", shown(Format_Val(11, $v)));

echo "2. Format_Val_View — что видит API и интерфейс\n";
$GLOBALS["API"] = TRUE;
ok(Format_Val_View(11, "1") === "1", "API: \"1\" -> \"1\"", shown(Format_Val_View(11, "1")));
ok(Format_Val_View(11, "-1") === "-1", "API: \"-1\" -> \"-1\" (нет, а не X)", shown(Format_Val_View(11, "-1")));
$GLOBALS["API"] = FALSE;
ok(Format_Val_View(11, "1") === "X", "интерфейс: \"1\" -> X", shown(Format_Val_View(11, "1")));
ok(Format_Val_View(11, "-1") === "", "интерфейс: \"-1\" -> пусто (галка снята)", shown(Format_Val_View(11, "-1")));
ok(Format_Val_View(11, "") === "", "интерфейс: строки нет -> пусто");

echo "3. Construct_WHERE — фильтр по BOOLEAN\n";
function where_for($value){
    $key = 5442;
    $GLOBALS["where"] = $GLOBALS["join"] = $GLOBALS["distinct"] = "";
    $GLOBALS["REV_BT"] = $GLOBALS["basics"] + array($key => "BOOLEAN");
    $GLOBALS["REF_typs"] = $GLOBALS["MULTI"] = array();
    Construct_WHERE($key, array("F" => $value), 1000, FALSE);	# реквизит 5442 записи типа 1000
    return $GLOBALS["where"];
}
# Условие подставляется в SELECT по каждому хранимому состоянию: какие из них оно пропускает
function matches($where){
    $out = array();
    foreach(array("да" => "'1'", "нет" => "'-1'", "не задано" => "NULL") as $name => $lit){
        $cond = preg_replace("/^\s*AND\s+/", "", preg_replace("/\ba5442\.val\b/", $lit, $where));
        $out[$name] = sql_truth($cond);
    }
    return $out;
}
# Крошечный вычислитель условий вида «'x' = '1'», «'x' != '1' OR 'x' IS NULL», «'x' IS NOT NULL»
function sql_truth($cond){
    $cond = trim($cond);
    if(preg_match("/^\((.*)\)$/s", $cond, $m))
        return sql_truth($m[1]);
    $or = preg_split("/\s+OR\s+/i", $cond);
    if(count($or) > 1){
        foreach($or as $part)
            if(sql_truth($part))
                return TRUE;
        return FALSE;
    }
    if(preg_match("/^(NULL|'[^']*')\s+IS\s+(NOT\s+)?NULL$/i", $cond, $m))
        return ($m[1] === "NULL") !== (isset($m[2]) && $m[2] !== "");	# «IS NULL» / «IS NOT NULL»
    if(preg_match("/^(NULL|'[^']*')\s*(!=|<>|=)\s*'([^']*)'$/", $cond, $m)){
        if($m[1] === "NULL")
            return FALSE;
        $eq = trim($m[1], "'") === $m[3];
        return $m[2] === "=" ? $eq : !$eq;
    }
    return "?($cond)";
}
$r = matches(where_for("%"));
ok($r === array("да" => TRUE, "нет" => FALSE, "не задано" => FALSE), "F_=% («не пусто») — только «да»", shown($r)." / ".where_for("%"));
$r = matches(where_for("!%"));
ok($r === array("да" => FALSE, "нет" => TRUE, "не задано" => TRUE), "F_=!% — «нет» и «не задано»", shown($r)." / ".where_for("!%"));
$r = matches(where_for("1"));
ok($r === array("да" => TRUE, "нет" => FALSE, "не задано" => FALSE), "F_=1 — только «да»", shown($r));
foreach(array("-1", "0", "false") as $v){
    $r = matches(where_for($v));
    ok($r === array("да" => FALSE, "нет" => TRUE, "не задано" => FALSE), "F_=$v — только явное «нет»", shown($r)." / ".where_for($v));
}

echo "4. Report_tx_begin — галка InTransaction\n";
function tx_for($flag){
    unset($GLOBALS["REPORT_TX"]);
    $GLOBALS["TX_BEGUN"] = FALSE;
    $_REQUEST = array("confirmed" => 1);
    $GLOBALS["STORED_REPS"] = array(7 => array(REP_COL_SET => array(1 => "x"), "rep_params" => array("InTransaction" => $flag)));
    Report_tx_begin(7);
    return $GLOBALS["TX_BEGUN"];
}
ok(tx_for("1") === TRUE, "InTransaction = 1 — транзакция открыта");
ok(tx_for("-1") === FALSE, "InTransaction = -1 (нет) — без транзакции");
ok(tx_for("0") === FALSE, "InTransaction = 0 — без транзакции");

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nboolean-tristate-5442: все проверки пройдены\n";
exit($failed ? 1 : 0);
