<?php
# issue #5103: чтение журнала базы (logs/<db>_log.jsonl, logs/<db>_sql.jsonl, формат #5104)
# с конца, страницами: читается limit+1 строка, показывается limit; 1+1-я — признак продолжения.
# Курсор «выше» — пара (файл ротации, смещение в байтах). Старые .txt не читаются.
#
# Функции чтения берутся из index.php как есть.
# Прогон: php experiments/journal-read-5103.test.php
# Отказ — только exit(1): die("…") выходит с кодом 0 и обёртка засчитала бы PASS.

function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("not closed: ".$name);
}

define("ADMINROLE", 145);
function t9n($s){ return $s; }
$dir = sys_get_temp_dir()."/journal-5103-".getmypid()."/";
@mkdir($dir);
define("LOGS_DIR", $dir);
$z = "acme";

$source = file_get_contents(__DIR__."/../index.php");
preg_match_all('/^define\("(LOG_[A-Z_]+)",\s*(\d+)\);/m', $source, $d, PREG_SET_ORDER);
foreach($d as $def)
    define($def[1], (int)$def[2]);
preg_match_all('/^function (logJournal[A-Za-z_]*)\(/m', $source, $m);
foreach(array("logJournalFiles", "logJournalFilter", "logJournalRead", "logJournalAllowed") as $need)
    if(!in_array($need, $m[1])){
        fwrite(STDERR, "FAIL: в index.php нет $need()\n\nFAILED: 1 check(s) failed\n");
        exit(1);
    }
foreach(array_unique($m[1]) as $name)
    eval(extract_function_source($source, $name));

$failures = 0;
function check($cond, $label){
    global $failures;
    if($cond) echo "  ok  $label\n";
    else { echo "FAIL  $label\n"; $failures++; }
}

