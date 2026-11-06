<?php
# Мерка к issue #5420: ЛК базы my без ролевых блоков шаблонизатора.
# https://github.com/ideav/crm/issues/5420
#
# Запуск: php experiments/my-cabinet-shell-5420.test.php (в гейте — через одноимённый .test.js)
#
# templates/my/main.html разбирается настоящими Make_tree/Parse_block из index.php. Отчёты блоков
# подменены: у суперадмина (вход по ADMINHASH, user_id 0) записи пользователя нет, поэтому все
# отчёты по пользователю пустые. Правила:
#   1) страница не пустая у пользователя, админа и суперадмина — даже когда ни один отчёт не
#      вернул строк (раньше страница целиком висела на ролевых блоках noAdmin/isAdmin);
#   2) на странице обе разметки — ЛК и рабочее место админа (выбор делает js/my-mode.js);
#   3) рабочее место админа получает содержимое действия (&main.a: info.html, object.html);
#   4) данные отчётов ЛК (тарифы, оплата месяца, лимит) отдаёт шаблон cabdata.html в API-ответе.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function extract_function_source($source, $name){
    $start = strpos($source, "\nfunction ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $end = strpos($source, "\nfunction ", $start + 1);
    return substr($source, $start, ($end === false ? strlen($source) : $end) - $start);
}

$src = file_get_contents(__DIR__."/../index.php");
foreach(array("Make_tree", "Parse_block", "Asset_versions") as $fn)
    eval(extract_function_source($src, $fn));

$_SERVER["DOCUMENT_ROOT"] = realpath(__DIR__."/..");
$z = "my";

# На сервере шаблоны базы лежат в templates/custom/my/, в репозитории — в templates/my/.
function Get_file($file, $fatal=TRUE){
    foreach(array("/templates/my/", "/templates/") as $dir){
        $f = $_SERVER["DOCUMENT_ROOT"].$dir.$file;
        if(is_file($f))
            return Asset_versions(file_get_contents($f));
    }
    if($fatal) throw new Exception("no file $file");
    return "";
}

# Данные отчётов по имени блока (последний сегмент пути, без учёта регистра — Make_tree приводит
# имена блоков к нижнему, отчёт ищется сравнением в MySQL), как у Get_block_data → Compile_Report.
$REPORTS = array();
$API = FALSE;
function Get_block_data($block){
    global $blocks, $z, $REPORTS;
    if($block === "&main"){
        $blocks[$block]["z"][] = $z;
        return;
    }
    $parts = explode(".", $block);
    $name = end($parts);
    foreach($REPORTS as $rep => $rows)
        if(strtolower($rep) === $name)
            foreach($rows as $row)
                foreach($row as $col => $val)
                    $blocks[$block][strtolower($col)][] = $val;
}
function trace($text){}
function isApi(){ global $API; return $API; }
function BuiltIn($par){ return $par; }
function t9n($text){ return $text; }
function die_info($msg){ throw new Exception($msg); }

function render($vars, $reports, $api = FALSE){
    global $blocks, $z, $REPORTS, $API;
    $blocks = array();
    $_GET = $_REQUEST = array();
    $REPORTS = $reports;
    $API = $api;
    $GLOBALS["GLOBAL_VARS"] = array_merge(array("z"=>$z, "xsrf"=>"x", "token"=>"t", "id"=>"",
        "action"=>"", "grants"=>"e30=", "menu_layout"=>""), $vars);
    Make_tree(Get_file("main.html"), "&main");
    return Parse_block("&main");
}

$user  = array("user"=>"drynny", "role"=>"user", "role_id"=>"42", "user_id"=>"21787");
$admin = array("user"=>"boss", "role"=>"admin", "role_id"=>"145", "user_id"=>"17");
$super = array("user"=>"admin", "role"=>"admin", "role_id"=>"145", "user_id"=>"0");

$menu = array(array("menu_id"=>"1", "menu_up"=>"", "name"=>"Пользователи", "href"=>"object/18", "icon"=>"pi-users"));
$cab  = array(
    "noAdmin" => array(array("Role"=>"user", "limit"=>"5000")),
    "paidThisMonth" => array(array("Payment"=>"")),
    "plans" => array(array("PlanID"=>"1146", "Price"=>"0.00", "limit"=>"3000", "PlanName"=>"Знакомство"),
                     array("PlanID"=>"1147", "Price"=>"1950.00", "limit"=>"5000", "PlanName"=>"Стартап")));

$cases = array(
    "пользователь, отчёты с данными" => array($user, $cab),
    "пользователь, отчёты пустые" => array($user, array()),
    "админ, есть меню роли" => array($admin, array("MyRoleMenu" => $menu)),
    "суперадмин, все отчёты пустые" => array($super, array()),
);

foreach($cases as $title => $c){
    $page = render($c[0], $c[1]);
    expect(strlen($page) > 0 && strpos($page, "</body>") !== FALSE, "$title: страница отрисована целиком");
    expect(strpos($page, "{_block_.") === FALSE, "$title: нет незаполненных вложенных блоков");
    expect(strpos($page, 'id="my-body-cabinet"') !== FALSE, "$title: разметка ЛК на странице");
    expect(strpos($page, 'id="my-body-admin"') !== FALSE, "$title: разметка рабочего места админа на странице");
    expect(strpos($page, 'id="my-admin-home"') !== FALSE, "$title: стартовая страница админа (info.html) в &main.a");
    expect(preg_match('/<script[^>]+src="\/js\/my-mode\.js/', $page) === 1, "$title: режим выбирает js/my-mode.js");
}

$page = render($admin, array("MyRoleMenu" => $menu));
expect(strpos($page, "href:'object/18'") !== FALSE, "админ: пункты меню роли попали в menuData");

$page = render(array_merge($super, array("action"=>"object")), array());
expect(strpos($page, 'id="my-admin-home"') === FALSE && strpos($page, "</body>") !== FALSE,
    "суперадмин, действие object: в &main.a содержимое object.html, а не стартовая страница");

# Данные ЛК: /my/cabdata?JSON — main.html + cabdata.html в &main.a, ответ собирается из точек вставки
render(array_merge($user, array("action"=>"cabdata")), $cab, TRUE);
$api = isset($GLOBALS["GLOBAL_VARS"]["api"]) ? $GLOBALS["GLOBAL_VARS"]["api"] : array();
$plans = isset($api["&main.a.plans"]) ? $api["&main.a.plans"] : array();
expect(isset($plans["planid"]) && $plans["planid"] === array("1146", "1147"), "cabdata: идентификаторы тарифов");
expect(isset($plans["planname"]) && $plans["planname"][1] === "Стартап", "cabdata: названия тарифов");
expect(isset($plans["price"]) && isset($plans["limit"]), "cabdata: цена и лимит тарифа");
expect(isset($api["&main.a.paidthismonth"]["payment"]), "cabdata: оплата текущего месяца");
expect(isset($api["&main.a.noadmin"]["limit"]) && $api["&main.a.noadmin"]["limit"][0] === "5000", "cabdata: лимит тарифа пользователя");

echo $failures ? "\n$failures FAIL\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
