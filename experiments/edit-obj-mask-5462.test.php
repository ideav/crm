<?php
namespace Test5462;   # свои mysqli_fetch_array/Exec_sql — без конфликта с расширением mysqli
# Мерка к #5462: маска гранта закрывает запись не только в списке object/, но и в карточке
# edit_obj/<id> (HTML и ?JSON), а маска @N сравнивается по id записи, а не по её значению.
#
# Запуск: php experiments/edit-obj-mask-5462.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра (так тест виден красным на старом index.php).
#
# Из index.php берутся как есть: тело ветки case "edit_obj" блока &main, Rec_masks_denial,
# Mask_denial, Check_Rec_masks. Подменены SQL (таблица в памяти) и сборка условия маски
# (Fetch_WHERE_for_mask): условие считается так, как его посчитал бы MySQL, — в том числе
# сравнение строки с числом ('~код'=0 истинно), из-за которого маска @0 пропускала чужие записи.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function trace($m){}
function BuiltIn($v){ return $v; }
function Format_Val_View($t, $v, $id){ return $v; }
class Died extends \Exception {}
function my_die($msg, $code = ""){ throw new Died("$code|$msg"); }

# --- база в памяти: id => (up, t, val) -----------------------------------------------------
class FakeResult { public $rows; public $i = 0; function __construct($r){ $this->rows = array_values($r); } }
function mysqli_fetch_array($res){
    if(!($res instanceof FakeResult)) return FALSE;
    return isset($res->rows[$res->i]) ? $res->rows[$res->i++] : FALSE;
}
function Exec_sql($sql, $msg){
    $db = $GLOBALS["DB"];
    if($msg === "Get Object & type name"){
        preg_match('/a\.id=(\d+)/', $sql, $m);
        $r = isset($db[(int)$m[1]]) ? $db[(int)$m[1]] : NULL;
        if(!$r || $r[0] === 0) return new FakeResult(array());
        $typ = $db[$r[1]];
        return new FakeResult(array(array(0 => $typ[2], 1 => $typ[1], 2 => $r[2], 3 => $r[1], "id" => $r[1], "t" => $typ[1])));
    }
    if($msg === "Get record for masks"){
        preg_match('/id=(\d+)/', $sql, $m);
        $r = isset($db[(int)$m[1]]) ? $db[(int)$m[1]] : NULL;
        return new FakeResult($r ? array(array("t" => $r[1], "up" => $r[0], "val" => $r[2])) : array());
    }
    if($msg === "Get masked reqs"){
        preg_match('/req\.up=(\d+)/', $sql, $m);
        $rows = array();
        foreach($db as $id => $r)
            if(($r[0] === (int)$m[1]) && ($r[0] !== 0))
                $rows[] = array("id" => $id, "t" => $db[$r[1]][1]);
        return new FakeResult($rows);
    }
    if($msg === "Get record values for masks"){
        preg_match('/up=(\d+)/', $sql, $m);
        $rows = array();
        foreach($db as $id => $r)
            if($r[0] === (int)$m[1])
                $rows[] = array("id" => $id, "t" => $r[1], "val" => $r[2]);
        return new FakeResult($rows);
    }
    if($msg === "Check value by mask"){
        list(, $v, $mask) = explode("|", substr($sql, 7), 3);
        return new FakeResult(array(array(0 => Mask_holds($v, $mask) ? "1" : "0")));
    }
    throw new \Exception("неожиданный запрос: $msg");
}
function Fetch_WHERE_for_mask($t, $val, $mask){ return "MASK|$val|$mask"; }
# Как MySQL: «@N» — a.id=N, куда ядро подставляет переданное значение (строка приводится к числу:
# нечисловая — к 0); «!@N» — отрицание; «X%» — LIKE по началу; иначе — равенство.
function mysql_num($v){ return is_numeric($v) ? (int)$v : (preg_match('/^\s*-?\d+/', $v, $m) ? (int)$m[0] : 0); }
function Mask_holds($v, $mask){
    if(substr($mask, 0, 2) === "!@") return mysql_num($v) !== (int)substr($mask, 2);
    if($mask[0] === "@") return mysql_num($v) === (int)substr($mask, 1);
    if(substr($mask, -1) === "%") return strpos($v, substr($mask, 0, -1)) === 0;
    return $v === $mask;
}