# ---- журнал: 250 строк в трёх файлах ротации + битая строка + старый .txt ------------------
$t0 = strtotime("2026-10-01T00:00:00+03:00");
function line($i){
    global $t0;
    $rec = array("v" => 1, "ts" => gmdate("Y-m-d\\TH:i:s", $t0 + $i * 60).".000+00:00", "rid" => "r".($i % 7)
               , "user" => ($i % 3 === 0) ? "ivanov~ai" : "petrov", "uid" => ($i % 3 === 0) ? 512 : 77
               , "op" => ($i % 2) ? "update" : "insert", "id" => 1000 + $i % 10, "n" => $i);
    if($i % 5 === 0) $rec["ai_job"] = "job1";
    if($i === 120) $rec["new"] = str_repeat("ж", 70000);  # строка длиннее блока чтения
    return json_encode($rec, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
}
$files = array("acme_sql.1.jsonl" => array(0, 99), "acme_sql.2.jsonl" => array(100, 199), "acme_sql.jsonl" => array(200, 249));
foreach($files as $f => $range){
    $text = "";
    for($i = $range[0]; $i <= $range[1]; $i++){
        $text .= line($i);
        if($i === 150) $text .= "{\"v\":1,\"ts\":\"обрыв\n";  # недописанная строка
    }
    file_put_contents(LOGS_DIR.$f, $text);
}
file_put_contents(LOGS_DIR."acme_sql.txt", "08/10/2026 12:00:00 admin@1.2.3.4[0.1]UPDATE acme SET val='tok' WHERE id=1;\n");
file_put_contents(LOGS_DIR."other_sql.jsonl", line(999));
file_put_contents(LOGS_DIR."acme_log.jsonl", "{\"v\":1,\"ts\":\"2026-10-01T00:00:00.000+03:00\",\"rid\":\"q\",\"user\":\"admin\",\"m\":\"GET\",\"n\":-1}\n");

# Все страницы подряд: n по порядку выдачи, число страниц, ошибки
function all_pages($mode, $filter, $limit){
    $ns = array(); $pages = 0; $cursor = ""; $guard = 0;
    do {
        $r = logJournalRead($mode, $filter, $cursor, $limit);
        if(isset($r["error"])) return array("error" => $r["error"]);
        $pages++;
        foreach($r["rows"] as $raw){ $rec = json_decode($raw, true); $ns[] = $rec["n"]; }
        if($r["more"] && count($r["rows"]) !== $limit) return array("error" => "more без полной страницы");
        $cursor = $r["next"];
    } while($r["more"] && ++$guard < 1000);
    return array("ns" => $ns, "pages" => $pages, "last_next" => $r["next"]);
}

echo "1. все строки страницами по 40\n";
$p = all_pages("sql", array(), 40);
check(!isset($p["error"]) && $p["ns"] === range(249, 0), "250 строк от новых к старым, без пропусков и повторов через 3 файла ротации");
check(isset($p["pages"]) && $p["pages"] === 7, "7 страниц (6 полных + 10 строк)");
$r = logJournalRead("sql", array(), "", 250);
check(count($r["rows"]) === 250 && $r["more"] === false, "limit 250 при 250 строках — 251-й нет, продолжения нет");
$r = logJournalRead("sql", array(), "", 249);
check(count($r["rows"]) === 249 && $r["more"] === true, "limit 249 — есть продолжение");
$hit = array_values(array_filter($r["rows"], function($raw){ return strpos($raw, "\"n\":120") !== false; }));
check(count($hit) === 1 && mb_strlen(json_decode($hit[0], true)["new"]) === 70000, "строка длиннее блока чтения читается целиком");

echo "2. фильтры\n";
$p = all_pages("sql", array("user" => "~ai"), 30);
check($p["ns"] === array_values(array_filter(range(249, 0), function($i){ return $i % 3 === 0; })), "user=~ai — только запросы ИИ");
$p = all_pages("sql", array("user" => "petrov"), 1000);
check(count($p["ns"]) === 166 && $p["pages"] === 1, "user=petrov — точное совпадение логина");
$p = all_pages("sql", array("id" => 1003, "op" => "update"), 5);
check($p["ns"] === array_values(array_filter(range(249, 0), function($i){ return $i % 10 === 3 && $i % 2 === 1; })), "id + op — история одной записи");
$p = all_pages("sql", array("ai_job" => "job1", "rid" => "r0"), 1000);
check($p["ns"] === array_values(array_filter(range(249, 0), function($i){ return $i % 5 === 0 && $i % 7 === 0; })), "ai_job + rid");
$p = all_pages("sql", array("since" => $t0 + 100 * 60, "until" => $t0 + 110 * 60), 4);
check($p["ns"] === range(110, 100), "since/until по ts, включительно");
$p = all_pages("sql", array("until" => $t0 + 5 * 60), 1000);
check($p["ns"] === range(5, 0), "until — продолжение с новых строк вниз");

echo "3. режим и курсор\n";
$r = logJournalRead("log", array(), "", 100);
check(count($r["rows"]) === 1 && json_decode($r["rows"][0], true)["n"] === -1, "mode=log читает только <db>_log*.jsonl");
$r = logJournalRead("sql", array(), "", 10000);
$all = implode("", $r["rows"]);
check(strpos($all, "tok") === false && strpos($all, "\"n\":999") === false, "старый .txt и журнал другой базы не читаются");
check(count($r["rows"]) === 250, "битая строка пропущена");
foreach(array("../../etc/passwd:0", "other_sql.jsonl:10", "acme_log.jsonl:10", "acme_sql.txt:10", "acme_sql.9.jsonl:10", "acme_sql.jsonl:-5", "acme_sql.jsonl", "acme_sql.jsonl:99999999") as $bad){
    $r = logJournalRead("sql", array(), $bad, 10);
    check(isset($r["error"]), "курсор «".$bad."» отклонён");
}
$r1 = logJournalRead("sql", array(), "", 60);
$r2 = logJournalRead("sql", array(), $r1["next"], 5);
check(preg_match('/^acme_sql\.2\.jsonl:\d+$/', $r1["next"]) && json_decode($r2["rows"][0], true)["n"] === 189, "курсор — файл ротации и смещение: продолжение с 189-й");

$r1 = logJournalRead("sql", array(), "", 20);
check($r1["next"] === "acme_sql.3.jsonl:".strlen(implode("", array_map("line", range(200, 229)))), "курсор в текущем файле — под именем, которое файл получит при ротации");
rename(LOGS_DIR."acme_sql.jsonl", LOGS_DIR."acme_sql.3.jsonl");  # ротация между страницами
file_put_contents(LOGS_DIR."acme_sql.jsonl", line(250).line(251));
$r2 = logJournalRead("sql", array(), $r1["next"], 3);
$ns = array_map(function($raw){ return json_decode($raw, true)["n"]; }, $r2["rows"]);
check($ns === array(229, 228, 227), "после ротации курсор продолжает тот же файл: 229, 228, 227");
$p = all_pages("sql", array(), 100);
check($p["ns"] === range(251, 0), "после ротации: новые строки сверху, все 252 по порядку");

echo "4. доступ\n";
$GLOBALS["GLOBAL_VARS"] = array("user" => "admin", "role_id" => 0);
check(logJournalAllowed() === true, "admin — можно");
$GLOBALS["GLOBAL_VARS"] = array("user" => "acme", "role_id" => 7);
check(logJournalAllowed() === true, "владелец базы (логин = имя базы) — можно");
$GLOBALS["GLOBAL_VARS"] = array("user" => "boss", "role_id" => ADMINROLE);
check(logJournalAllowed() === true, "роль admin — можно");
$GLOBALS["GLOBAL_VARS"] = array("user" => "petrov", "role_id" => 7);
check(logJournalAllowed() === false, "прочим — нельзя");

echo "5. разбор параметров запроса\n";
$_REQUEST = array("user" => "~ai", "id" => "1003", "op" => "update", "since" => "2026-10-01T01:00:00+03:00", "ai_job" => "job1", "rid" => "r0", "junk" => "x");
$f = logJournalFilter();
check($f["user"] === "~ai" && $f["id"] === 1003 && $f["op"] === "update" && $f["since"] === (float)($t0 + 3600) && $f["ai_job"] === "job1" && $f["rid"] === "r0" && !isset($f["junk"]), "user, id, op, since, ai_job, rid");
$_REQUEST = array("since" => "не дата");
$f = logJournalFilter();
check(isset($f["error"]), "негодная дата — ошибка, а не пустая выборка");

array_map("unlink", glob(LOGS_DIR."*")); @rmdir(LOGS_DIR);
if($failures){ fwrite(STDERR, "FAILED: $failures check(s) failed\n"); exit(1); }
echo "\nALL PASSED\n";
