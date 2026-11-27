<?php
namespace Test1449;   # свои mysqli_fetch_array/Exec_sql — без конфликта с расширением mysqli
# Мерка к python2node#1449: права роли на чтение.
#   Grant_1level — явный BARRED сильнее READ, выведенного по ссылке из разрешённой таблицы;
#   Edit_obj_denied — карточка записи явно закрытой таблицы и чужие пользователи/роли (с подчинёнными)
#   без гранта не открываются; своя учётная запись и своя роль открываются; прочее — как раньше;
#   Secret_req_hidden — Token/Secret/xsrf видны администратору и самому пользователю;
#   getGrants — запрос маски выполняется с признаком MASK_REPORT и не оставляет свой кеш отчёта.
#
# Запуск: php experiments/edit-obj-grants-1449.test.php [путь к index.php] (в гейте — через .test.js)
# Из ядра берутся Grant_1level, Check_Grant, Edit_obj_denied, Secret_req_hidden, getGrants как есть;
# подменён только SQL: Exec_sql отвечает из таблицы в памяти.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function trace($m){}
class Died extends \Exception {}
function my_die($msg, $code = ""){ throw new Died("$code|$msg"); }
function BuiltIn($v){ return $v; }
define(__NAMESPACE__."\\USER", 18);
define(__NAMESPACE__."\\ROLE", 42);
define(__NAMESPACE__."\\TOKEN", 125);
define(__NAMESPACE__."\\SECRET", 130);
define(__NAMESPACE__."\\XSRF", 40);
define(__NAMESPACE__."\\REP_COLS", 28);
define(__NAMESPACE__."\\ROLE_OBJECT", 116);
define(__NAMESPACE__."\\LEVEL", 47);
define(__NAMESPACE__."\\MASK", 49);
define(__NAMESPACE__."\\EXPORT", 55);
define(__NAMESPACE__."\\DELETE", 56);

