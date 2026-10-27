<?php
# Мерка: шаблонизатор (Make_tree/Parse_block/Get_file из index.php) и ввод из запроса.
#
# Запуск: php experiments/templater-request-input.test.php (в гейте — через одноимённый .test.js)
#
# Правила:
#   1) <!-- File: X --> с параметром ?X=… подключает только файл с именем из [A-Za-z0-9_-]:
#      путь с ../ или иными символами не выходит за templates/ — берётся файл по умолчанию X.html;
#   2) Get_file не открывает имя с «..» или нулевым байтом;
#   3) {_request_.имя} подставляется экранированным для HTML и без переводов строк
#      (значение стоит и в атрибутах, и внутри <script> после //);
#   4) {_global_.http_user_agent} и прочие значения из заголовков запроса — экранированы;
#   5) обычные значения (?tab=2, ?X=имя_файла) работают как раньше.

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
foreach(array("Make_tree", "Parse_block", "Get_file", "Asset_versions", "BuiltIn") as $fn)
    eval(extract_function_source($src, $fn));

function Get_block_data($block){}
function trace($text){}
function isApi(){ return FALSE; }
function t9n($text){ return $text; }
function die_info($msg){ throw new Exception($msg); }

# Песочница: DOCUMENT_ROOT/templates/{common,custom/db}, секрет — вне templates/
$root = sys_get_temp_dir()."/tplsec".getmypid();
@mkdir("$root/templates/custom/db", 0777, true);
file_put_contents("$root/secret.html", "SECRET-OUTSIDE");
file_put_contents("$root/templates/panel.html", "DEFAULT-PANEL");
file_put_contents("$root/templates/alt_panel-2.html", "ALT-PANEL");
file_put_contents("$root/templates/info.html", "INFO");
$_SERVER["DOCUMENT_ROOT"] = $root;
$z = "db";
$GLOBALS["tzone"] = 0;

function render($text, $get){
    global $blocks;
    $blocks = array();
    $_GET = $_REQUEST = $get;
    $_POST = array();
    $GLOBALS["GLOBAL_VARS"] = array("z"=>"db", "user"=>"u", "action"=>"");
    Make_tree($text, "&main");
    return Parse_block("&main");
}

# 1. File: имя из параметра
$tpl = "[<!-- File: panel -->]";
expect(strpos(render($tpl, array()), "DEFAULT-PANEL") !== FALSE, "File без параметра — panel.html");
expect(strpos(render($tpl, array("panel"=>"alt_panel-2")), "ALT-PANEL") !== FALSE, "File: ?panel=alt_panel-2 подключает alt_panel-2.html");
foreach(array("../../../secret", "..\\..\\..\\secret", "../../custom/db/../../../secret") as $evil){
    $out = render($tpl, array("panel"=>$evil));
    expect(strpos($out, "SECRET-OUTSIDE") === FALSE, "File: ?panel=$evil не выходит за templates/");
    expect(strpos($out, "DEFAULT-PANEL") !== FALSE, "File: ?panel=$evil — берётся panel.html");
}

# 2. Get_file
expect(Get_file("../../../secret.html", FALSE) === "", "Get_file не открывает ../");
expect(Get_file("panel.html\0.txt", FALSE) === "", "Get_file не открывает имя с нулевым байтом");
expect(Get_file("panel.html", FALSE) === "DEFAULT-PANEL", "Get_file открывает обычное имя");

# 3. _request_
$tpl = "<!-- Begin: _T --><input value=\"{_request_.tab}\"><script>//{_request_.tab}\n</script><!-- End: _T -->";
$out = render($tpl, array("tab"=>"2"));
expect(strpos($out, "value=\"2\"") !== FALSE, "_request_: ?tab=2 подставляется как есть");
$out = render($tpl, array("tab"=>"\"><img src=x onerror=alert(1)>"));
expect(strpos($out, "<img") === FALSE && strpos($out, "value=\"&quot;&gt;&lt;img") !== FALSE, "_request_: разметка экранирована");
$out = render($tpl, array("tab"=>"x\nalert(1)"));
expect(strpos($out, "//x alert(1)\n</script>") !== FALSE, "_request_: перевод строки не выводит из //-комментария");
$out = render($tpl, array("tab"=>"'"));
expect(strpos($out, "'") === FALSE, "_request_: одинарная кавычка экранирована");
$out = render($tpl, array("tab"=>array("a")));
expect(strpos($out, "Array") === FALSE, "_request_: массив не подставляется");

# 4. _global_ из заголовков
$_SERVER["HTTP_USER_AGENT"] = "<script>alert(1)</script>";
$out = render("<!-- Begin: _U -->[{_global_.http_user_agent}]<!-- End: _U -->", array());
expect(strpos($out, "<script>") === FALSE && strpos($out, "&lt;script&gt;") !== FALSE, "_global_.http_user_agent экранирован");
$out = render("<!-- Begin: _D -->[{_global_.today}]<!-- End: _D -->", array());
expect(preg_match("/\[\d\d\.\d\d\.\d{4}\]/", $out) === 1, "_global_.today — дата как раньше");

array_map("unlink", glob("$root/templates/*.html"));
@unlink("$root/secret.html");

echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
