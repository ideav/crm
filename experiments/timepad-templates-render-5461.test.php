<?php
# Мерка к issue #5461: шаблоны базы timepad разбираются шаблонизатором ядра без потерь.
# https://github.com/ideav/crm/issues/5461
#
# Запуск: php experiments/timepad-templates-render-5461.test.php (в гейте — через одноимённый .test.js)
#
# templates/timepad/*.html на сервере лежат в templates/custom/timepad/ и встраиваются в
# templates/main.html как &main.a. Точка вставки {имя} без значения (даже в JS или комментарии)
# гасит блок целиком (#5231), поэтому шаблоны прогоняются через настоящие Make_tree/Parse_block:
#   1) главная (info.html) у организатора — сводка событий на странице, блоки разобраны;
#   2) главная у гостя — та же страница с переходом гостя на афишу;
#   3) afisha.html — контейнер приложения и скрипт download/timepad/app.js на странице.

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

$repo = realpath(__DIR__."/..");
$src = file_get_contents("$repo/index.php");
foreach(array("Make_tree", "Parse_block", "Get_file", "Asset_versions") as $fn)
    eval(extract_function_source($src, $fn));

function Get_block_data($block){
    global $blocks, $z;
    if($block === "&main")
        $blocks[$block]["z"][] = $z;
}
function trace($text){}
function isApi(){ return FALSE; }
function BuiltIn($par){ return $par; }
function t9n($text){ return $text; }
function die_info($msg){ throw new Exception($msg); }

# Корень сайта как на сервере: общий main.html + каталог базы templates/custom/timepad
$root = sys_get_temp_dir()."/timepad-5461-".getmypid();
@mkdir("$root/templates/custom/timepad", 0777, true);
copy("$repo/templates/main.html", "$root/templates/main.html");
foreach(glob("$repo/templates/timepad/*.html") as $f)
    copy($f, "$root/templates/custom/timepad/".basename($f));
$_SERVER["DOCUMENT_ROOT"] = $root;
$z = "timepad";

function render($action, $user){
    global $blocks, $z;
    $blocks = array();
    $_GET = $_REQUEST = array();
    $GLOBALS["GLOBAL_VARS"] = array("z"=>$z, "user"=>$user, "role"=>$user, "role_id"=>"1",
        "user_id"=>"2", "action"=>$action, "xsrf"=>"x", "token"=>"t", "grants"=>"e30=", "menu_layout"=>"");
    Make_tree(Get_file("main.html"), "&main");
    return Parse_block("&main");
}

$page = render("", "claude");
expect(strpos($page, 'id="tpList"') !== FALSE, "главная у организатора: сводка событий на странице");
expect(strpos($page, "{_block_.") === FALSE, "главная у организатора: блоки разобраны");
expect(strpos($page, "if('claude'==='guest')") !== FALSE, "главная у организатора: имя пользователя подставлено");

$page = render("", "guest");
expect(strpos($page, "if('guest'==='guest') location.replace('/timepad/afisha')") !== FALSE, "главная у гостя: переход на афишу");

$page = render("afisha", "guest");
expect(strpos($page, 'id="tp-root"') !== FALSE, "афиша: контейнер приложения на странице");
expect(strpos($page, '/download/timepad/app.js') !== FALSE, "афиша: скрипт приложения подключён");
expect(strpos($page, "{_block_.") === FALSE, "афиша: блоки разобраны");

foreach(glob("$root/templates/custom/timepad/*") as $f) unlink($f);
@rmdir("$root/templates/custom/timepad"); @rmdir("$root/templates/custom");
@unlink("$root/templates/main.html"); @rmdir("$root/templates"); @rmdir($root);

echo $failures ? "\n$failures FAIL\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
