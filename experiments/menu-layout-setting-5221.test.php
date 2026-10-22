<?php
# Мерка к issue #5221: раскладка меню базы — файл templates/custom/{db}/_menu_layout.html.
# https://github.com/ideav/crm/issues/5221
#
# Запуск: php experiments/menu-layout-setting-5221.test.php (в гейте — через одноимённый .test.js)
#
# Menu_layout_setting из index.php берётся как есть; корень сайта — временный каталог.
#   1) файла нет — пусто (раскладка по умолчанию);
#   2) одно слово top/left/auto — оно, без пробелов, переводов строк и регистра;
#   3) любое другое содержимое — пусто (в шаблон не попадает);
#   4) файл другой базы не влияет; имя базы не выходит за каталог custom.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false) return "function $name(){ return 'NOT_DEFINED'; }";
    $brace = strpos($source, "{", $start);
    $depth=0; $len=strlen($source);
    for($i=$brace;$i<$len;$i++){
        if($source[$i]==="{") $depth++;
        elseif($source[$i]==="}"){ $depth--; if($depth===0) return substr($source,$start,$i-$start+1); }
    }
    throw new Exception("not closed: ".$name);
}

$src = file_get_contents(__DIR__."/../index.php");
eval(extract_function_source($src, "Menu_layout_setting"));

$root = sys_get_temp_dir()."/ml5221_".getmypid();
@mkdir("$root/templates/custom/shop", 0777, true);
@mkdir("$root/templates/custom/other", 0777, true);
$_SERVER["DOCUMENT_ROOT"] = $root;
$file = "$root/templates/custom/shop/_menu_layout.html";

function setting($db){ global $z; $z = $db; return Menu_layout_setting(); }

expect(setting("shop") === "", "файла нет — пусто");

foreach(array("auto"=>"auto", "top"=>"top", "left"=>"left", " AUTO \r\n"=>"auto", "\xEF\xBB\xBFtop\n"=>"top") as $content=>$want){
    file_put_contents($file, $content);
    expect(setting("shop") === $want, "содержимое ".json_encode($content)." → $want");
}

foreach(array("", "centre", "auto top", "<b>auto</b>", "auto\"><script>alert(1)</script>") as $content){
    file_put_contents($file, $content);
    expect(setting("shop") === "", "содержимое ".json_encode($content)." → пусто");
}

file_put_contents($file, "top");
file_put_contents("$root/templates/custom/other/_menu_layout.html", "auto");
expect(setting("other") === "auto" && setting("shop") === "top", "у каждой базы свой файл");
expect(setting("../custom/shop") === "" && setting("") === "", "имя базы вне маски — пусто");

array_map("unlink", glob("$root/templates/custom/*/_menu_layout.html"));
@rmdir("$root/templates/custom/shop"); @rmdir("$root/templates/custom/other");
@rmdir("$root/templates/custom"); @rmdir("$root/templates"); @rmdir($root);

if($failures){ echo "\n$failures FAIL\n"; exit(1); }
echo "\nOK\n";
