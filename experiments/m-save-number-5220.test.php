<?php
# Мерка к issue #5220 (вторая часть): _m_save не пишет нечисловую строку в NUMBER/SIGNED.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/m-save-number-5220.test.php
#
# Что здесь проверяется.
#   В _m_save значение проходит Format_Val: для «abc» (int) даёт 0, и строка «abc» записывалась
#   в числовое поле как есть, а «12abc» — как 12; ответ — успех.
#   Правило: непустое нечисловое значение любого поля NUMBER/SIGNED (и главного значения записи)
#   — 400 «Значение должно быть числом» ДО первой записи, то есть ничего не меняется, даже если
#   рядом в запросе есть правильные поля. Пустое значение и числа («3 800 000», «2,5») проходят.
#
# ApplyMSave, Number_check и RequireNumber берутся ИЗ ЯДРА; БД подменена заглушками.
# Мерке незачем идти дальше проверок: первый запрос после них (Get_Current_Values) = «прошли».

namespace Test5220s;

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

class Died extends \Exception {
    public $status;
    function __construct($msg, $status){ parent::__construct($msg); $this->status = $status; }
}
class PastCheck extends \Exception {}

function t9n($msg){ return preg_replace('/\[RU\](.*?)\[EN\].*/s', '$1', $msg); }
function trace($msg){}
function my_die($msg, $code = ""){ throw new Died($msg, $code === "" ? "400 Bad Request" : $code); }
function OpFail($msg){ throw new Died($msg, "200"); }
function Check_Rec_masks(){}
function Required_check(){}
function BuiltIn($v){ return $v === "[ONE]" ? "1" : $v; }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["WRITES"][] = "$msg: $t=$val"; return 1; }
function Update_Val($id, $val){ $GLOBALS["WRITES"][] = "update $id=$val"; }
function Get_Current_Values($id, $typ){ throw new PastCheck("checks passed"); }

# Таблица «Заявка» 10200 с главным значением типа $GLOBALS["OWN_BASE"]:
#   10201 «Компания» SHORT, 10203 «Сумма» NUMBER, 10208 «Курс» SIGNED, 10207 ссылка на 18.
function Exec_sql($sql, $msg){
    $GLOBALS["SQL"][] = $msg;
    $rows = array();
    if($msg === "Get current Val and Type")
        $rows[] = array("val" => "З-1", "typ" => 10200, "up" => 1, "ord" => 1, "t" => $GLOBALS["OWN_BASE"], "uniq" => 0);
    elseif($msg === "Get reqs' base types")
        $rows = array(array("id" => 10201, "base" => 3), array("id" => 10203, "base" => 13)
            , array("id" => 10208, "base" => 14), array("id" => 10207, "base" => 18));
    else
        $GLOBALS["WRITES"][] = "sql: $msg";
    return new \ArrayIterator($rows);
}
function mysqli_fetch_array($it){
    if(!$it->valid())
        return NULL;
    $row = $it->current();
    $it->next();
    return $row;
}

$coreSrc = file_get_contents(__DIR__."/../index.php");
$check = core_function($coreSrc, "Number_check");
ok($check !== "", "в ядре есть проверка Number_check");
$code = core_function($coreSrc, "ApplyMSave").$check.core_function($coreSrc, "RequireNumber");
if($check === "")
    $code .= "function Number_check(){}\n";   # прежнее ядро: проверки нет, мерка краснеет по поведению
eval("namespace Test5220s;\n".$code);

$z = "db";
$GLOBALS["basics"] = array(3 => "SHORT", 13 => "NUMBER", 14 => "SIGNED");
$GLOBALS["REV_BT"] = $GLOBALS["basics"];

function m_save($req, $ownBase = 3){
    global $a, $arg, $obj, $next_act;
    $GLOBALS["OWN_BASE"] = $ownBase;
    $GLOBALS["WRITES"] = $GLOBALS["SQL"] = array();
    $a = $arg = $obj = $next_act = "";
    try{
        ApplyMSave(20180, $req, array());
        return "done";
    }
    catch(Died $e){
        return $e;
    }
    catch(PastCheck $e){
        return "past";
    }
}
function isNumberError($r, $field){
    return ($r instanceof Died) && $r->status === "400 Bad Request"
        && mb_stripos($r->getMessage(), "должно быть числом") !== FALSE && strpos($r->getMessage(), $field) !== FALSE;
}

echo "отказ\n";
foreach(array("abc", "12abc", "1,5 млн", "3 800 000 руб.", array("5")) as $bad){
    $r = m_save(array("t10201" => "ООО Ромашка", "t10203" => $bad));
    ok(isNumberError($r, "t10203"), "NUMBER ".shown($bad)." — 400 «должно быть числом»", shown($r instanceof Died ? array($r->status, $r->getMessage()) : $r));
    ok($GLOBALS["WRITES"] === array(), "NUMBER ".shown($bad)." — ничего не записано, и «Компания» тоже", shown($GLOBALS["WRITES"]));

    $r = m_save(array("t10208" => $bad));
    ok(isNumberError($r, "t10208"), "SIGNED ".shown($bad)." — 400", shown($r instanceof Died ? $r->getMessage() : $r));
}
$r = m_save(array("t10200" => "abc"), 13);
ok(isNumberError($r, "t10200"), "главное значение записи типа NUMBER — «abc» отклонено", shown($r instanceof Died ? $r->getMessage() : $r));
ok($GLOBALS["WRITES"] === array(), "главное значение — ничего не записано", shown($GLOBALS["WRITES"]));

echo "проходит\n";
foreach(array("4200000", "4 200 000", "-7", "2,5", "", "[ONE]") as $good){
    $r = m_save(array("t10203" => $good, "t10208" => $good));
    ok($r === "past", "числовые поля ".shown($good)." — проверку прошли", shown($r instanceof Died ? $r->getMessage() : $r));
}
$r = m_save(array("t10201" => "abc", "t10207" => "abc"));
ok($r === "past", "строка и ссылка с «abc» — числовая проверка их не касается", shown($r instanceof Died ? $r->getMessage() : $r));
$r = m_save(array("t10200" => "abc"), 3);
ok($r === "past", "главное значение типа SHORT — «abc» проходит", shown($r instanceof Died ? $r->getMessage() : $r));

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nm-save-number-5220: все проверки пройдены\n";
exit($failed ? 1 : 0);
