<?php
# Мерка к issue #5364: шаблоны баз — фиксация версии владельцем, модерация, развёртывание из снимка.
# https://github.com/ideav/crm/issues/5364
#
# Запуск: php experiments/db-templates-5364.test.php (в гейте — через одноимённый .test.js)
#
# Функции берутся из index.php как есть; MySQL заменён таблицами в памяти (строки id/up/t/ord/val
# на каждую базу), запросы различаются по метке в Exec_sql. Проверяется:
#   A) публиковать может только владелец базы (или супер-админ), не из my, с допустимым именем;
#      системное имя (из TEMPLATES) — только супер-админ; имя чужого шаблона занять нельзя;
#   B) снимок: в дампе нет пользователей, их реквизитов, секретов записей (пароль, токен, xsrf,
#      Secret) и ссылок на пользователей; реквизиты этих типов в схеме и прочие данные — есть;
#      в архиве файлов — шаблоны и download базы; в backups исходной базы ничего не остаётся;
#   C) модерация: версия на модерации в ЛК не видна и не разворачивается; одобряет модератор в my,
#      владелец свою версию одобрить не может; список ЛК — одобренные без истории версий;
#   D) развёртывание: новая база — ровно строки снимка (кавычки, переводы строк), файлы на местах;
#      правка исходной базы после фиксации в развёрнутую не попадает до одобрения новой версии;
#   E) снятие версии владельцем откатывает текущую на предыдущую одобренную; снятую не одобрить;
#   F) архив шаблона с чужим путём — отказ до создания таблицы.

$failures = 0;
ob_start();  # Tpl_publish / Tpl_set_status шлют header(): без буфера в CLI это предупреждение
function expect($cond, $name, $detail = ""){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name".($detail !== "" ? " — $detail" : "")."\n"; $failures++; }
}
foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "ACTIVITY"=>124, "TOKEN"=>125, "SECRET"=>130,
              "DATABASE"=>271, "RETRIES"=>301) as $k => $v)
    define($k, $v);
define("TEMPLATES", ":en:ru:fu:cm:");
define("TPL_MODERATORS", ":boss:");
define("ADMINEMAIL", "admin@example.com");
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function wlog($text, $mode="log"){}
function mysendmail($to, $subj, $msg){ $GLOBALS["MAILS"][] = $subj; }

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

