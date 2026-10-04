<?php
# Мерка к issue #5068: _m_set принимает в ссылочное поле только id записи.
#
# Запуск:
#   docker run --rm -v "$PWD":/app -w /app php:8.2-cli php experiments/m-set-ref-id-5068.test.php
#
# Что здесь проверяется.
#   Значение ссылочного реквизита приводилось к числу: имя записи справочника («Январь»)
#   становилось 0, а 0 у ссылки значит «очистить» — существующая ссылка удалялась, и запрос
#   отвечал успехом. У мультиссылки имя пропускалось с предупреждением, но прежний набор
#   ссылок, которого нет во входном списке, всё равно стирался.
#   Правило: непустое значение ссылки, которое не является id, — ошибка «Ссылка должна быть
#   id записи», и ничего не меняется. Пустое значение (и 0) по-прежнему очищает ссылку.
#
# ApplyMSet берётся ИЗ ЯДРА токенайзером; БД подменена заглушками.

namespace Test5068;

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

# Экстрактор функции из ядра — тот же, что в experiments/m-batch-4981.test.php.
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
    fwrite(STDERR, "В ядре не найдена функция $name — мерка потеряла предмет\n");
    exit(1);
}

define("PASSWORD", -1);
define("UPLOAD_DIR", "/tmp/nowhere");
define("REF_TYPE", 1080);       # тип записей справочника «Период»

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
function BuiltIn($v){ return $v; }
function Format_Val($t, $v){ return $v; }
function Update_Val($id, $val){ $GLOBALS["CHANGES"][] = array("update_val", $id, $val); }
function Insert($up, $ord, $t, $val, $msg){ $GLOBALS["CHANGES"][] = array("insert", $up, $t, $val); return 555; }
function Delete($id, $root = 0){ $GLOBALS["CHANGES"][] = array("delete", $id); }
function checkDuplicatedReqs($id, $t){}
function checkNewRef($val, $t, $fatal = TRUE){ return in_array((int)$val, array(812, 813, 814), TRUE); }
function GetRefOrd($obj, $t){ return 1; }
function FieldAttrsHasMulti($attrs){ return $attrs === "MULTI"; }
function OpFail($msg){ throw new \Exception($msg); }
function ApplyOp($op, $rec_id, $fields){ $GLOBALS["CHANGES"][] = array("delegate", $op, $rec_id); return ""; }

$coreSrc = file_get_contents(__DIR__."/../index.php");
eval("namespace Test5068;\n".core_function($coreSrc, "ApplyMSet").core_function($coreSrc, "RequireRefId"));

$GLOBALS["z"] = "testdb";
$GLOBALS["basics"] = array(7 => "STRING");
$GLOBALS["REV_BT"] = array(7 => "STRING");

# Строки ответа «Get Attr Type» для ссылочного реквизита 1085 записи 831921.
function refRows($attrs, $current){
    if(!count($current))
        return array(array("ord" => NULL, "id" => NULL, "ref_val" => NULL, "val" => NULL, "t" => REF_TYPE, "attrs" => $attrs));
    $rows = array();
    $ord = 1;
    foreach($current as $attrId => $refVal)
        $rows[] = array("ord" => $ord++, "id" => $attrId, "ref_val" => $refVal, "val" => "1085", "t" => REF_TYPE, "attrs" => $attrs);
    return $rows;
}
# Записи в базу: всё, что меняет данные (вставки, удаления, обновления).
function writes(){
    $out = $GLOBALS["CHANGES"];
    foreach($GLOBALS["SQL"] as $q)
        if(preg_match('/^\s*(UPDATE|DELETE|INSERT)/i', $q[1]))
            $out[] = array("sql", $q[1]);
    return $out;
}
function scene($rows, $val){
    $GLOBALS["ATTR_ROWS"] = $rows;
    $GLOBALS["CHANGES"] = array();
    $GLOBALS["SQL"] = array();
    unset($GLOBALS["warning"]);
    try{
        return array("ok" => TRUE, "id" => ApplyMSet(831921, array("t1085" => $val), array()));
    }
    catch(\Exception $e){
        return array("ok" => FALSE, "error" => $e->getMessage());
    }
}
function isRefIdError($r){
    return !$r["ok"] && mb_stripos($r["error"], "ссылка должна быть id") !== FALSE;
}

