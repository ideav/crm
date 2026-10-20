<?php
namespace Test1008;   # свои mysqli_fetch_array/Exec_sql — без конфликта с расширением mysqli
# Мерка к python2node#1008: маски строк роли действуют на запись так же, как на чтение.
#
# Запуск: php experiments/rec-masks-write-1008.test.php (в гейте — через одноимённый .test.js)
#
# Из index.php берутся Rec_masks_denial, Mask_denial и Check_Rec_masks как есть. Подменены
# только SQL (Exec_sql отвечает из таблицы в памяти) и сборка условия маски (Fetch_WHERE_for_mask:
# её разбор операторов — забота Construct_WHERE, здесь проверяется, КАКИЕ значения и КАК идут на
# маску). Правило общее: каждое непустое значение колонки с маской — сохранённое в записи, в её
# родителях и присланное на запись — проходит маску; маски одной колонки — ИЛИ, разных — И;
# ссылка сравнивается по id цели; admin и метаданные масками не закрыты.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function trace($m){}
function BuiltIn($v){ return $v === "[USER_ID]" ? (string)$GLOBALS["GLOBAL_VARS"]["user_id"] : $v; }
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
    $GLOBALS["SQL"][] = $msg;
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
                $rows[] = array("id" => $id, "t" => $db[$r[1]][1]);   # def.t — базовый тип колонки
        return new FakeResult($rows);
    }
    if($msg === "Get record values for masks"){
        preg_match('/up=(\d+)/', $sql, $m);
        $rows = array();
        foreach($db as $id => $r)
            if($r[0] === (int)$m[1])
                $rows[] = array("t" => $r[1], "val" => $r[2]);
        return new FakeResult($rows);
    }
    if($msg === "Check value by mask"){
        list(, $v, $mask) = explode("|", substr($sql, 7));
        return new FakeResult(array(array(0 => Mask_holds($v, $mask) ? "1" : "0")));
    }
    throw new \Exception("неожиданный запрос: $msg");
}
# Условие маски: «=X» (по умолчанию), «!X», «<X»; [USER_ID] раскрывается как в ядре.
function Fetch_WHERE_for_mask($t, $val, $mask){ return "MASK|$val|$mask"; }
function Mask_holds($v, $mask){
    $mask = BuiltIn($mask);
    if($mask[0] === "!") return $v !== substr($mask, 1);
    if($mask[0] === "<") return (int)$v < (int)substr($mask, 1);
    return $v === $mask;
}

# --- функции ядра ---------------------------------------------------------------------------
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
$core = file_get_contents(__DIR__."/../index.php");
eval("namespace Test1008;\n".core_function($core, "Rec_masks_denial").core_function($core, "Mask_denial").core_function($core, "Check_Rec_masks"));

# --- схема: таблица «Заявка» 100 с колонками -------------------------------------------------
# 3 SHORT, 13 NUMBER — базовые; 50 — ссылка на «Компанию» (def 50: t=200 — не базовый тип).
$GLOBALS["basics"] = array(3 => "SHORT", 13 => "NUMBER");
$schema = array(
    100 => array(0, 3, "Заявка"), 200 => array(0, 3, "Компания"), 300 => array(0, 3, "Статус"),
    40 => array(0, 13, "Сумма"), 41 => array(0, 3, "Комментарий"),
    50 => array(0, 200, ""), 60 => array(0, 300, ""),
    101 => array(100, 50, ""),      # Заявка.Компания (ссылка)
    102 => array(100, 60, ""),      # Заявка.Статус (ссылка)
    103 => array(100, 40, ""),      # Заявка.Сумма
    104 => array(100, 41, ""),      # Заявка.Комментарий
    500 => array(0, 3, "Пункт"), 501 => array(500, 41, ""),   # подчинённая таблица заявки
);
$data = array(
    1 => array(1, 1, "root"),
    2001 => array(1, 200, "Альфа"), 2002 => array(1, 200, "Бета"),
    3001 => array(1, 300, "Черновик"), 3002 => array(1, 300, "Подана"), 3004 => array(1, 300, "Одобрена"),
    # Заявка Альфы: компания 2001, статус 3001
    7001 => array(1, 100, "З-1"), 7002 => array(7001, 2001, "101"), 7003 => array(7001, 3001, "102"),
    7004 => array(7001, 103, "500"),
    # Заявка Беты
    7101 => array(1, 100, "З-2"), 7102 => array(7101, 2002, "101"), 7103 => array(7101, 3001, "102"),
    # Заявка без компании
    7201 => array(1, 100, "З-3"),
    # Заявка Беты, у которой в комментарии — число, совпадающее с id колонки-ссылки
    7301 => array(1, 100, "З-4"), 7302 => array(7301, 2001, "101"), 7303 => array(7301, 104, "101"),
    # Подчинённая запись заявки Беты
    7401 => array(7101, 500, "пункт"),
);
$GLOBALS["DB"] = $schema + $data;