# --- код ядра -------------------------------------------------------------------------------
$core = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../index.php");
function core_function($src, $name){
    $tokens = token_get_all($src);
    for($i = 0, $n = count($tokens); $i < $n; $i++){
        if(!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION) continue;
        $j = $i + 1;
        while(is_array($tokens[$j]) && $tokens[$j][0] === T_WHITESPACE) $j++;
        if(!is_array($tokens[$j]) || $tokens[$j][1] !== $name) continue;
        $code = ""; $depth = 0;
        for($k = $i; $k < $n; $k++){
            $t = $tokens[$k];
            $code .= is_array($t) ? $t[1] : $t;
            if($t === "{" || (is_array($t) && in_array($t[0], array(T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES)))) $depth++;
            elseif($t === "}" && --$depth === 0) return $code;
        }
    }
    fwrite(STDERR, "В ядре нет функции $name — мерка потеряла предмет\n");
    exit(1);
}
# Тело case "edit_obj" блока &main: от метки до первого break на том же уровне скобок.
function edit_obj_branch($src){
    $start = strpos($src, 'case "&main":');
    $at = $start === FALSE ? FALSE : strpos($src, 'case "edit_obj":', $start);
    if($at === FALSE){ fwrite(STDERR, "В ядре нет ветки edit_obj блока &main\n"); exit(1); }
    $tokens = token_get_all("<?php ".substr($src, $at + strlen('case "edit_obj":')));
    $code = ""; $depth = 0;
    for($k = 1, $n = count($tokens); $k < $n; $k++){
        $t = $tokens[$k];
        if(is_array($t) && $t[0] === T_BREAK && $depth === 0) return $code;
        $code .= is_array($t) ? $t[1] : $t;
        if($t === "{" || (is_array($t) && in_array($t[0], array(T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES)))) $depth++;
        elseif($t === "}") $depth--;
    }
    fwrite(STDERR, "Ветка edit_obj без break\n");
    exit(1);
}
eval("namespace Test5462;\n".core_function($core, "Rec_masks_denial").core_function($core, "Mask_denial")
    .core_function($core, "Check_Rec_masks")
    ."\nfunction run_edit_obj(\$id){ global \$z; \$block = '&main'; \$blocks = array(); ".edit_obj_branch($core)." return \$blocks; }");

# --- схема timepad: «Билет» 494 (главное поле — код), реквизит «Email» 495 ----------------------
$z = "timepad";
$GLOBALS["basics"] = array(3 => "SHORT");
$GLOBALS["REV_BT"] = array(3 => "SHORT", 494 => "SHORT");
$GLOBALS["DB"] = array(
    494 => array(0, 3, "Билет"), 41 => array(0, 3, "Email"), 495 => array(494, 41, ""),
    1 => array(1, 1, "root"),
    517 => array(1, 494, "TP7K2Q9X"), 518 => array(517, 495, "ivan@example.com"),   # чужой билет
    520 => array(1, 494, "~TP0000001"),                                              # запись гостя
);
function as_guest($masks, $user = "guest"){
    $GLOBALS["GLOBAL_VARS"] = array("user" => $user, "user_id" => 999);
    $GLOBALS["GRANTS"] = array(494 => "WRITE", "mask" => $masks);
}
function open_card($id){
    try{ $b = run_edit_obj($id); return isset($b["&main"]["title"][0]) ? "ok|".$b["&main"]["title"][0] : "ok|"; }
    catch(Died $e){ return $e->getMessage(); }
}
$tilde = array(494 => array("~%" => "WRITE"));

# A. edit_obj/<id> — та же маска, что у списка и у _m_set/_m_del
as_guest($tilde);
$r = open_card(517);
expect(strpos($r, "403 Forbidden|") === 0 && strpos($r, "по маске") !== FALSE && strpos($r, "ivan@") === FALSE,
    "A1: чужой билет вне маски ~% — 403 «по маске», без данных (получено: «{$r}»)");
$r = open_card(520);
expect($r === "ok|Билет ~TP0000001", "A2: запись под маской открывается (получено: «{$r}»)");
as_guest($tilde, "admin");
$r = open_card(517);
expect($r === "ok|Билет TP7K2Q9X", "A3: admin масками не закрыт (получено: «{$r}»)");
as_guest(array());
$r = open_card(517);
expect($r === "ok|Билет TP7K2Q9X", "A4: роль без масок открывает запись (получено: «{$r}»)");

# B. маска @N — по id записи, а не по значению
foreach(array(
    array("B1: @0 — чужой билет 517 по id закрыт (и для _m_set/_m_del)", array(494 => array("@0" => "WRITE")), 517, NULL, 0, FALSE),
    array("B2: @0 — запись 520 с «~» в значении тоже закрыта", array(494 => array("@0" => "WRITE")), 520, NULL, 0, FALSE),
    array("B3: @517 — запись 517 открыта", array(494 => array("@517" => "WRITE")), 517, NULL, 0, TRUE),
    array("B4: @520 — запись 517 закрыта", array(494 => array("@520" => "WRITE")), 517, NULL, 0, FALSE),
    array("B5: !@517 — запись 517 закрыта", array(494 => array("!@517" => "WRITE")), 517, NULL, 0, FALSE),
    array("B6: !@517 — запись 520 открыта", array(494 => array("!@517" => "WRITE")), 520, NULL, 0, TRUE),
    array("B7: @0 — создание новой записи (id ещё нет) не задерживается", array(494 => array("@0" => "WRITE")), 0, array("t494" => "~TP9"), 494, TRUE),
    array("B8: @0 — числовое значение новой записи тоже не сравнивается с id", array(494 => array("@0" => "WRITE")), 0, array("t494" => "5"), 494, TRUE),
    array("B9: @517 + правка главного поля записи 517 — открыта", array(494 => array("@517" => "WRITE")), 517, array("t494" => "XYZ"), 0, TRUE),
) as list($name, $masks, $id, $fields, $typ, $open)){
    as_guest($masks);
    $got = Rec_masks_denial($id, $fields, $typ);
    expect($open ? ($got === "") : (strpos($got, "по маске") !== FALSE), "$name (получено: «{$got}»)");
}
as_guest(array(494 => array("@0" => "WRITE")));
$r = open_card(517);
expect(strpos($r, "403 Forbidden|") === 0, "B10: @0 — edit_obj чужого билета 403 (получено: «{$r}»)");

echo $failures ? "\n$failures FAIL\n" : "\nвсе проверки пройдены\n";
exit($failures ? 1 : 0);
