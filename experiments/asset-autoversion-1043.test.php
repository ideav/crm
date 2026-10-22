<?php
# Мерка (python2node#1043): подключения общих /js/*.js и /css/*.css без версии получают ?v=<время
# изменения файла>, когда ядро отдаёт шаблон. Статику прод отдаёт с Cache-Control immutable на год:
# без смены адреса браузер не видит правку ядра (HttpOnly-кука ломала выход старым main-app.js).
#   A) голое подключение получает версию по времени изменения файла;
#   B) подключение с версией, чужой хост, загрузки базы, несуществующий файл и «..» не трогаются;
#   C) новый файл — новый адрес.
#
# Запуск: php experiments/asset-autoversion-1043.test.php (в гейте — через одноимённый .test.js)
# INDEX_PHP=<путь> — проверить другую версию ядра.

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
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}
$source = file_get_contents(getenv("INDEX_PHP") ?: __DIR__."/../index.php");
try { eval(extract_function_source($source, "Asset_versions")); }
catch(Exception $e){ echo "FAIL: в index.php нет функции Asset_versions\n\n1 FAILED\n"; exit(1); }

$root = sys_get_temp_dir()."/av1043_".getmypid();
@mkdir("$root/js", 0777, TRUE); @mkdir("$root/css", 0777, TRUE);
file_put_contents("$root/js/main-app.js", "x"); touch("$root/js/main-app.js", 1800000000);
file_put_contents("$root/css/main.css", "x"); touch("$root/css/main.css", 1800000100);
$_SERVER["DOCUMENT_ROOT"] = $root;

$out = Asset_versions('<script src="/js/main-app.js"></script><link href=\'/css/main.css\' rel="stylesheet">');
expect(strpos($out, 'src="/js/main-app.js?v=1800000000"') !== FALSE, "A: скрипт без версии получил ?v=<mtime>");
expect(strpos($out, "href='/css/main.css?v=1800000100'") !== FALSE, "A: стиль без версии получил ?v=<mtime>");

foreach(array('<script src="/js/main-app.js?v=5222"></script>', '<script src="https://cdn.example.com/js/main-app.js"></script>',
              '<script src="/download/abc/js/main-app.js"></script>', '<script src="/js/nope.js"></script>',
              '<script src="/js/../index.php"></script>', "var s='/js/main-app.js';") as $keep)
    expect(Asset_versions($keep) === $keep, "B: не трогается: $keep");

touch("$root/js/main-app.js", 1800000500);
clearstatcache();
expect(strpos(Asset_versions('<script src="/js/main-app.js"></script>'), "?v=1800000500") !== FALSE, "C: новый файл — новый адрес");

foreach(array("$root/js/main-app.js", "$root/css/main.css") as $f) @unlink($f);
@rmdir("$root/js"); @rmdir("$root/css"); @rmdir($root);
echo $failures ? "\n$failures FAILED\n" : "\nALL PASSED\n";
exit($failures ? 1 : 0);