function as_user($masks, $user = "alpha"){
    $GLOBALS["GLOBAL_VARS"] = array("user" => $user, "user_id" => 2001);
    $GLOBALS["GRANTS"] = array("mask" => $masks);
    $GLOBALS["SQL"] = array();
}
$company = array(101 => array("2001" => "WRITE"));
$both = array(101 => array("2001" => "WRITE"), 102 => array("<3004" => "WRITE"));

# --- таблица случаев: [маски, пользователь, id, поля, тип, ожидаемый отказ (подстрока) | ""] ---
$cases = array(
    array("своя заявка — без отказа", $company, "alpha", 7001, NULL, 0, ""),
    array("чужая заявка по id — отказ", $company, "alpha", 7101, NULL, 0, "(2002)"),
    array("своя заявка, перевод на чужую компанию — отказ", $company, "alpha", 7001, array("t101" => "2002"), 0, "(2002)"),
    array("новая запись своей компании — без отказа", $company, "alpha", 0, array("t101" => "2001", "t100" => "З-9"), 100, ""),
    array("новая запись чужой компании — отказ", $company, "alpha", 0, array("t101" => "2002"), 100, "(2002)"),
    array("множественная ссылка: одна из компаний чужая — отказ", $company, "alpha", 0, array("t101" => "2001,2002"), 100, "(2002)"),
    array("пустое сохранённое значение не проверяется", $company, "alpha", 7201, NULL, 0, ""),
    array("пустое новое значение не проверяется", $company, "alpha", 7001, array("t101" => ""), 0, ""),
    array("маски разных колонок — И: статус «Одобрена» отбит", $both, "alpha", 7001, array("t102" => "3004"), 0, "(3004)"),
    array("маски разных колонок — И: статус «Подана» пропущен", $both, "alpha", 7001, array("t102" => "3002"), 0, ""),
    array("маски одной колонки — ИЛИ", array(101 => array("2001" => "WRITE", "2002" => "WRITE")), "alpha", 7101, NULL, 0, ""),
    array("маска [USER_ID] раскрывается", array(101 => array("[USER_ID]" => "WRITE")), "alpha", 7101, NULL, 0, "(2002)"),
    array("число в обычной колонке не считается ссылкой", $company, "alpha", 7301, NULL, 0, ""),
    array("подчинённая запись наследует маски родителя", $company, "alpha", 7401, NULL, 0, "(2002)"),
    array("маска на главное значение", array(100 => array("З-1" => "WRITE")), "alpha", 7101, NULL, 0, "(З-2)"),
    array("admin масками не закрыт", $company, "admin", 7101, NULL, 0, ""),
    array("метаданные масками не закрыты", array(100 => array("З-1" => "WRITE")), "alpha", 100, NULL, 0, ""),
    array("поле, не являющееся колонкой (t101x), не проверяется", $company, "alpha", 7001, array("t101x" => "2002"), 0, ""),
);
foreach($cases as list($name, $masks, $user, $id, $fields, $typ, $want)){
    as_user($masks, $user);
    $got = Rec_masks_denial($id, $fields, $typ);
    if($want === "")
        expect($got === "", "$name (получено: «{$got}»)");
    else
        expect(strpos($got, $want) !== FALSE && strpos($got, "по маске") !== FALSE, "$name (получено: «{$got}»)");
}

# Без масок у роли — ни одного запроса к базе.
as_user(array());
expect(Rec_masks_denial(7101, array("t101" => "2002")) === "" && !count($GLOBALS["SQL"]), "роль без масок — проверка бесплатна");

# Check_Rec_masks отказывает 403 через my_die (в пакете my_die превращается в ошибку операции).
as_user($company);
try{ Check_Rec_masks(7101); $died = ""; } catch(Died $e){ $died = $e->getMessage(); }
expect(strpos($died, "403 Forbidden|") === 0, "отказ — 403 через my_die");

echo $failures ? "\n$failures FAIL\n" : "\nвсе проверки пройдены\n";
exit($failures ? 1 : 0);
