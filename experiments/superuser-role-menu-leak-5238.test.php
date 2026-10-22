<?php
# Мерка к issue #5238: FR_RoleID меню роли суперпользователя не утекает в остальную страницу.
# https://github.com/ideav/crm/issues/5238
#
# Запуск: php experiments/superuser-role-menu-leak-5238.test.php (в гейте — через одноимённый .test.js)
#
# Для блока MyRoleMenu суперпользователю подставляется FR_RoleID (issue #5173). Параметр живёт
# в $_REQUEST, и если его не снять после блока, листинг таблицы на той же странице
# (/object/18) берёт его как фильтр по колонке RoleID — в базе без такой колонки запрос падает:
# «Unknown column 'RoleID' in 'on clause'». Функции из index.php берутся как есть; проверяется:
#   1) подставленный для меню FR_RoleID снимается после блока;
#   2) явно переданный FR_RoleID (выбор роли в настройке меню) после блока остаётся;
#   3) у обычного пользователя запрос после блока не меняется.

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
foreach(array("Superuser_role_menu_request", "Superuser_role_menu_release") as $fn){
    try { eval(extract_function_source($src, $fn)); }
    catch(Exception $e){ echo "FAIL: в index.php нет функции $fn\n"; exit(1); }
}

# Блок меню роли так, как его обрабатывает Get_block_data: подстановка, отчёт, снятие.
function run_block($gv, $request, $block, &$during){
    $GLOBALS["GLOBAL_VARS"] = $gv;
    $_REQUEST = $request;
    $set = Superuser_role_menu_request($block);
    $during = $_REQUEST;
    Superuser_role_menu_release($set);
    return $_REQUEST;
}

$su = array("user"=>"admin", "role"=>"admin", "user_id"=>0, "role_id"=>ADMINROLE);

$after = run_block($su, array(), "myrolemenu", $during);
expect(isset($during["FR_RoleID"]) && (string)$during["FR_RoleID"] === "145", "суперпользователь: на время блока FR_RoleID=145");
expect(!isset($after["FR_RoleID"]), "суперпользователь: после блока FR_RoleID снят (листинг таблицы его не видит)");

$after = run_block($su, array("FR_RoleID"=>"777"), "myrolemenu", $during);
expect(isset($after["FR_RoleID"]) && $after["FR_RoleID"] === "777", "явно переданный FR_RoleID после блока остаётся");

$user = array("user"=>"ivan", "role"=>"manager", "user_id"=>1001, "role_id"=>200);
$after = run_block($user, array("F_U"=>"1"), "myrolemenu", $during);
expect($after === array("F_U"=>"1"), "обычный пользователь: запрос после блока не меняется");

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