# ── Таблицы баз в памяти и Exec_sql по меткам запросов ─────────────────────────────────────
function row($id, $up, $ord, $t, $val){ return array("id"=>"$id", "up"=>"$up", "t"=>"$t", "ord"=>"$ord", "val"=>"$val"); }
function db_load($db, $rows){ $GLOBALS["DBS"][$db] = array(); foreach($rows as $r) $GLOBALS["DBS"][$db][(int)$r["id"]] = $r; ksort($GLOBALS["DBS"][$db]); }
# Разбор литерала MySQL-строки с экранированием \x
function sql_tuples($s){
    $out = array(); $i = 0; $n = strlen($s);
    while(($i = strpos($s, "(", $i)) !== FALSE){
        $i++; $vals = array(); $cur = "";
        while($i < $n){
            $c = $s[$i];
            if($c === "'"){
                $i++; $str = "";
                while($s[$i] !== "'"){ if($s[$i] === "\\"){ $i++; } $str .= $s[$i]; $i++; }
                $i++; $cur = $str; continue;
            }
            if($c === "," || $c === ")"){ $vals[] = trim($cur); $cur = ""; $i++; if($c === ")") break; continue; }
            $cur .= $c; $i++;
        }
        $out[] = $vals;
    }
    return $out;
}
function Exec_sql($sql, $msg, $log=TRUE, $fatal=TRUE){
    global $z;
    $GLOBALS["SQL_LOG"][] = $msg;
    if(!isset($GLOBALS["DBS"][$z]) && $msg !== "Template: create the table")
        throw new Exception("no table $z for [$msg]");
    $T =& $GLOBALS["DBS"][$z];
    switch($msg){
        case "Get Objects list for export":
            preg_match('/id>(\d+) ORDER BY id LIMIT (\d+)/', $sql, $m);
            $res = array();
            foreach($T as $id => $r) if($id > $m[1] && count($res) < $m[2]) $res[] = $r;
            return new FkRes($res);
        case "Template: users and secrets":  # пользователи (up=1) и секреты под записями (родитель не тип)
            $res = array();
            foreach($T as $r){
                $p = isset($T[(int)$r["up"]]) ? $T[(int)$r["up"]] : NULL;
                if(($r["t"] === "18" && $r["up"] === "1")
                    || (in_array($r["t"], array("20", "125", "40", "130", "124", "301"), TRUE) && $p && $p["up"] !== "0"))
                    $res[] = array($r["id"]);
            }
            return new FkRes($res);
        case "Template: rows under the skipped":
            preg_match('/up IN \(([\d,]+)\)/', $sql, $m);
            $in = explode(",", $m[1]);
            $res = array();
            foreach($T as $r) if(in_array($r["up"], $in, TRUE) || in_array($r["t"], $in, TRUE)) $res[] = array($r["id"]);
            return new FkRes($res);
        case "Template: author":
            return new FkRes(strpos($sql, "db.val='$z'") !== FALSE ? array(array("cabinet_$z")) : array());
        case "Template: create the table":
            $T = array();
            return TRUE;
        case "Template: insert":
            foreach(sql_tuples(substr($sql, strpos($sql, "VALUES") + 6)) as $v)  # (id, t, up, ord, val)
                $T[(int)$v[0]] = row($v[0], $v[2], $v[3], $v[1], $v[4]);
            ksort($T);
            return TRUE;
        case "Template: drop the incomplete table":
            unset($GLOBALS["DBS"][$z]);
            return TRUE;
    }
    throw new Exception("unexpected query [$msg] $sql");
}
class FkRes { public $rows; function __construct($rows){ $this->rows = $rows; } }
function fk_fetch_assoc($res){ return $res->rows ? array_shift($res->rows) : NULL; }
function fk_fetch_array($res){
    if(!$res->rows) return NULL;
    $r = array_shift($res->rows);
    return array_merge(array_values($r), $r);
}
function fk_num_rows($res){ return count($res->rows); }

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
foreach(array("Backup_dump", "Restore_dump_rows", "Restore_allowed", "Code_backup", "Code_backup_dir", "Code_rm_dir",
              "Tpl_dir", "Tpl_id_ok", "Tpl_registry", "Tpl_registry_save", "Tpl_lock", "Tpl_unlock", "Tpl_moderator",
              "Tpl_current", "Tpl_secret_ids", "Tpl_author", "Tpl_publish", "Tpl_set_status", "Tpl_list",
              "Tpl_code_names", "Tpl_deploy") as $fn){
    try {
        $code = str_replace(array("mysqli_fetch_assoc(", "mysqli_fetch_array(", "mysqli_num_rows("),
                            array("fk_fetch_assoc(", "fk_fetch_array(", "fk_num_rows("), extract_function_source($source, $fn));
        eval($code);
    } catch(Exception $e){
        echo "FAIL: в index.php нет функции $fn (".$e->getMessage().")\n";
        exit(1);
    }
}

$work = sys_get_temp_dir()."/dbtpl5364_".getmypid();
@mkdir($work);
chdir($work);
function use_db($db, $user, $uid){
    $GLOBALS["z"] = $db;
    $GLOBALS["GLOBAL_VARS"] = array("user"=>$user, "user_id"=>"$uid");
    @mkdir("templates/custom/$db/backups", 0777, TRUE);
    @mkdir("download/$db", 0777, TRUE);
}
function files_in($dir){ return is_dir($dir) ? array_values(array_diff(scandir($dir), array(".", ".."))) : array(); }
# Строки снимка версии: data.dmp.zip → строки таблицы
function snapshot_rows($id, $ver){
    $tmp = sys_get_temp_dir()."/dbtpl5364_snap_".getmypid();
    Code_rm_dir($tmp); @mkdir($tmp, 0777, TRUE);
    $zip = new ZipArchive; $zip->open(Tpl_dir()."/$id/$ver/data.dmp.zip"); $zip->extractTo($tmp); $zip->close();
    $dmp = glob("$tmp/*.dmp");
    $rows = array();
    foreach(sql_tuples(implode(",", Restore_dump_rows($dmp[0]))) as $v)
        $rows[(int)$v[0]] = row($v[0], $v[2], $v[3], $v[1], $v[4]);
    Code_rm_dir($tmp);
    return $rows;
}
function zip_names($file){
    $zip = new ZipArchive; $zip->open($file); $n = array();
    for($i = 0; $i < $zip->numFiles; $i++) $n[] = $zip->getNameIndex($i);
    $zip->close(); sort($n); return $n;
}

