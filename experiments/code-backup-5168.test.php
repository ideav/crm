<?php
# Мерка к issue #5168: архивация файлов базы (templates + download) и восстановление из архива.
# https://github.com/ideav/crm/issues/5168
#
# Запуск: php experiments/code-backup-5168.test.php (в гейте — через одноимённый .test.js)
#
# Функции берутся из index.php как есть. Проверяется:
#   A) Code_backup кладёт в backups архив <база>_<дата>.code.zip и берёт в него: шаблоны в корне
#      templates/custom/<база> (подпапки — backups, logs — не входят), фронт в корне download/<база>
#      — только js, css, conf, json, html (загруженные в корень архивы и документы не входят),
#      подпапки download/<база> целиком, с вложенностью;
#   B) Code_restore_apply переносит архив в ДРУГУЮ базу: шаблоны и download записаны по своим
#      путям, одноимённые перезаписаны, файлы вне архива не тронуты; прежние файлы сохранены
#      страховочным архивом .code.zip;
#   C) чужой путь в архиве (.., не templates/ и не download/) — отказ до всякой записи,
#      страховочный архив не снимается, ничего не записано;
#   D) права: не владелец и не супер-админ — отказ, файлы не тронуты; владелец и супер-админ
#      сервера (user_id 0) — можно;
#   E) страховочный архив не записался — отказ, файлы не тронуты;
#   F) пустой архив — отказ; Code_backup_listing отдаёт состав с маркером CODE BACKUP и TOTAL.

$failures = 0;
ob_start();  # Code_restore_apply шлёт header(): без буфера в CLI это предупреждение
function expect($cond, $name, $detail = ""){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name".($detail !== "" ? " — $detail" : "")."\n"; $failures++; }
}
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function wlog($text, $mode="log"){}

# Без расширения zip — архив как сериализованный массив имя → содержимое
if(!class_exists("ZipArchive")){
    class ZipArchive {
        const CREATE = 1;
        public $numFiles = 0;
        private $p; private $files = array();
        function open($p, $flags=0){
            if(is_dir($p) || !is_dir(dirname($p)))
                return FALSE;  # на месте архива каталог / некуда писать — как настоящий ZipArchive
            $this->p = $p;
            $this->files = is_file($p) ? unserialize(file_get_contents($p)) : array();
            $this->numFiles = count($this->files);
            return TRUE;
        }
        function addFile($src, $name){ $this->files[$name] = file_get_contents($src); }
        function addFromString($name, $content){ $this->files[$name] = $content; }
        function getNameIndex($i){ $n = array_keys($this->files); return $i < count($n) ? $n[$i] : FALSE; }
        function statIndex($i){ $n = array_keys($this->files); return $i < count($n) ? array("name" => $n[$i], "size" => strlen($this->files[$n[$i]])) : FALSE; }
        function extractTo($dir){
            foreach($this->files as $n => $c){
                $d = "$dir/".dirname($n);
                if(!is_dir($d)) @mkdir($d, 0777, TRUE);
                file_put_contents("$dir/$n", $c);
            }
        }
        function close(){ $this->numFiles = count($this->files); file_put_contents($this->p, serialize($this->files)); }
    }
}

# ── Функции из ядра ──────────────────────────────────────────────────────────────────────────
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
$source = file_get_contents(__DIR__."/../index.php");
foreach(array("Code_backup", "Code_backup_dir", "Code_backup_listing", "Code_rm_dir", "Code_restore_apply",
              "Restore_allowed") as $fn){
    try {
        eval(extract_function_source($source, $fn));
    } catch(Exception $e){
        echo "FAIL: в index.php нет функции $fn (".$e->getMessage().")\n";
        exit(1);
    }
}