# ── одиночная ссылка: имя вместо id ───────────────────────────────────────────────────────
echo "одиночная ссылка\n";
foreach(array("Январь", "Q1 2026", "12abc", "-5", "1.5") as $bad){
    $r = scene(refRows("", array(900 => 812)), $bad);
    ok(isRefIdError($r), "«{$bad}» поверх ссылки 812 — ошибка «ссылка должна быть id»", shown($r));
    ok(writes() === array(), "«{$bad}» поверх ссылки 812 — значение не тронуто", shown(writes()));

    $r = scene(refRows("", array()), $bad);
    ok(isRefIdError($r), "«{$bad}» в пустую ссылку — ошибка", shown($r));
    ok(writes() === array(), "«{$bad}» в пустую ссылку — ничего не вставлено", shown(writes()));
}

# ── одиночная ссылка: законные значения ───────────────────────────────────────────────────
$r = scene(refRows("", array(900 => 812)), "813");
ok($r["ok"] && $r["id"] === 900, "id 813 поверх 812 — принят", shown($r));
ok(writes() === array(array("sql", "UPDATE testdb SET t=813 WHERE id=900")), "id 813 записан в ссылку", shown(writes()));

$r = scene(refRows("", array(900 => 812)), " 813 ");
ok($r["ok"] && count(writes()) === 1, "id с пробелами по краям — принят", shown(array($r, writes())));

$r = scene(refRows("", array()), 814);
ok($r["ok"] && writes() === array(array("insert", 831921, 814, "1085")), "id числом в пустую ссылку — вставлен", shown(writes()));

foreach(array("" => "пустое значение", "0" => "ноль") as $clear => $name){
    $r = scene(refRows("", array(900 => 812)), $clear);
    ok($r["ok"] && writes() === array(array("delete", 900)), "$name очищает ссылку, как раньше", shown(array($r, writes())));
}

# ── мультиссылка ──────────────────────────────────────────────────────────────────────────
echo "мультиссылка\n";
foreach(array("Январь", "812,Январь", array("812", "Январь")) as $bad){
    $r = scene(refRows("MULTI", array(900 => 812, 901 => 813)), $bad);
    ok(isRefIdError($r), shown($bad)." — ошибка «ссылка должна быть id»", shown($r));
    ok(writes() === array(), shown($bad)." — набор ссылок не тронут", shown(writes()));
}

$r = scene(refRows("MULTI", array(900 => 812, 901 => 813)), "812,814");
ok($r["ok"], "набор id принят", shown($r));
ok(writes() === array(
        array("insert", 831921, 814, "1085"),
        array("sql", "DELETE FROM testdb WHERE id=901"),
        array("sql", "UPDATE testdb SET ord=ord-1 WHERE up=831921 AND val=1085 AND ord>2"),
    ), "набор id: 814 добавлен, 813 снят", shown(writes()));

$r = scene(refRows("MULTI", array(900 => 812)), "812, 814,");
ok($r["ok"] && writes() === array(array("insert", 831921, 814, "1085")),
    "пробелы и хвостовая запятая в наборе id не ошибка", shown(array($r, writes())));

$r = scene(refRows("MULTI", array(900 => 812, 901 => 813)), "");
ok($r["ok"] && count(writes()) === 4, "пустое значение очищает набор, как раньше", shown(array($r, writes())));

echo $failed ? "\nПРОВАЛЕНО проверок: $failed\n" : "\nm-set-ref-id-5068: все проверки пройдены\n";
exit($failed ? 1 : 0);