# --- база в памяти: id => (up, t, val) -----------------------------------------------------
class FakeResult { public $rows; public $i = 0; function __construct($r){ $this->rows = array_values($r); } }
function mysqli_fetch_array($res){
    if(!($res instanceof FakeResult)) return FALSE;
    return isset($res->rows[$res->i]) ? $res->rows[$res->i++] : FALSE;
}
function num($sql, $re){ preg_match($re, $sql, $m); return (int)$m[1]; }
function Exec_sql($sql, $msg){
    $db = $GLOBALS["DB"];
    if($msg === "Check grants to parent of this as ref"){   # таблицы, чьи колонки ссылаются на таблицу
        $id = num($sql, '/ref\.t=(\d+)/');
        $rows = array();
        foreach($GLOBALS["REFS"] as $from => $to)
            if($to === $id) $rows[] = array("up" => $from);
        return new FakeResult($rows);
    }
    if(($msg === "Get Object info by ID") || ($msg === "Edit_obj: record and parent")){
        $id = num($sql, '/id=(\d+)/');
        if(!isset($db[$id])) return new FakeResult(array());
        list($up, $t, $val) = $db[$id];
        if($msg === "Edit_obj: record and parent")
            return new FakeResult(array(array("t" => $t, "up" => $up)));
        return new FakeResult(array(array("t" => $t, "par_typ" => $up > 1 ? $db[$up][1] : 1
            , "par_id" => $up > 1 ? $up : 1, "arr" => -1, "ref" => $val)));
    }
    if($msg === "Get grants")
        return new FakeResult($GLOBALS["GRANT_ROWS"]);
    throw new \Exception("неожиданный запрос: $msg");
}
function Get_block_data($block){
    $GLOBALS["SAW_MASK_FLAG"] = !empty($GLOBALS["MASK_REPORT"]);
    $GLOBALS["STORED_REPS"][900] = array("header" => $block, "sql" => "SELECT 1");
    $GLOBALS["blocks"][$block] = array(mb_strtolower($block) => array("7001,7002"));
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
$path = isset($argv[1]) ? $argv[1] : __DIR__."/../index.php";
$core = file_get_contents($path);
$code = "";
foreach(array("Grant_1level", "Check_Grant", "Edit_obj_denied", "Secret_req_hidden", "getGrants") as $fn)
    $code .= core_function($core, $fn);
eval("namespace Test1449;\n".$code);

# --- схема SRM: «Приглашение» 481 ссылается на «Заявку» 479 и «Поставщика» 474 -------------------
$GLOBALS["REFS"] = array(481 => 479, 482 => 474);
$GLOBALS["DB"] = array(
    1142 => array(1, 479, "З-2026-0101"), 706 => array(1, 474, "ООО Альфа"), 2408 => array(1, 481, "INV-1"),
    4160 => array(1, 18, "director"), 4263 => array(1, 18, "tester"),
    685 => array(1, 42, "Руководитель"), 4262 => array(1, 42, "Тестовая"),
    687 => array(685, 116, "470"), 4267 => array(4262, 116, "481"),
    7269 => array(1, 22, "Заявки согласующего"), 3001 => array(1142, 480, "событие заявки"),
);
$z = "srm";
function as_role($grants, $user = "tester"){
    $GLOBALS["GLOBAL_VARS"] = array("user" => $user, "user_id" => 4263, "role_id" => 4262);
    $GLOBALS["GRANTS"] = $grants;
}
$supplier = array(481 => "READ", 479 => "BARRED");

# 1. Grant_1level: явный BARRED против READ по ссылке
as_role($supplier);
expect(Grant_1level(479) === FALSE, "явный BARRED не пробивается READ по ссылке из разрешённой таблицы");
expect(Grant_1level(481) === "READ", "явный READ — READ");
as_role(array(482 => "READ"));
expect(Grant_1level(474) === "READ", "без явного гранта READ по ссылке сохраняется");
as_role(array(1 => "READ", 479 => "BARRED"));
expect(Grant_1level(479) === FALSE, "явный BARRED сильнее READ на все таблицы");
as_role($supplier, "admin");
expect(Grant_1level(479) === "WRITE", "admin — WRITE");

# 2. Edit_obj_denied: карточка записи
$cases = array(
    array("запись явно BARRED-таблицы закрыта", $supplier, "tester", 1142, TRUE),
    array("подчинённая запись BARRED-таблицы закрыта", $supplier, "tester", 3001, TRUE),
    array("запись разрешённой таблицы открыта", $supplier, "tester", 2408, FALSE),
    array("запись таблицы без гранта открывается как раньше", $supplier, "tester", 706, FALSE),
    array("чужой пользователь без гранта закрыт", $supplier, "tester", 4160, TRUE),
    array("своя учётная запись открыта", $supplier, "tester", 4263, FALSE),
    array("чужая роль закрыта", $supplier, "tester", 685, TRUE),
    array("грант чужой роли закрыт", $supplier, "tester", 687, TRUE),
    array("своя роль открыта", $supplier, "tester", 4262, FALSE),
    array("грант своей роли открыт", $supplier, "tester", 4267, FALSE),
    array("пользователи по явному READ открыты", array(18 => "READ"), "tester", 4160, FALSE),
    array("роли по READ на все таблицы открыты", array(1 => "READ"), "tester", 685, FALSE),
    array("admin — без ограничений", $supplier, "admin", 1142, FALSE),
    array("владелец базы — без ограничений", $supplier, "srm", 4160, FALSE),
);
foreach($cases as list($name, $grants, $user, $id, $want)){
    as_role($grants, $user);
    expect(Edit_obj_denied($id) === $want, $name);
}

# 3. Secret_req_hidden
as_role(array(18 => "READ"));
expect(Secret_req_hidden(125, 4160) && Secret_req_hidden(130, 4160) && Secret_req_hidden(40, 4160), "чужие Token/Secret/xsrf скрыты");
expect(!Secret_req_hidden(125, 4263) && !Secret_req_hidden(130, 4263), "свои Token/Secret видны");
expect(!Secret_req_hidden(33, 4160), "прочие поля пользователя не скрываются");
as_role(array(), "admin");
expect(!Secret_req_hidden(130, 4160), "admin видит Secret");

# 4. getGrants: запрос маски — с признаком MASK_REPORT, его кеш отчёта не остаётся
as_role(array());
$GLOBALS["GRANT_ROWS"] = array(array("obj" => "478", "lev" => "WRITE", "mask" => "@IN([Заявки согласующего])", "exp" => NULL, "del" => NULL));
$GLOBALS["STORED_REPS"] = array(625 => array("header" => "Заявки SLA"));
getGrants(4262);
expect(!empty($GLOBALS["SAW_MASK_FLAG"]), "запрос маски выполняется с признаком MASK_REPORT");
expect(!isset($GLOBALS["MASK_REPORT"]), "признак снят после маски");
expect(array_keys($GLOBALS["STORED_REPS"]) === array(625), "кеш отчётов после маски — прежний");
expect(isset($GLOBALS["GRANTS"]["mask"][478]["@IN(7001,7002)"]), "маска раскрыта значением запроса");

echo $failures ? "\n$failures FAIL\n" : "\nвсе проверки пройдены\n";
exit($failures ? 1 : 0);
