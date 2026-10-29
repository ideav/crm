<?php
# Перенос со старого Интеграма: загруженные файлы базы получают имена, по которым их ищет новое ядро.
# Ожидаемые имена считают настоящие GetSha/GetSubdir/GetFilename/Salt, вырезанные из index.php.
#
# Запуск: php experiments/old-integram-upload-names.test.php (в гейте — через одноимённый .test.js)

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

$src = file_get_contents(__DIR__."/../index.php");
$code = "";
foreach(["Salt", "GetSha", "GetSubdir", "GetFilename"] as $fn){
    if(!preg_match('/^function '.$fn.'\(.*?^\}/ms', $src, $m)){ echo "FAIL: нет функции $fn в index.php\n"; exit(1); }
    $code .= $m[0]."\n";
}
$z = "r7ohr";
define("SALT", "соль-установки");
define("UPLOAD_DIR", "download/$z/");
eval($code);
$core = function($id){ return GetSubdir($id)."/".GetFilename($id); };  # путь файла записи id в новом ядре

$root = sys_get_temp_dir()."/upnames-".getmypid();
$put = function($rel, $text) use ($root){ @mkdir(dirname("$root/$rel"), 0777, true); file_put_contents("$root/$rel", $text); };
# Имена старого ядра: папка floor(id/1000) + 8 знаков хеша, файл id%1000 (3 цифры) + 8 знаков + расширение.
$put("download/$z/900aa11bb22/001cc22dd33.pdf", "файл 900001");
$put("download/$z/900aa11bb22/417ee44ff55", "файл 900417 без расширения");
$put("download/$z/0deadbeef/007a1b2c3d4.tar.gz", "файл 7");   # id < 1000: папка «0…»
$put("download/$z/report.html", "шаблон в корне базы");
$put("download/$z/install.zip", "архив в корне базы");
$put("download/$z/notes/readme.txt", "своя папка");

$run = function() use ($root, $z){
    $out = []; $rc = 0;
    exec("INTEGRAM_SALT=".escapeshellarg(SALT)." php ".escapeshellarg(__DIR__."/../scripts/old-integram-upload-names.php")
        ." $z ".escapeshellarg($root)." 2>&1", $out, $rc);
    return [$rc, implode("\n", $out)];
};
[$rc, $out] = $run();
echo $out, "\n";
expect($rc === 0, "скрипт завершился без ошибки");
expect(@file_get_contents("$root/".$core(900001).".pdf") === "файл 900001", "файл 900001 лежит там, куда ведёт ссылка нового ядра");
expect(@file_get_contents("$root/".$core(900417)) === "файл 900417 без расширения", "файл без расширения переименован");
expect(@file_get_contents("$root/".$core(7).".tar.gz") === "файл 7", "id < 1000, двойное расширение сохранено");
expect(!is_dir("$root/download/$z/900aa11bb22") && !is_dir("$root/download/$z/0deadbeef"), "опустевшие папки старых имён удалены");
expect(is_file("$root/download/$z/report.html") && is_file("$root/download/$z/install.zip")
    && is_file("$root/download/$z/notes/readme.txt"), "файлы, не похожие на загруженные, не тронуты");

[$rc, $out] = $run();
expect($rc === 0 && strpos($out, "переименовано 0, уже на месте 3") !== false, "повторный запуск ничего не меняет: $out");

exec("rm -rf ".escapeshellarg($root));
exit($failures ? 1 : 0);
