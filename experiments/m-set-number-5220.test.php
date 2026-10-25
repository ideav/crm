<?php
# Мерка к issue #5220: _m_set не пишет нечисловую строку в NUMBER/SIGNED.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/m-set-number-5220.test.php
#
# Что здесь проверяется.
#   Значение реквизита NUMBER приводилось через (int), а в PHP 8 "abc" != 0 истинно, поэтому
#   «abc» записывалось как 0 поверх прежнего значения, и запрос отвечал успехом.
#   Правило: непустое значение NUMBER/SIGNED, которое не является числом (после снятия пробелов
#   и замены запятой на точку), — ошибка 400 «Значение должно быть числом», и ничего не меняется.
#   Пустое значение по-прежнему очищает поле. Пробелы-разделители разрядов («3 800 000») — число.
#
# ApplyMSet берётся ИЗ ЯДРА токенайзером; БД подменена заглушками.

namespace Test5220;

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

# Экстрактор функции из ядра — тот же, что в experiments/m-set-ref-id-5068.test.php.
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

define("PASSWORD", -1);
define("UPLOAD_DIR", "/tmp/nowhere");

function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function trace($msg){}

class FakeResult {
    public $rows;
    public $i = 0;
    function __construct($rows){ $this->rows = $rows; }
}
function Exec_sql($sql, $err_msg, $log = TRUE, $fatal = TRUE){
    $GLOBALS["SQL"][] = array($err_msg, $sql);
    if($err_msg === "Get Attr Type")
        return new FakeResult($GLOBALS["ATTR_ROWS"]);
    return new FakeResult(array());
}
function mysqli_fetch_array($res){
    if(!($res instanceof FakeResult))
        return FALSE;
    return isset($res->rows[$res->i]) ? $res->rows[$res->i++] : FALSE;
}
function Check_Grant($id, $t = 0, $grant = "WRITE", $fatal = TRUE){ return TRUE; }
function Check_Rec_masks($id, $fields = NULL, $typ = 0){}
function BuiltIn($v){ return $v; }
function Format_Val($t, $v){ return $v; }
function Update_Val($id, $val){ $GLOBALS["CHANGES"][] = array("update_val", $id, $val); }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["CHANGES"][] = array("insert", $up, $t, $val); return 555; }
function Delete($id, $root = 0){ $GLOBALS["CHANGES"][] = array("delete", $id); }
function checkDuplicatedReqs($id, $t){}
function OpFail($msg){ throw new \Exception($msg); }
function my_die($msg, $code = ""){ throw new \Exception(($code === "" ? "400 Bad Request" : $code).": $msg"); }

$coreSrc = file_get_contents(__DIR__."/../index.php");
$helper = core_function($coreSrc, "RequireNumber");
ok($helper !== "", "в ядре есть проверка числового значения RequireNumber");
eval("namespace Test5220;\n".core_function($coreSrc, "ApplyMSet").$helper);
if(!function_exists(__NAMESPACE__."\\RequireNumber")){
    function RequireNumber($t, $val){ return $val; }   # прежнее поведение: проверки нет
}

$GLOBALS["z"] = "testdb";
define("NUM_TYPE", 13);
define("SIGNED_TYPE", 14);
$GLOBALS["basics"] = array(NUM_TYPE => "NUMBER", SIGNED_TYPE => "SIGNED");
$GLOBALS["REV_BT"] = array(NUM_TYPE => "NUMBER", SIGNED_TYPE => "SIGNED");

# Строка ответа «Get Attr Type» для реквизита 10213 записи 20077 базового типа $typ.
function numRows($typ, $current){
    return array(array("ord" => 1, "id" => $current === NULL ? NULL : 20080, "ref_val" => 10213
        , "val" => $current, "t" => $typ, "attrs" => ""));
}
function scene($typ, $current, $val){
    $GLOBALS["ATTR_ROWS"] = numRows($typ, $current);
    $GLOBALS["CHANGES"] = array();
    $GLOBALS["SQL"] = array();
    try{
        return array("ok" => TRUE, "id" => ApplyMSet(20077, array("t10213" => $val), array()));
    }
    catch(\Exception $e){
        return array("ok" => FALSE, "error" => $e->getMessage());
    }
}
function isNumberError($r){
    return !$r["ok"] && strpos($r["error"], "400") === 0 && mb_stripos($r["error"], "должно быть числом") !== FALSE;
}

