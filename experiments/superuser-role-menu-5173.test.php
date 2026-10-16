<?php
# Мерка к issue #5173: суперпользователь admin видит меню роли admin.
# https://github.com/ideav/crm/issues/5173
#
# Запуск: php experiments/superuser-role-menu-5173.test.php (в гейте — через одноимённый .test.js)
#
# Меню роли приходит в шаблон блоком MyRoleMenu: отчёт отбирает пункты по формуле
# «ПользовательID=[USER_ID], если FR_RoleID не передан, иначе РольID=FR_RoleID».
# У суперпользователя (вход по ADMINHASH) записи в таблице пользователей нет, user_id=0 —
# без FR_RoleID отчёт пуст. Функция из index.php берётся как есть; проверяется:
#   1) суперпользователь, блок MyRoleMenu — FR_RoleID = id роли admin (ADMINROLE);
#   2) role_id сессии не задан (запрос входа) — тоже ADMINROLE;
#   3) FR_RoleID передан явно (выбор роли в настройке меню) — не трогаем;
#   4) обычный пользователь, в том числе с логином admin в таблице пользователей, — не трогаем;
#   5) другой блок-отчёт у суперпользователя — не трогаем.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

define("ADMINROLE", 145);
$src = file_get_contents(__DIR__."/../index.php");
eval(extract_function_source($src, "Superuser_role_menu_request"));

function run_case($gv, $request, $block){
    $GLOBALS["GLOBAL_VARS"] = $gv;
    $_REQUEST = $request;
    Superuser_role_menu_request($block);
    return $_REQUEST;
}

$su = array("user"=>"admin", "role"=>"admin", "user_id"=>0, "role_id"=>ADMINROLE);

$r = run_case($su, array(), "MyRoleMenu");
expect(isset($r["FR_RoleID"]) && (string)$r["FR_RoleID"] === "145", "суперпользователь: меню роли admin (FR_RoleID=145)");

$r = run_case(array("user"=>"admin", "role"=>"admin", "user_id"=>0), array(), "MyRoleMenu");
expect(isset($r["FR_RoleID"]) && (string)$r["FR_RoleID"] === "145", "суперпользователь без role_id: FR_RoleID=ADMINROLE");

$r = run_case($su, array("FR_RoleID"=>"777"), "MyRoleMenu");
expect($r["FR_RoleID"] === "777", "явно выбранная роль не перекрывается");

$r = run_case(array("user"=>"ivan", "role"=>"manager", "user_id"=>1001, "role_id"=>200), array(), "MyRoleMenu");
expect(!isset($r["FR_RoleID"]), "обычный пользователь: FR_RoleID не подставляется");

$r = run_case(array("user"=>"admin", "role"=>"admin", "user_id"=>"1002", "role_id"=>ADMINROLE), array(), "MyRoleMenu");
expect(!isset($r["FR_RoleID"]), "пользователь admin из таблицы пользователей: меню по своей записи");

$r = run_case($su, array(), "MyPads");
expect(!isset($r["FR_RoleID"]), "другой отчёт-блок: FR_RoleID не подставляется");

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
