<?php
# Мерка к issue #5231: главная страница пустая — {_block_.&main.a} не заполнен.
# https://github.com/ideav/crm/issues/5231
#
# Запуск: php experiments/main-template-renders-5231.test.php (в гейте — через одноимённый .test.js)
#
# Шаблонизатор (Make_tree/Parse_block из index.php) прерывает разбор блока на первой точке
# вставки {имя} без значения, а блок с незаполненной точкой отбрасывает целиком. В main.html
# верхний блок &main получает только z и {_global_.*}; любая другая {имя} на верхнем уровне,
# даже внутри HTML-комментария или скрипта, гасит всю страницу (с ?debug виден голый
# {_block_.&main.a}). Правило проверяется на всех действиях, которые главная грузит в &main.a:
#   1) страница не пустая и в ней нет незаполненных {_block_.*};
#   2) содержимое действия (по умолчанию info.html) попало на страницу;
#   3) то же в ?debug — разбор дошёл до вложенного блока.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

# Тело функции — до следующего определения на верхнем уровне: в Parse_block фигурные скобки
# встречаются в строках ("{", "&#123;"), подсчёт скобок на нём сбивается.
function extract_function_source($source, $name){
    $start = strpos($source, "
function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $end = strpos($source, "
function ", $start + 1);
    return substr($source, $start, ($end === false ? strlen($source) : $end) - $start);
}

$src = file_get_contents(__DIR__."/../index.php");
foreach(array("Make_tree", "Parse_block", "Get_file") as $fn)
    eval(extract_function_source($src, $fn));

# Окружение: данные блоков — как у Get_block_data для &main (имя базы), прочие блоки без данных.
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

$_SERVER["DOCUMENT_ROOT"] = realpath(__DIR__."/..");
$z = "shop5231";

function render($action, $debug){
    global $blocks, $z;
    $blocks = array();
    $_GET = $_REQUEST = array();
    if($debug)
        $_REQUEST["debug"] = "";
    $GLOBALS["GLOBAL_VARS"] = array("z"=>$z, "user"=>"user", "role"=>"user", "role_id"=>"1",
        "user_id"=>"2", "action"=>$action, "xsrf"=>"x", "token"=>"t", "grants"=>"e30=", "menu_layout"=>"");
    Make_tree(Get_file("main.html"), "&main");
    return Parse_block("&main");
}

# Действия, которые main.html грузит в &main.a: пустое (главная, info.html) и шаблоны рабочих мест
$actions = array("" => "info.html");
foreach(glob($_SERVER["DOCUMENT_ROOT"]."/templates/*.html") as $f){
    $name = basename($f, ".html");
    $text = file_get_contents($f);
    # Самостоятельные страницы (свой <html>) в &main.a не встраиваются
    if(preg_match("/<html[\s>]/i", $text) || $name === "info")
        continue;
    $actions[$name] = "$name.html";
}

foreach($actions as $action => $file){
    $page = render($action, FALSE);
    expect(strlen($page) > 0, "действие '$action' ($file): страница не пустая");
    expect(strpos($page, "{_block_.") === FALSE, "действие '$action' ($file): нет незаполненных вложенных блоков");
}

$page = render("", FALSE);
expect(strpos($page, "info-tabs-container") !== FALSE, "главная: содержимое info.html на странице");
expect(strpos($page, "app-sidebar") !== FALSE || strpos($page, "</body>") !== FALSE, "главная: каркас main.html на странице");

$page = render("", TRUE);
expect(strpos($page, "{_block_.&main.a}") === FALSE, "?debug: вложенный блок &main.a разобран");

echo $failures ? "\n$failures FAIL\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