foreach(array(NUM_TYPE => "NUMBER", SIGNED_TYPE => "SIGNED") as $typ => $name){
    echo "$name\n";
    foreach(array("abc", "1,5 млн", "3 800 000 руб.", "12abc", "--1", array("5")) as $bad){
        $r = scene($typ, "3800000", $bad);
        ok(isNumberError($r), shown($bad)." поверх 3800000 — ошибка 400 «должно быть числом»", shown($r));
        ok($GLOBALS["CHANGES"] === array(), shown($bad)." поверх 3800000 — значение не тронуто", shown($GLOBALS["CHANGES"]));

        $r = scene($typ, NULL, $bad);
        ok(isNumberError($r), shown($bad)." в пустое поле — ошибка", shown($r));
        ok($GLOBALS["CHANGES"] === array(), shown($bad)." в пустое поле — ничего не вставлено", shown($GLOBALS["CHANGES"]));
    }

    $r = scene($typ, "3800000", "4200000");
    ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 4200000)), "4200000 записано", shown($GLOBALS["CHANGES"]));

    $r = scene($typ, "3800000", "4 200 000");
    ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 4200000)), "«4 200 000» — число с разделителями разрядов", shown(array($r, $GLOBALS["CHANGES"])));

    $r = scene($typ, "3800000", "4".chr(0xC2).chr(0xA0)."200".chr(0xC2).chr(0xA0)."000");
    ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 4200000)), "неразрывные пробелы-разделители — число", shown(array($r, $GLOBALS["CHANGES"])));

    $r = scene($typ, "3800000", "-7");
    ok($r["ok"] && count($GLOBALS["CHANGES"]) === 1 && $GLOBALS["CHANGES"][0][2] == -7, "-7 принято", shown(array($r, $GLOBALS["CHANGES"])));

    $r = scene($typ, "3800000", "");
    ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("delete", 20080)), "пустое значение очищает поле, как раньше", shown(array($r, $GLOBALS["CHANGES"])));

    $r = scene($typ, NULL, 15);
    ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("insert", 20077, 10213, 15)), "число в пустое поле — вставлено", shown(array($r, $GLOBALS["CHANGES"])));
}

# Число так, как его отдают Excel, Word и сайты: другие пробелы, минусы, смешанные разделители.
echo "варианты записи числа\n";
$u = function($cp){ return mb_chr($cp, "UTF-8"); };
$variants = array(
    "узкий неразрывный U+202F"      => array("4".$u(0x202F)."200".$u(0x202F)."000", 4200000),
    "тонкий пробел U+2009"          => array("4".$u(0x2009)."200".$u(0x2009)."000", 4200000),
    "цифровой пробел U+2007"        => array("4".$u(0x2007)."200".$u(0x2007)."000", 4200000),
    "таб и перевод строки по краям" => array("\t4200000\r\n", 4200000),
    "BOM и нулевая ширина"          => array($u(0xFEFF)."42".$u(0x200B)."00000", 4200000),
    "минус U+2212"                  => array($u(0x2212)."7", -7),
    "тире U+2013 как минус"         => array($u(0x2013)."7", -7),
    "апостроф 4'200'000"            => array("4'200'000", 4200000),
    "европейский 4.200.000,00"      => array("4.200.000,00", 4200000),
    "американский 4,200,000.00"     => array("4,200,000.00", 4200000),
);
foreach($variants as $name => $case){
    $r = scene(NUM_TYPE, "3800000", $case[0]);
    ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, $case[1])), "NUMBER, $name → ".$case[1], shown(array($r, $GLOBALS["CHANGES"])));
}
$r = scene(SIGNED_TYPE, "1", "1.234,56");
ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 1234.56)), "SIGNED «1.234,56» → 1234.56", shown(array($r, $GLOBALS["CHANGES"])));
$r = scene(SIGNED_TYPE, "1", "1,234.56");
ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 1234.56)), "SIGNED «1,234.56» → 1234.56", shown(array($r, $GLOBALS["CHANGES"])));
$r = scene(SIGNED_TYPE, "1", "1,234");
ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 1.234)), "SIGNED «1,234» — запятая десятичная, 1.234", shown(array($r, $GLOBALS["CHANGES"])));
foreach(array("1,2.5", "1.23,4.5", "12'34", "15%", "(100)", "'123", $u(0xA0)) as $bad){
    $r = scene(SIGNED_TYPE, "1", $bad);
    ok(isNumberError($r) && $GLOBALS["CHANGES"] === array(), "SIGNED ".shown($bad)." — не число, 400", shown(array($r, $GLOBALS["CHANGES"])));
}

$r = scene(SIGNED_TYPE, "1", "2,5");
ok($r["ok"] && $GLOBALS["CHANGES"] == array(array("update_val", 20080, 2.5)), "SIGNED: «2,5» — 2.5", shown(array($r, $GLOBALS["CHANGES"])));

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nm-set-number-5220: все проверки пройдены\n";
exit($failed ? 1 : 0);
