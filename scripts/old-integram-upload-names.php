<?php
# Перенос со старого Интеграма: загруженные файлы базы (колонки типа «Файл») под имена нового ядра.
#
#   php scripts/old-integram-upload-names.php <база> <корень сайта>
#
# Оба ядра хранят файл записи <id> как download/<база>/<папка>/<файл>:
#   папка = floor(id/1000) . 8 знаков хеша,  файл = последние 3 цифры id . 8 знаков хеша [. расширение]
# (GetSubdir/GetFilename в index.php). Хеш старого ядра — sha1 с солью старой установки, нового —
# sha512(SALT.<база>.<число>) с солью этой установки, поэтому после копирования ссылки нового ядра
# ведут мимо файлов. id однозначно читается из пути (хеш — ровно 8 последних знаков), по нему
# считается новое имя. Файлы, не похожие на загруженные (шаблоны, архивы в корне download/<база>),
# не трогаются. Повторный запуск ничего не меняет.

function env($name, $default = ''){
    $v = getenv($name);
    return ($v === false || $v === '') ? $default : $v;
}
$z = $argv[1] ?? '';
$root = rtrim($argv[2] ?? '', '/');
if(!preg_match('/^[A-Za-z0-9_]+$/', $z) || !is_dir($root)){
    file_put_contents('php://stderr', "СТОП: php scripts/old-integram-upload-names.php <база> <корень сайта>\n");
    exit(1);
}
$salt = env('INTEGRAM_SALT', 'yyy');  # как define("SALT") в include/connection.php
$sha = function($i) use ($salt, $z){ return hash("sha512", $salt.$z.$i); };  # GetSha нового ядра
$subdir = function($id) use ($sha){ return floor($id / 1000).substr($sha(floor($id / 1000)), 0, 8); };
$fname = function($id) use ($sha){ return substr("00$id", -3).substr($sha($id), 0, 8); };

$base = "$root/download/$z";
$moved = $kept = 0;
foreach(is_dir($base) ? scandir($base) : [] as $d){
    if(!preg_match('/^(\d+)[0-9a-f]{8}$/', $d, $md) || !is_dir("$base/$d"))
        continue;
    foreach(scandir("$base/$d") as $f){
        if(!preg_match('/^(\d{3})[0-9a-f]{8}(\..+)?$/', $f, $mf) || !is_file("$base/$d/$f"))
            continue;
        $id = (int)$md[1] * 1000 + (int)$mf[1];
        $newDir = $subdir($id);
        $newFile = $fname($id).($mf[2] ?? '');
        if("$newDir/$newFile" === "$d/$f"){
            $kept++;
            continue;
        }
        if(!is_dir("$base/$newDir"))
            mkdir("$base/$newDir", 0755);
        if(file_exists("$base/$newDir/$newFile")){
            echo "ВНИМАНИЕ: файл записи $id: $newDir/$newFile уже есть, $d/$f оставлен\n";
            continue;
        }
        rename("$base/$d/$f", "$base/$newDir/$newFile");
        $moved++;
    }
    if(count(scandir("$base/$d")) === 2)
        rmdir("$base/$d");
}
echo "загруженные файлы: переименовано $moved, уже на месте $kept\n";