# ── Исходная база src5364 ────────────────────────────────────────────────────────────────────
$src = array(
    row(1, 0, 1, 1, "root"),
    row(18, 0, 1, 3, "Пользователь"), row(20, 0, 1, 6, "Пароль"), row(125, 0, 1, 3, "Token"), row(130, 0, 1, 3, "Secret"),
    row(200, 18, 1, 20, ""), row(201, 18, 2, 125, ""),                         # реквизиты схемы — остаются
    row(300, 0, 1, 3, "Коннектор"), row(301, 300, 1, 130, ""),
    row(400, 1, 1, 18, "src5364"), row(401, 400, 1, 20, "hash"), row(402, 400, 1, 125, "tok-owner"),
    row(403, 400, 1, 40, "xsrf"), row(404, 402, 1, 3, "под токеном"),
    row(410, 1, 1, 18, "operator"), row(411, 410, 1, 125, "tok-operator"),
    row(500, 1, 1, 300, "1С"), row(501, 500, 1, 130, "secret-key"),
    row(600, 1, 1, 700, "Заказ 1"), row(601, 600, 1, 410, ""),                 # ссылка на пользователя
    row(602, 600, 2, 3, "текст с 'кавычкой'\nи переводом строки"),
    row(700, 0, 1, 3, "Заказ"),
);
db_load("src5364", $src);
$kept = array(1, 18, 20, 125, 130, 200, 201, 300, 301, 500, 600, 602, 700);
use_db("src5364", "src5364", 400);
file_put_contents("templates/custom/src5364/main.html", "главная");
file_put_contents("download/src5364/app.js", "console.log(1);");
@mkdir("download/src5364/files", 0777, TRUE);
file_put_contents("download/src5364/files/doc.pdf", "PDF");

# ── A. Кто и под каким именем публикует ─────────────────────────────────────────────────────
use_db("src5364", "stranger", 77);
$r = Tpl_publish("shop", "Магазин", "");
expect(isset($r["error"]) && !is_dir(Tpl_dir()."/shop"), "A1: не владелец базы — отказ, снимка нет");
use_db("src5364", "src5364", 400);
$r = Tpl_publish("1bad", "", "");
expect(isset($r["error"]), "A2: имя не с буквы — отказ");
$r = Tpl_publish("ru", "", "");
expect(isset($r["error"]) && !is_dir(Tpl_dir()."/ru"), "A3: системное имя ru владельцу — отказ");
use_db("my", "my", 1);
$r = Tpl_publish("cab", "", "");
expect(isset($r["error"]), "A4: базу my шаблоном не сделать");

# ── B. Снимок ────────────────────────────────────────────────────────────────────────────────
use_db("src5364", "src5364", 400);
$GLOBALS["MAILS"] = array();
$r = Tpl_publish("Shop", "Магазин", "Каталог и заказы");
expect(isset($r["result"]) && $r["id"] === "shop" && $r["ver"] === 1 && $r["status"] === "pending",
    "B1: владелец фиксирует версию 1, она на модерации", json_encode($r, JSON_UNESCAPED_UNICODE));
$snap = snapshot_rows("shop", 1);
expect(array_keys($snap) === $kept, "B2: в снимке нет пользователей, секретов записей и ссылок на пользователей; схема и данные есть",
    implode(",", array_keys($snap)));
expect(isset($snap[602]) && $snap[602]["val"] === "текст с 'кавычкой'\nи переводом строки", "B3: значения в снимке целы");
expect(zip_names(Tpl_dir()."/shop/1/code.zip") === array("download/app.js", "download/files/doc.pdf", "templates/main.html"),
    "B4: в архиве файлов шаблоны и download базы", implode(",", zip_names(Tpl_dir()."/shop/1/code.zip")));
expect(files_in("templates/custom/src5364/backups") === array(), "B5: в backups исходной базы ничего не осталось");
$reg = Tpl_registry();
expect($reg["shop"]["source"] === "src5364" && $reg["shop"]["author"] === "cabinet_src5364" && $reg["shop"]["title"] === "Магазин",
    "B6: в реестре база-источник, автор из ЛК, название");
expect(count($GLOBALS["MAILS"]) === 1, "B7: модератору ушло письмо о версии на модерации");
use_db("other5364", "other5364", 400);
db_load("other5364", array(row(1, 0, 1, 1, "root")));
$r = Tpl_publish("shop", "", "");
expect(isset($r["error"]) && count(Tpl_registry()["shop"]["versions"]) === 1, "B8: имя шаблона другой базы не занять");