$work = sys_get_temp_dir()."/codebackup5168_".getmypid();
@mkdir($work);
chdir($work);
function use_db($db){
    $GLOBALS["z"] = $db;
    @mkdir("templates/custom/$db/backups", 0777, TRUE);
    @mkdir("download/$db", 0777, TRUE);
}
function as_user($user, $id){ $GLOBALS["GLOBAL_VARS"] = array("user"=>$user, "user_id"=>$id); }
function backups($db){ return array_values(array_diff(scandir("templates/custom/$db/backups"), array(".", ".."))); }
# Имена элементов архива (распаковывать не обязательно — элементы известны по open)
function zip_names($file){
    $zip = new ZipArchive;
    if($zip->open($file) !== TRUE)
        return FALSE;
    $n = array();
    for($i = 0; $i < $zip->numFiles; $i++)
        $n[] = $zip->getNameIndex($i);
    $zip->close();
    return $n;
}
# Содержимое элемента архива
function zip_content($file, $name){
    $zip = new ZipArchive;
    $zip->open($file);
    $tmp = sys_get_temp_dir()."/codebackup5168_x_".getmypid();
    Code_rm_dir($tmp);
    @mkdir($tmp, 0777, TRUE);
    $zip->extractTo($tmp);
    $zip->close();
    $c = is_file("$tmp/$name") ? file_get_contents("$tmp/$name") : NULL;
    Code_rm_dir($tmp);
    return $c;
}
# Архив из пар имя → содержимое (подложить в backups чужой/битый архив)
function craft_zip($file, $pairs){
    $zip = new ZipArchive;
    $zip->open($file, ZipArchive::CREATE);
    foreach($pairs as $n => $c)
        $zip->addFromString($n, $c);
    $zip->close();
}

# ── A. Состав архива ─────────────────────────────────────────────────────────────────────────
use_db("cb5168");
file_put_contents("templates/custom/cb5168/main.html", "шаблон main");
file_put_contents("templates/custom/cb5168/form.html", "форма");
file_put_contents("templates/custom/cb5168/backups/чужой.dmp.zip", "дамп");  # подпапка — не брать
@mkdir("templates/custom/cb5168/logs");
file_put_contents("templates/custom/cb5168/logs/x.log", "лог");              # подпапка — не брать
file_put_contents("download/cb5168/app.js", "console.log(1);");
file_put_contents("download/cb5168/style.css", "body{}");
file_put_contents("download/cb5168/cfg.json", "{}");
file_put_contents("download/cb5168/params.conf", "a=1");
file_put_contents("download/cb5168/index.html", "<html>");
file_put_contents("download/cb5168/report.docx", "документ");                # корень, не фронт — не брать
file_put_contents("download/cb5168/photo.zip", "архив");                     # корень, не фронт — не брать
@mkdir("download/cb5168/js");
file_put_contents("download/cb5168/js/lib.js", "библиотека");                # подпапка — взять
@mkdir("download/cb5168/upload/000", 0777, TRUE);
file_put_contents("download/cb5168/upload/000/x.txt", "файл пользователя");  # вложенная подпапка — взять
file_put_contents("download/cb5168/upload/000/y.dat", "данные");
$name = Code_backup();
expect(preg_match('/^cb5168_\d{8}_\d{6}\.code\.zip$/', $name) && is_file("templates/custom/cb5168/backups/$name"),
    "A: Code_backup кладёт архив <база>_<дата>.code.zip в backups");
$names = zip_names("templates/custom/cb5168/backups/$name");
sort($names);
expect($names == array("download/app.js", "download/cfg.json", "download/index.html", "download/js/lib.js",
        "download/params.conf", "download/style.css", "download/upload/000/x.txt", "download/upload/000/y.dat",
        "templates/form.html", "templates/main.html"),
    "A: в архиве шаблоны корня templates, фронт корня download (js, css, conf, json, html) и подпапки download; "
    ."документы и архивы в корне download и подпапки templates не вошли", json_encode($names));

# ── B. Перенос в другую базу ─────────────────────────────────────────────────────────────────
use_db("new5168");
file_put_contents("templates/custom/new5168/main.html", "СТАРЫЙ шаблон");
file_put_contents("download/new5168/app.js", "старый фронт");
file_put_contents("download/new5168/keep.txt", "свой документ");  # вне архива — не тронуть
copy("templates/custom/cb5168/backups/$name", "templates/custom/new5168/backups/$name");
as_user("new5168", "1001");
$res = Code_restore_apply($name);
expect(isset($res["result"]) && $res["result"] === "ok" && $res["files"] === 10, "B: ответ ok с числом файлов");
expect(file_get_contents("templates/custom/new5168/main.html") === "шаблон main"
    && file_get_contents("templates/custom/new5168/form.html") === "форма",
    "B: шаблоны записаны в templates/custom/new5168, одноимённый перезаписан");
expect(file_get_contents("download/new5168/app.js") === "console.log(1);"
    && file_get_contents("download/new5168/upload/000/x.txt") === "файл пользователя"
    && file_get_contents("download/new5168/js/lib.js") === "библиотека",
    "B: фронт и подпапки download записаны по своим путям");
expect(file_get_contents("download/new5168/keep.txt") === "свой документ" && !is_file("download/new5168/report.docx"),
    "B: файлы вне архива не тронуты и не удалены");
