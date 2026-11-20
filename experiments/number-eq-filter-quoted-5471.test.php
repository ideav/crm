<?php
# Мерка к issue #5471: фильтр «равно»/«не равно» по NUMBER/SIGNED сравнивает с КАНОНИЧЕСКИМ строковым
# литералом (как значение лежит после сохранения), а не с числом без кавычек: число против longtext
# заставляет MySQL приводить обе стороны к DOUBLE и читать весь реквизит мимо индекса (t, val).
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/number-eq-filter-quoted-5471.test.php
#
# Настоящий Construct_WHERE из index.php, БД не нужна; смотрим $GLOBALS["where"].

namespace Test5471;

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

# Экстрактор функции из ядра (как в experiments/boolean-tristate-5442.test.php); нет функции — "".
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

$coreSrc = file_get_contents(__DIR__."/../index.php");
$code = "";
foreach(array("Boolean_Filter_Val", "Escape_Filter_Val", "Normalize_Number", "RequireNumber"
        , "Number_Storage_Val", "Construct_WHERE") as $fn)
    $code .= core_function($coreSrc, $fn);
eval("namespace Test5471;\n".$code);

$z = "db";
$GLOBALS["basics"] = array(3 => "SHORT", 13 => "NUMBER", 14 => "SIGNED");
$GLOBALS["BT"] = array_flip($GLOBALS["basics"]);

function where_for($base, $value){
    $key = 5471;
    $GLOBALS["where"] = $GLOBALS["join"] = $GLOBALS["distinct"] = "";
    $GLOBALS["REV_BT"] = $GLOBALS["basics"] + array($key => $base);
    $GLOBALS["REF_typs"] = $GLOBALS["MULTI"] = array();
    Construct_WHERE($key, array("F" => $value), 1000, FALSE);
    return trim(preg_replace("/\s+/", " ", $GLOBALS["where"]));
}
function check($base, $value, $expected){
    $w = where_for($base, $value);
    ok($w === $expected, "$base ".shown($value)." -> $expected", "получили: $w");
}
$nb = "\u{A0}";

echo "1. «равно» по NUMBER/SIGNED — канонический строковый литерал\n";
check("NUMBER", "150", "AND a5471.val='150'");
check("NUMBER", "150.0", "AND a5471.val='150'");
check("NUMBER", "1{$nb}500", "AND a5471.val='1500'");
check("NUMBER", "1 500", "AND a5471.val='1500'");
check("NUMBER", "-7", "AND a5471.val='-7'");
check("SIGNED", "150.0", "AND a5471.val='150'");
check("SIGNED", "1,5", "AND a5471.val='1.5'");
check("SIGNED", "1{$nb}500,5", "AND a5471.val='1500.5'");
check("SIGNED", "-7", "AND a5471.val='-7'");
check("NUMBER", "1,5", "AND a5471.val='1'");	# при сохранении NUMBER обрезает дробь: (int)"1.5"

echo "2. «не равно» — тот же литерал\n";
check("NUMBER", "!150.0", "AND (a5471.val!='150' OR a5471.val IS NULL)");
check("NUMBER", "!1{$nb}500", "AND (a5471.val!='1500' OR a5471.val IS NULL)");
check("SIGNED", "!1,5", "AND (a5471.val!='1.5' OR a5471.val IS NULL)");

echo "3. нечисловое — как раньше, строкой, без падения\n";
check("NUMBER", "abc", "AND a5471.val='abc'");
check("SIGNED", "!abc", "AND (a5471.val!='abc' OR a5471.val IS NULL)");
check("NUMBER", "1'; DROP TABLE x; --", "AND a5471.val='1\\';DROPTABLEx;--'");	# пробелы вырезаются, кавычка экранирована

echo "4. ноль — прежнее числовое сравнение (при сохранении 0 не приводится: \"0.0\"/\"00\" лежат как пришли)\n";
check("NUMBER", "0", "AND a5471.val=0");
check("NUMBER", "0.0", "AND a5471.val=0.0");
check("SIGNED", "00", "AND a5471.val=00");
check("SIGNED", "-0", "AND a5471.val=-0");

echo "5. диапазоны не меняются (#5278)\n";
check("NUMBER", ">150", "AND a5471.val>150");
check("NUMBER", "<=150.5", "AND a5471.val<=150.5");
check("SIGNED", "100..500", "AND a5471.val BETWEEN 100 AND 500");
check("NUMBER", ">=1500", "AND a5471.val>=1500");

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nnumber-eq-filter-quoted-5471: все проверки пройдены\n";
exit($failed ? 1 : 0);
