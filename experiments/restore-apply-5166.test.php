<?php
# Мерка к issue #5166: восстановление базы из архива .dmp.zip после показа SQL.
# https://github.com/ideav/crm/issues/5166
#
# Запуск: php experiments/restore-apply-5166.test.php (в гейте — через одноимённый .test.js)
#
# Функции бэкапа и восстановления берутся из index.php как есть; MySQL заменён таблицей в памяти
# (строки id/up/t/ord/val), запросы различаются по их метке в Exec_sql. Проверяется:
#   A) дамп, снятый Backup_dump, разбирается Restore_dump_rows в те же строки (кавычки, \, переводы
#      строк, теги, пропуски id, ord, смена up/t);
#   B) владелец заливает дамп ЧУЖОЙ базы: данные заменены, прежний пароль/токен/xsrf владельца
#      сохранены, роль владельца — admin, текущая база лежит в backups страховочным бэкапом;
#   C) в дампе нет ни владельца, ни роли admin: владелец создан, роль admin создана с WRITE
#      на все объекты (1), структуру (0) и файлы (10);
#   D) не владелец и не супер-админ — отказ, база не тронута; супер-админ (user_id 0) — можно;
#   E) обрыв заливки — ошибка с именем страховочного бэкапа, из которого база возвращается.

$failures = 0;
ob_start();  # Restore_apply шлёт header(): без буфера в CLI это предупреждение
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

foreach(array("USER"=>18, "PASSWORD"=>20, "XSRF"=>40, "ROLE"=>42, "LEVEL"=>47, "EXPORT"=>55, "DELETE"=>56,
              "ROLE_OBJECT"=>116, "TOKEN"=>125) as $k => $v)
    define($k, $v);
function t9n($v){ return preg_match('/^\[RU\](.*?)\[EN\]/s', $v, $m) ? $m[1] : $v; }
function wlog($text, $mode="log"){}

# Без расширения zip — архив как файл с одним вложением (имя + содержимое)
if(!class_exists("ZipArchive")){
    class ZipArchive {
        const CREATE = 1;
        private $p; private $files = array();
        function open($p, $flags=0){ $this->p = $p; if(is_file($p)) $this->files = unserialize(file_get_contents($p)); return TRUE; }
        function addFile($src, $name){ $this->files[$name] = file_get_contents($src); }
        function extractTo($dir){ foreach($this->files as $n => $c) file_put_contents("$dir/$n", $c); }
        function close(){ if($this->files) file_put_contents($this->p, serialize($this->files)); }
    }
}