$safety = isset($res["backup"]) ? $res["backup"] : "";
expect(preg_match('/^new5168_\d{8}_\d{6}\.code\.zip$/', $safety) && in_array($safety, backups("new5168"), TRUE)
    && zip_content("templates/custom/new5168/backups/$safety", "templates/main.html") === "СТАРЫЙ шаблон"
    && zip_content("templates/custom/new5168/backups/$safety", "download/app.js") === "старый фронт",
    "B: прежние файлы сохранены страховочным архивом .code.zip");

# ── C. Чужой путь в архиве ───────────────────────────────────────────────────────────────────
use_db("sec5168");
file_put_contents("download/sec5168/a.js", "мой фронт");
craft_zip("templates/custom/sec5168/backups/evil.code.zip",
    array("../evil.txt" => "зло", "evil/inside.txt" => "зло", "download/../../evil2.txt" => "зло"));
$before = backups("sec5168");
as_user("sec5168", "1001");
$res = Code_restore_apply("evil.code.zip");
expect(isset($res["error"]), "C: чужой путь в архиве — отказ");
expect(!is_file("evil.txt") && !is_file("templates/custom/sec5168/evil.txt") && !is_file("evil2.txt")
    && !is_file("sec5168/inside.txt") && file_get_contents("download/sec5168/a.js") === "мой фронт",
    "C: ничего не записано, файлы не тронуты");
expect(backups("sec5168") == $before, "C: до записи страховочный архив не снимается");

# ── D. Права ─────────────────────────────────────────────────────────────────────────────────
use_db("own5168");
file_put_contents("templates/custom/own5168/main.html", "мой шаблон");
file_put_contents("download/own5168/app.js", "мой фронт");
$own = Code_backup();
$ownTemplates = file_get_contents("templates/custom/own5168/main.html");
as_user("bob", "1777");
$res = Code_restore_apply($own);
expect(isset($res["error"]) && file_get_contents("templates/custom/own5168/main.html") === $ownTemplates,
    "D: обычный пользователь — отказ, файлы не тронуты");
as_user("own5168", "1001");
sleep(1);
$res = Code_restore_apply($own);
expect(isset($res["result"]) && $res["result"] === "ok", "D: владелец базы восстанавливает файлы");
as_user("admin", 0);
sleep(1);
$res = Code_restore_apply($own);
expect(isset($res["result"]) && $res["result"] === "ok", "D: супер-админ сервера (user_id 0) восстанавливает файлы");

# ── E. Страховочный архив не записался ───────────────────────────────────────────────────────
use_db("ro5168");
file_put_contents("templates/custom/ro5168/main.html", "мой шаблон");
file_put_contents("download/ro5168/app.js", "мой фронт");
$src = "ro5168_20260101_000000.code.zip";
copy("templates/custom/own5168/backups/$own", "templates/custom/ro5168/backups/$src");
# На месте архива, который Code_backup попытается создать, — каталоги (окно ±2 с: имя архива с точностью до секунды)
for($s = -2; $s <= 2; $s++)
	mkdir("templates/custom/ro5168/backups/ro5168_".date("Ymd_His", time() + $s).".code.zip");
as_user("ro5168", "1001");
$res = Code_restore_apply($src);
expect(isset($res["error"]) && file_get_contents("templates/custom/ro5168/main.html") === "мой шаблон"
    && file_get_contents("download/ro5168/app.js") === "мой фронт",
    "E: страховочный архив не записался — отказ, файлы не тронуты");

# ── F. Пустой архив и состав от Code_backup_listing ──────────────────────────────────────────
use_db("empty5168");
craft_zip("templates/custom/empty5168/backups/empty.code.zip", array());
as_user("empty5168", "1001");
$res = Code_restore_apply("empty.code.zip");
expect(isset($res["error"]), "F: пустой архив — отказ");
use_db("cb5168");
$list = Code_backup_listing($name);
expect(strpos($list, "CODE BACKUP $name") === 0 && strpos($list, "templates/main.html") !== FALSE
    && strpos($list, "download/upload/000/x.txt") !== FALSE && strpos($list, "TOTAL 10") !== FALSE,
    "F: Code_backup_listing — маркер CODE BACKUP, пути, TOTAL");
expect(strpos(Code_backup_listing("нет-такого.code.zip"), "CODE BACKUP") === FALSE,
    "F: несуществующий архив — без маркера, окно не даст применить");

echo $failures ?"\n$failures FAIL\n" : "\nOK\n";
exit($failures ? 1 : 0);