# ── C. Модерация ─────────────────────────────────────────────────────────────────────────────
expect(Tpl_current("shop") === 0, "C1: версия на модерации не текущая — в ЛК не разворачивается");
use_db("my", "joe", 55);
expect(Tpl_list() === array(), "C2: обычному пользователю ЛК неодобренный шаблон не виден");
use_db("src5364", "src5364", 400);
$own = Tpl_list();
expect(count($own) === 1 && count($own[0]["versions"]) === 1, "C3: владелец видит свой шаблон с версиями");
$r = Tpl_set_status("shop", 1, "approved");
expect(isset($r["error"]) && Tpl_current("shop") === 0, "C4: владелец свою версию не одобряет");
use_db("my", "joe", 55);
$r = Tpl_set_status("shop", 1, "approved");
expect(isset($r["error"]) && Tpl_current("shop") === 0, "C5: пользователь ЛК не модератор — не одобряет");
use_db("my", "boss", 3);
$r = Tpl_set_status("shop", 1, "approved", "ок");
expect(isset($r["result"]) && $r["current"] === 1 && Tpl_current("shop") === 1, "C6: модератор в my одобряет — версия текущая");
expect(Tpl_moderator() && count(Tpl_list()[0]["versions"]) === 1, "C7: модератору видна история версий");
use_db("my", "joe", 55);
$l = Tpl_list();
expect(count($l) === 1 && $l[0]["id"] === "shop" && $l[0]["ver"] === 1 && !isset($l[0]["versions"]) && !isset($l[0]["source"]),
    "C8: в ЛК одобренный шаблон без истории версий и базы-источника", json_encode($l, JSON_UNESCAPED_UNICODE));
use_db("src5364", "boss", 3);
expect(!Tpl_moderator(), "C9: модератор действует только в базе my");

# ── D. Развёртывание ────────────────────────────────────────────────────────────────────────
use_db("new5364", "joe", 55);
$err = Tpl_deploy("shop", Tpl_current("shop"));
expect($err === "" && isset($GLOBALS["DBS"]["new5364"]) && array_keys($GLOBALS["DBS"]["new5364"]) === $kept,
    "D1: новая база — ровно строки снимка", $err);
expect($GLOBALS["DBS"]["new5364"][602]["val"] === "текст с 'кавычкой'\nи переводом строки", "D2: значения в новой базе целы");
expect(@file_get_contents("templates/custom/new5364/main.html") === "главная" && @file_get_contents("download/new5364/files/doc.pdf") === "PDF"
    && @file_get_contents("download/new5364/app.js") === "console.log(1);", "D3: файлы шаблона разложены по папкам новой базы");
$GLOBALS["DBS"]["src5364"][603] = row(603, 600, 3, 3, "правка после фиксации");
use_db("src5364", "src5364", 400);
$r = Tpl_publish("shop", "", "");
expect(isset($r["result"]) && $r["ver"] === 2 && Tpl_current("shop") === 1, "D4: версия 2 на модерации, текущая — 1");
use_db("new2", "joe", 55);
Tpl_deploy("shop", Tpl_current("shop"));
expect(!isset($GLOBALS["DBS"]["new2"][603]), "D5: правка исходной базы до одобрения новой версии не разворачивается");
expect(Tpl_registry()["shop"]["title"] === "Магазин" && Tpl_registry()["shop"]["descr"] === "Каталог и заказы",
    "D6: пустые название и описание новой версии не стирают прежние");

# ── E. Снятие версии ────────────────────────────────────────────────────────────────────────
use_db("my", "boss", 3);
Tpl_set_status("shop", 2, "approved");
expect(Tpl_current("shop") === 2, "E1: одобрена версия 2 — она текущая");
use_db("src5364", "src5364", 400);
$r = Tpl_set_status("shop", 2, "withdrawn");
expect(isset($r["result"]) && Tpl_current("shop") === 1, "E2: владелец снял версию 2 — текущая снова 1");
use_db("my", "boss", 3);
$r = Tpl_set_status("shop", 2, "approved");
expect(isset($r["error"]) && Tpl_current("shop") === 1, "E3: снятую версию не одобрить");
$r = Tpl_set_status("shop", 9, "approved");
expect(isset($r["error"]), "E4: нет такой версии — отказ");

# ── F. Чужой путь в архиве шаблона ──────────────────────────────────────────────────────────
@mkdir(Tpl_dir()."/evil/1", 0777, TRUE);
copy(Tpl_dir()."/shop/1/data.dmp.zip", Tpl_dir()."/evil/1/data.dmp.zip");
$zip = new ZipArchive; $zip->open(Tpl_dir()."/evil/1/code.zip", ZipArchive::CREATE);
$zip->addFromString("download/../../etc/x", "x"); $zip->close();
use_db("new3", "joe", 55);
$err = Tpl_deploy("evil", 1);
expect($err !== "" && !isset($GLOBALS["DBS"]["new3"]) && !is_file("etc/x"), "F1: чужой путь в архиве — отказ до создания таблицы", $err);

Code_rm_dir($work);
ob_end_flush();
echo $failures ? "\n$failures FAIL\n" : "\nOK\n";
exit($failures ? 1 : 0);