# ── Таблица базы в памяти и Exec_sql по меткам запросов ─────────────────────────────────────
function row($id, $up, $ord, $t, $val){ return array("id"=>"$id", "up"=>"$up", "t"=>"$t", "ord"=>"$ord", "val"=>"$val"); }
function db_load($rows){ $GLOBALS["T"] = array(); foreach($rows as $r) $GLOBALS["T"][(int)$r["id"]] = $r; ksort($GLOBALS["T"]); }
function db_find($fn){ foreach($GLOBALS["T"] as $r) if($fn($r)) return $r; return NULL; }
function db_new($up, $ord, $t, $val){
    $id = $GLOBALS["T"] ? max(array_keys($GLOBALS["T"])) + 1 : 1;
    $GLOBALS["T"][$id] = row($id, $up, $ord, $t, $val);
    return $id;
}
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
    $T =& $GLOBALS["T"];
    if($msg === "Get Objects list for export"){
        preg_match('/id>(\d+) ORDER BY id LIMIT (\d+)/', $sql, $m);
        $res = array();
        foreach($T as $id => $r) if($id > $m[1] && count($res) < $m[2]) $res[] = $r;
        return new FkRes($res);
    }
    if($msg === "Restore: keep the owner's login"){
        $u = db_find(function($r) use ($z){ return $r["t"] === "18" && $r["val"] === $z && $r["up"] !== "0"; });
        $res = array();
        if($u) foreach($T as $r) if($r["up"] === $u["id"] && in_array($r["t"], array("20", "125", "40"), TRUE))
            $res[] = array("t"=>$r["t"], "val"=>$r["val"]);
        return new FkRes($res);
    }
    if($msg === "Restore: clear the DB"){ $T = array(); return TRUE; }
    if($msg === "Restore: insert"){
        if(!empty($GLOBALS["FAIL_INSERT"]) && count($T) >= $GLOBALS["FAIL_INSERT"])
            return "Couldn't execute query [Restore: insert] MySQL server has gone away";
        foreach(sql_tuples(substr($sql, strpos($sql, "VALUES") + 6)) as $v)  # (id, t, up, ord, val)
            $T[(int)$v[0]] = row($v[0], $v[2], $v[3], $v[1], $v[4]);
        ksort($T);
        return TRUE;
    }
    if(strpos($msg, "Insert: ") === 0){
        $v = sql_tuples(substr($sql, strpos($sql, "VALUES") + 6))[0];  # (up, ord, t, val)
        $GLOBALS["insert_id"] = db_new($v[0], $v[1], $v[2], $v[3]);
        return TRUE;
    }
    if($msg === "Update Val"){
        preg_match("/SET val='(.*)' WHERE id=(\d+)$/s", $sql, $m);
        $T[(int)$m[2]]["val"] = stripslashes($m[1]);
        return TRUE;
    }
    if($msg === "Update Typ"){
        preg_match('/SET t=(\d+) WHERE id=(\d+)$/', $sql, $m);
        $T[(int)$m[2]]["t"] = $m[1];
        return TRUE;
    }
    $one = function($r){ return new FkRes($r ? array(array($r["id"])) : array()); };
    switch($msg){
        case "Restore: find the admin role":
            return $one(db_find(function($r){ return $r["t"] === "42" && $r["val"] === "admin" && $r["up"] !== "0"; }));
        case "Restore: find WRITE":
            return $one(db_find(function($r){ return $r["t"] === "47" && $r["val"] === "WRITE" && $r["up"] !== "0"; }));
        case "Restore: find the owner":
            return $one(db_find(function($r) use ($z){ return $r["t"] === "18" && $r["val"] === $z && $r["up"] !== "0"; }));
        case "Restore: find the owner's req":
            preg_match('/up=(\d+) AND t=(\d+)/', $sql, $m);
            return $one(db_find(function($r) use ($m){ return $r["up"] === $m[1] && $r["t"] === $m[2]; }));
        case "Restore: find the owner's role":
            preg_match('/r\.up=(\d+)/', $sql, $m);
            return $one(db_find(function($r) use ($m, $T){
                return $r["up"] === $m[1] && isset($T[(int)$r["t"]]) && $T[(int)$r["t"]]["t"] === "42"; }));
        case "Restore: find the role column":
            return $one(db_find(function($r) use ($T){
                return $r["up"] === "18" && isset($T[(int)$r["t"]]) && $T[(int)$r["t"]]["up"] === "0" && $T[(int)$r["t"]]["t"] === "42"; }));
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
foreach(array("Backup_dump", "Restore_dump_rows", "Restore_allowed", "Restore_id", "Restore_admin_role", "Restore_apply",
              "Insert", "UpdateTyp", "Update_Val") as $fn){
    try {
        # Результат запроса в подделке — массив строк: mysqli_fetch_*(Exec_sql(...)) идут к нему
        $code = str_replace(array("mysqli_fetch_assoc(", "mysqli_fetch_array(", "mysqli_num_rows("),
                            array("fk_fetch_assoc(", "fk_fetch_array(", "fk_num_rows("), extract_function_source($source, $fn));
        eval($code);
    } catch(Exception $e){
        echo "FAIL: в index.php нет функции $fn (".$e->getMessage().")\n";
        exit(1);
    }
}

$work = sys_get_temp_dir()."/restore5166_".getmypid();
@mkdir($work);
chdir($work);
function use_db($db){
    $GLOBALS["z"] = $db;
    @mkdir("templates/custom/$db/backups", 0777, TRUE);
}
function as_user($user, $id){ $GLOBALS["GLOBAL_VARS"] = array("user"=>$user, "user_id"=>$id); }
function backups($db){ return array_values(array_diff(scandir("templates/custom/$db/backups"), array(".", ".."))); }
# Дамп архива → строки таблицы (как их увидит INSERT)
function dump_rows($db, $zipName){
    $zip = new ZipArchive;
    $zip->open("templates/custom/$db/backups/$zipName");
    $zip->extractTo("templates/custom/$db/backups");
    $zip->close();
    $rows = array();
    foreach(sql_tuples(implode(",", Restore_dump_rows("templates/custom/$db/backups/".substr($zipName, 0, -4)))) as $v)
        $rows[(int)$v[0]] = row($v[0], $v[2], $v[3], $v[1], $v[4]);
    return $rows;
}
# Архив → строки VALUES, как их получает Restore_apply
function Restore_dump_rows_from($db, $zipName){
    $zip = new ZipArchive;
    $zip->open("templates/custom/$db/backups/$zipName");
    $zip->extractTo("templates/custom/$db/backups");
    $zip->close();
    return Restore_dump_rows("templates/custom/$db/backups/".substr($zipName, 0, -4));
}
# Мини-база: метаданные пользователя/роли/уровней как в docker/mysql/010-integram-bootstrap.sql
function meta(){
    return array(row(18,0,1,3,"Пользователь"), row(20,18,1,6,"Пароль"), row(40,18,4,6,"xsrf"), row(42,0,2,3,"Роль"),
        row(47,0,3,3,"Уровень доступа"), row(55,116,3,11,"Экспорт"), row(56,116,4,11,"Удаление"),
        row(115,18,6,144,"Роль"), row(116,42,1,5,"Объекты"), row(125,18,8,6,"Token"), row(144,0,0,42,""),
        row(170,1,1,47,"WRITE"), row(171,1,2,47,"READ"));
}
function owner_req($db, $t){
    $u = db_find(function($r) use ($db){ return $r["t"] === "18" && $r["val"] === $db; });
    if(!$u) return NULL;
    $r = db_find(function($r) use ($u, $t){ return $r["up"] === $u["id"] && $r["t"] === "$t"; });
    return $r ? $r["val"] : NULL;
}
function owner_role($db){
    $u = db_find(function($r) use ($db){ return $r["t"] === "18" && $r["val"] === $db; });
    $link = $u ? db_find(function($r) use ($u){
        return $r["up"] === $u["id"] && isset($GLOBALS["T"][(int)$r["t"]]) && $GLOBALS["T"][(int)$r["t"]]["t"] === "42"; }) : NULL;
    return $link ? $GLOBALS["T"][(int)$link["t"]]["val"] : NULL;
}

# ── A. Дамп ↔ разбор ─────────────────────────────────────────────────────────────────────────
use_db("rt5166");
$tricky = array_merge(meta(), array(
    row(1001,1,18,1,"rt5166"), row(1002,1001,20,1,"hash'with\"quotes\\and\\\\slashes"),
    row(1003,1,151,7,"<i class=\"pi pi-upload\"></i>"), row(1004,1003,153,1,"строка1\nстрока2\r\nстрока3"),
    row(1010,1,151,1,"&#128196;"), row(1011,1010,153,2,""), row(1012,1010,153,2,"0"), row(5000,1012,47,1,"x;y;z")));
db_load($tricky);
$zipName = Backup_dump();
expect(preg_match('/^rt5166_\d{8}_\d{6}\.dmp\.zip$/', $zipName) && is_file("templates/custom/rt5166/backups/$zipName"),
    "A: Backup_dump кладёт архив <база>_<дата>.dmp.zip в backups");
$back = dump_rows("rt5166", $zipName);
expect($back == $GLOBALS["T"], "A: разбор дампа возвращает те же строки (кавычки, \\, переводы строк, теги, пропуски id, ord)");
expect(!is_file("templates/custom/rt5166/backups/".substr($zipName, 0, -4)), "A: распакованный дамп после разбора удалён");

# ── B. Владелец заливает дамп другой базы ───────────────────────────────────────────────────
use_db("other");
$other = array_merge(meta(), array(row(145,1,1,42,"admin"), row(164,1,2,42,"user"),
    row(1001,1,1,18,"acme"), row(1002,1001,1,20,"чужой-хэш"), row(1003,1001,1,164,"115"),
    row(1100,1,1,18,"other"), row(1101,1100,1,20,"хэш-other"), row(1102,1100,1,145,"115"),
    row(2000,1,1,151,"Заказы из other")));
db_load($other);
$otherDump = Backup_dump();
$otherRows = dump_rows("other", $otherDump);
use_db("acme");
copy("templates/custom/other/backups/$otherDump", "templates/custom/acme/backups/$otherDump");
$acme = array_merge(meta(), array(row(145,1,1,42,"admin"),
    row(1001,1,1,18,"acme"), row(1002,1001,1,20,"мой-хэш"), row(1003,1001,1,125,"мой-токен"),
    row(1004,1001,1,40,"мой-xsrf"), row(1005,1001,1,145,"115"), row(3000,1,1,151,"Данные acme")));
db_load($acme);
$acmeBefore = $GLOBALS["T"];
as_user("acme", "1001");
$res = Restore_apply(Restore_dump_rows_from("acme", $otherDump), $otherDump);
expect(isset($res["result"]) && $res["result"] === "ok" && $res["rows"] === count($otherRows), "B: ответ ok с числом строк дампа");
expect(!isset($GLOBALS["T"][3000]) && isset($GLOBALS["T"][2000]) && $GLOBALS["T"][2000]["val"] === "Заказы из other",
    "B: данные базы заменены данными архива");
expect(owner_req("acme", 20) === "мой-хэш" && owner_req("acme", 125) === "мой-токен" && owner_req("acme", 40) === "мой-xsrf",
    "B: владельцу сохранены прежние пароль, токен и xsrf");
expect(owner_role("acme") === "admin", "B: роль владельца — admin (в дампе была user)");
expect(count(array_filter($GLOBALS["T"], function($r){ return $r["t"] === "42" && $r["val"] === "admin"; })) === 1,
    "B: роль admin из дампа использована, вторая не создана");
expect(owner_req("other", 20) === "хэш-other", "B: прочие пользователи дампа как в дампе");
expect(isset($res["backup"]) && in_array($res["backup"], backups("acme"), TRUE) && dump_rows("acme", $res["backup"]) == $acmeBefore,
    "B: перед очисткой текущая база сохранена в backups и восстанавливается из него один в один");

# ── C. В дампе нет ни владельца, ни роли admin ──────────────────────────────────────────────
use_db("bare");
db_load(array_merge(meta(), array(row(2000,1,1,151,"Пусто"))));
$bareDump = Backup_dump();
db_load(array_merge(meta(), array(row(145,1,1,42,"admin"), row(1001,1,1,18,"bare"), row(1002,1001,1,20,"хэш-bare"),
    row(1005,1001,1,145,"115"))));
sleep(1);  # имя страховочного бэкапа — с точностью до секунды
as_user("bare", "1001");
$res = Restore_apply(Restore_dump_rows_from("bare", $bareDump), $bareDump);
expect(isset($res["result"]) && $res["result"] === "ok", "C: ответ ok");
expect(owner_req("bare", 20) === "хэш-bare", "C: владелец создан с прежним паролем");
expect(owner_role("bare") === "admin", "C: владельцу назначена роль admin");
$role = db_find(function($r){ return $r["t"] === "42" && $r["val"] === "admin"; });
$grants = array();
foreach($GLOBALS["T"] as $g) if($role && $g["up"] === $role["id"] && $g["t"] === "116"){
    $lev = db_find(function($r) use ($g){ return $r["up"] === $g["id"] && isset($GLOBALS["T"][(int)$r["t"]]) && $GLOBALS["T"][(int)$r["t"]]["t"] === "47"; });
    $grants[$g["val"]] = $lev ? $GLOBALS["T"][(int)$lev["t"]]["val"] : "";
    $grants[$g["val"]."exp"] = db_find(function($r) use ($g){ return $r["up"] === $g["id"] && $r["t"] === "55"; }) ? "1" : "";
}
ksort($grants);
expect($grants == array("0"=>"WRITE", "0exp"=>"", "1"=>"WRITE", "1exp"=>"1", "10"=>"WRITE", "10exp"=>""),
    "C: создана роль admin: WRITE на все объекты (1, с экспортом), структуру (0) и файлы (10)", json_encode($grants));
$u = db_find(function($r){ return $r["t"] === "18" && $r["val"] === "bare"; });
$link = db_find(function($r) use ($u){ return $r["up"] === $u["id"] && $GLOBALS["T"][(int)$r["t"]]["t"] === "42"; });
expect($link && $link["val"] === "115", "C: ссылка на роль записана в колонку «Роль» пользователя (115)");

# ── D. Права ─────────────────────────────────────────────────────────────────────────────────
use_db("acme");
db_load($acme);
$GLOBALS["SQL_LOG"] = array();
$n = count(backups("acme"));
as_user("bob", "1777");
$res = Restore_apply(Restore_dump_rows_from("acme", $otherDump), $otherDump);
expect(isset($res["error"]) && $GLOBALS["T"] == $acmeBefore && !in_array("Restore: clear the DB", $GLOBALS["SQL_LOG"], TRUE),
    "D: обычный пользователь — отказ, база не тронута");
expect(count(backups("acme")) === $n, "D: при отказе бэкап не снимается");
as_user("admin", "1888");
$res = Restore_apply(Restore_dump_rows_from("acme", $otherDump), $otherDump);
expect(isset($res["error"]) && $GLOBALS["T"] == $acmeBefore, "D: тёзка «admin» внутри базы — не супер-админ, отказ");
sleep(1);
as_user("admin", 0);
$res = Restore_apply(Restore_dump_rows_from("acme", $otherDump), $otherDump);
expect(isset($res["result"]) && $res["result"] === "ok" && owner_role("acme") === "admin" && owner_req("acme", 20) === "мой-хэш",
    "D: супер-админ сервера (user_id 0) восстанавливает, вход владельца сохранён");

# ── E. Обрыв заливки ─────────────────────────────────────────────────────────────────────────
db_load($acme);
$GLOBALS["SQL_LOG"] = array();
sleep(1);
as_user("acme", "1001");
$big = array();
for($i = 1; $i <= 30000; $i++) $big[] = "($i,1,1,1,'".str_repeat("x", 60)."')";
$GLOBALS["FAIL_INSERT"] = 1;
$res = Restore_apply($big, "big.dmp.zip");
$GLOBALS["FAIL_INSERT"] = 0;
expect(isset($res["error"]) && isset($res["backup"]) && strpos($res["error"], $res["backup"]) !== FALSE,
    "E: обрыв — ошибка называет страховочный бэкап");
expect(isset($res["backup"]) && dump_rows("acme", $res["backup"]) == $acmeBefore, "E: страховочный бэкап — полная прежняя база");
expect(count(array_filter($GLOBALS["SQL_LOG"], function($m){ return $m === "Restore: insert"; })) >= 2,
    "E: заливка идёт пачками (~1 МБ), а не одним запросом на весь дамп");

# ── F. Страховочный бэкап не записался — база не трогается ─────────────────────────────────
$GLOBALS["z"] = "ro5166";
file_put_contents("templates/custom/ro5166", "файл на месте каталога базы");  # mkdir backups невозможен
db_load(array_merge(meta(), array(row(1001,1,1,18,"ro5166"), row(3000,1,1,151,"Данные ro"))));
$roBefore = $GLOBALS["T"];
$GLOBALS["SQL_LOG"] = array();
as_user("ro5166", "1001");
$res = @Restore_apply(Restore_dump_rows_from("acme", $otherDump), $otherDump);
expect(isset($res["error"]) && $GLOBALS["T"] == $roBefore && !in_array("Restore: clear the DB", $GLOBALS["SQL_LOG"], TRUE),
    "F: бэкап текущей базы не записался — отказ до TRUNCATE, база не тронута");

echo $failures ?"\n$failures FAIL\n" : "\nOK\n";
exit($failures ? 1 : 0);
