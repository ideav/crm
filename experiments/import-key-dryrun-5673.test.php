<?php
// Issue #5673: импорт DATA (object/{type}?JSON&import=1) — ключ обновления при загрузке
// (importKey), «пробелы не стирают» (keepFilled), пробный прогон (dryRun) и счётчики в ответе.
//
// Исполняется НАСТОЯЩИЙ блок разбора строк DATA из index.php (от `cur_parent[0] = $up` до конца
// ветки `if($plain_data)`) и настоящие функции записи ядра (Insert, Update_Val, UpdateTyp, Delete,
// Insert_batch, Flush_batch…). База — таблица в памяти: Exec_sql разбирает те запросы, что шлёт
// блок, и пишет/читает массив строк (id, up, ord, t, val).
//
// Сценарии повторяют загрузки atex (ideav.ru/ateh, настройки 269 #66248/#883110): составной ключ
// при unique=1, удаление по пустой первой колонке, родитель из колонки с созданием.
//
// Запуск: php experiments/import-key-dryrun-5673.test.php
// rules: none (defect #5673)
namespace Test5673;

error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
mb_internal_encoding("UTF-8");

$failed = 0;
function ok($cond, $name, $info = ""){
    global $failed;
    if($cond)
        echo "  ok   $name\n";
    else{
        echo "  FAIL $name".($info === "" ? "" : " — $info")."\n";
        $failed++;
    }
}
function shown($v){ return str_replace("\n", " ", var_export($v, TRUE)); }

class DieException extends \Exception {}
class JsonDie extends \Exception { public $json; function __construct($j){ parent::__construct("json"); $this->json = $j; } }

function t9n($s){ return preg_match('/\[RU\](.*?)\[EN\]/s', $s, $m) ? $m[1] : $s; }
function trace($s){}
function my_die($m, $status = ""){ throw new DieException($m); }
function Json_die($json){ throw new JsonDie($json); }
function logChange($rec){}
function Get_ord($parent, $typ = 0){ return 1; }
function OrdLock($p){}

// ── База в памяти ─────────────────────────────────────────────────────────────────────────
// Строка: [id, up, ord, t, val]. WRITES — запросы записи, дошедшие до базы.
class Res { public $rows; function __construct($rows){ $this->rows = array_values($rows); } }
function row_out($r){ $o = array(); $i = 0; foreach($r as $k => $v){ $o[$k] = $v; $o[$i++] = $v; } return $o; }
function mysqli_fetch_array($res){
    if(!($res instanceof Res) || !count($res->rows))
        return NULL;
    return row_out(array_shift($res->rows));
}
function db_rows($fn){ $out = array(); foreach($GLOBALS["DB"] as $r) if($fn($r)) $out[] = $r; return $out; }
function db_insert($up, $ord, $t, $val){
    $id = $GLOBALS["NEXT_ID"]++;
    $GLOBALS["DB"][$id] = array("id" => $id, "up" => (int)$up, "ord" => (int)$ord, "t" => (int)$t, "val" => (string)$val);
    $GLOBALS["insert_id"] = $id;
    return $id;
}
function sq($s){ return stripslashes($s); }
function Exec_sql($sql, $msg = ""){
    $q = trim(preg_replace('/\s+/', ' ', $sql));
    $BS = str_repeat(chr(92), 2);	# обратная косая в регулярке
    $V = "'((?:[^'".$BS."]|".$BS.".)*)'";
    $DB = &$GLOBALS["DB"];
    if(preg_match('/^SELECT par\.t FROM t par, t req WHERE par\.up=0 AND req\.up=par\.id AND par\.id=(\d+) AND req\.t=(\d+)$/', $q, $m))
        return new Res(isset($DB[$m[1]]) && db_rows(function($r) use ($m){ return $r["up"] == $m[1] && $r["t"] == $m[2]; })
                        ? array(array("t" => $DB[$m[1]]["t"])) : array());
    if(preg_match("/^SELECT par\.id, max\(reqs\.ord\) ord FROM t par LEFT JOIN t reqs ON reqs\.up=par\.id AND reqs\.t=(\d+) WHERE par\.t=(\d+) AND \(par\.val=$V ?(?:OR par\.id=(\d+))?\) HAVING par\.id IS NOT NULL$/", $q, $m)){
        $val = sq($m[3]); $pid = isset($m[4]) ? (int)$m[4] : 0;
        $par = db_rows(function($r) use ($m, $val, $pid){ return $r["t"] == $m[2] && ($r["val"] === $val || $r["id"] === $pid); });
        if(!count($par)) return new Res(array());
        $ord = 0;
        foreach(db_rows(function($r) use ($par, $m){ return $r["up"] == $par[0]["id"] && $r["t"] == $m[1]; }) as $c) $ord = max($ord, $c["ord"]);
        return new Res(array(array("id" => $par[0]["id"], "ord" => $ord)));
    }
    if(preg_match('/^SELECT reqs\.t, reqs\.val, reqs\.id reqid FROM t reqs WHERE reqs\.up=(-?\d+) AND reqs\.t!=0$/', $q, $m))
        return new Res(array_map(function($r){ return array("t" => $r["t"], "val" => $r["val"], "reqid" => $r["id"]); }
                        , db_rows(function($r) use ($m){ return $r["up"] == $m[1]; })));
    if(preg_match("/^SELECT obj\.id, reqs\.t, reqs\.val, reqs\.id reqid FROM t obj LEFT JOIN t reqs ON reqs\.up=obj\.id AND reqs\.t!=0 WHERE obj\.up=(-?\d+) AND obj\.t=(\d+) AND obj\.val=$V ORDER BY obj\.id$/", $q, $m)){
        $out = array();
        foreach(db_rows(function($r) use ($m){ return $r["up"] == $m[1] && $r["t"] == $m[2] && $r["val"] === sq($m[3]); }) as $o){
            $ch = db_rows(function($r) use ($o){ return $r["up"] == $o["id"]; });
            if(!count($ch)) $out[] = array("id" => $o["id"], "t" => NULL, "val" => NULL, "reqid" => NULL);
            foreach($ch as $c) $out[] = array("id" => $o["id"], "t" => $c["t"], "val" => $c["val"], "reqid" => $c["id"]);
        }
        return new Res($out);
    }
    if(preg_match('/^SELECT id FROM t WHERE up=(-?\d+) AND t=(\d+) LIMIT 1$/', $q, $m))
        return new Res(array_slice(db_rows(function($r) use ($m){ return $r["up"] == $m[1] && $r["t"] == $m[2]; }), 0, 1));
    if(preg_match("/^SELECT req\.id FROM t req, t ref WHERE req\.up=(-?\d+) AND req\.val='(\d+)' AND ref\.id=req\.t AND ref\.t=(\d+)$/", $q, $m))
        return new Res(db_rows(function($r) use ($m, $DB){ return $r["up"] == $m[1] && $r["val"] === $m[2] && isset($DB[$r["t"]]) && $DB[$r["t"]]["t"] == $m[3]; }));
    if(preg_match("/^SELECT id FROM t WHERE t=(\d+) AND val=$V$/", $q, $m))
        return new Res(db_rows(function($r) use ($m){ return $r["t"] == $m[1] && $r["val"] === sq($m[2]); }));
    if(preg_match("/^SELECT id FROM t WHERE val=$V AND t=(\d+) LIMIT 1$/", $q, $m))
        return new Res(array_slice(db_rows(function($r) use ($m){ return $r["t"] == $m[2] && $r["val"] === sq($m[1]); }), 0, 1));
    if(preg_match('/^SELECT val FROM t WHERE id=(-?\d+)$/', $q, $m))
        return new Res(isset($DB[$m[1]]) ? array(array("val" => $DB[$m[1]]["val"])) : array());
    if(preg_match('/^SELECT id FROM t WHERE up=(-?\d+)$/', $q, $m))
        return new Res(db_rows(function($r) use ($m){ return $r["up"] == $m[1]; }));
    // ── запись ──
    $GLOBALS["WRITES"][] = $q;
    if(preg_match('/^DELETE FROM t WHERE (up|id)=(-?\d+)$/', $q, $m)){
        foreach($DB as $id => $r) if($r[$m[1]] == $m[2]) unset($DB[$id]);
        return new Res(array());
    }
    if(preg_match('/^UPDATE t SET t=(\d+) WHERE id=(-?\d+)$/', $q, $m)){ $DB[$m[2]]["t"] = (int)$m[1]; return new Res(array()); }
    if(preg_match("/^UPDATE t SET val=$V WHERE id=(-?\d+)$/", $q, $m)){ $DB[$m[2]]["val"] = sq($m[1]); return new Res(array()); }
    if(preg_match('/^INSERT INTO t \(up, ord, t, val\) VALUES (.*)$/', $q, $m)){
        preg_match_all("/\((-?\d+), ?(-?\d+), ?(-?\d+), ?$V\)/", $m[1], $tt, PREG_SET_ORDER);
        if(!count($tt)) throw new \Exception("unparsed INSERT: $q");
        foreach($tt as $t) db_insert($t[1], $t[2], $t[3], sq($t[4]));
        return new Res(array());
    }
    throw new \Exception("unknown SQL ($msg): $q");
}

// ── Ключ уникальности: схема и поиск записи по ключу (смысл запроса FindUniqueRecordDuplicate) ──
// REQDESC[тип][реквизит] — описание реквизита, как его отдаёт UniqueKeyReqs; KEYS[тип] — отмеченные «ключ».
function UniqueKeyReqs($typ, $onlyReq = 0){
    $out = array();
    foreach($GLOBALS["REQDESC"][$typ] as $rid => $d)
        if($onlyReq ? ($rid == $onlyReq) : in_array($rid, $GLOBALS["KEYS"][$typ]))
            $out[$rid] = $d;
    return $out;
}
function UniqueKeyNormalizeValue($t, $value){ return is_array($value) ? implode(",", $value) : (string)$value; }
function FindUniqueRecordDuplicate($typ, $skipId, $up, $val, $keyValues, $includeVal = true){
    if(!$includeVal){
        $has = false;
        foreach($keyValues as $kv) if($kv["kind"] === "ref" ? count($kv["values"]) : ((string)$kv["value"] !== "")) $has = true;
        if(!$has) return false;
    }
    foreach($keyValues as $kv) if($kv["kind"] === "ref" && $kv["has_missing_ref"]) return false;
    foreach(db_rows(function($r) use ($typ, $up, $val, $includeVal, $skipId){
                return $r["t"] == $typ && $r["up"] == $up && (!$includeVal || $r["val"] === (string)$val) && $r["id"] != $skipId; }) as $o){
        $ch = db_rows(function($r) use ($o){ return $r["up"] == $o["id"]; });
        $match = true;
        foreach($keyValues as $rid => $kv){
            if($kv["kind"] === "ref"){
                $got = array();
                foreach($ch as $c) if($c["val"] === (string)$rid) $got[] = $c["t"];
                $match = $match && (count($kv["values"]) ? in_array($kv["values"][0], $got) : !count($got));
            }
            else{
                $got = "";
                foreach($ch as $c) if($c["t"] == $rid) $got = $c["val"];
                $match = $match && ($got === (string)$kv["value"]);
            }
        }
        if($match) return row_out(array("id" => $o["id"], "ord" => $o["ord"]));
    }
    return false;
}
// Format_Val: BOOLEAN (11) — "1"/"-1", пробел и пусто — ""; остальное как есть
function Format_Val($typ, $val){ return ((string)$typ === "11") ? Boolean_Store_Val($val) : $val; }

// ── Код ядра ──────────────────────────────────────────────────────────────────────────────
# Экстрактор функции из ядра — тот же, что в experiments/boolean-tristate-5442.test.php.
function core_function($src, $name){
    $tokens = token_get_all($src);
    $n = count($tokens);
    for($i = 0; $i < $n; $i++){
        if(!is_array($tokens[$i]) || $tokens[$i][0] !== T_FUNCTION)
            continue;
        $j = $i + 1;
        while($j < $n && is_array($tokens[$j]) && in_array($tokens[$j][0], array(T_WHITESPACE, T_COMMENT, T_DOC_COMMENT)))
            $j++;
        if($j >= $n || !is_array($tokens[$j]) || $tokens[$j][0] !== T_STRING || $tokens[$j][1] !== $name)
            continue;
        $code = "";
        $depth = 0;
        $started = FALSE;
        for($k = $i; $k < $n; $k++){
            $t = $tokens[$k];
            $code .= is_array($t) ? $t[1] : $t;
            if(!is_array($t)){
                if($t === "{"){ $depth++; $started = TRUE; }
                elseif($t === "}"){
                    $depth--;
                    if($started && $depth === 0)
                        return $code."\n";
                }
            }
            elseif($t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES)
                $depth++;
        }
    }
    return "";
}
// Блок разбора строк DATA: от `$GLOBALS["cur_parent"][0] = $up;` до конца `if($plain_data){ … }`
function core_plain_block($src){
    $start = strpos($src, '$GLOBALS["cur_parent"][0] = $up;');
    $if = strpos($src, 'if($plain_data){', $start);
    if($start === FALSE || $if === FALSE)
        return "";
    $tokens = token_get_all("<?php ".substr($src, $if));
    $code = ""; $depth = 0; $started = FALSE;
    foreach(array_slice($tokens, 1) as $t){
        $code .= is_array($t) ? $t[1] : $t;
        if(!is_array($t)){
            if($t === "{"){ $depth++; $started = TRUE; }
            elseif($t === "}" && --$depth === 0 && $started)
                return substr($src, $start, $if - $start).$code;
        }
        elseif($t[0] === T_CURLY_OPEN || $t[0] === T_DOLLAR_OPEN_CURLY_BRACES)
            $depth++;
    }
    return "";
}
$ROOT = dirname(__DIR__);
$CORE = file_get_contents("$ROOT/index.php");
$JA = file_get_contents("$ROOT/include/json_archive.php");
require_once "$ROOT/include/delimiters.php";
foreach(array("BATCH_ASIS" => -1, "BATCH_SCALAR" => 0, "BATCH_REF" => 1, "BATCH_MULTI" => 2, "BATCH_LIMIT" => 31000) as $k => $v)
    defined($k) || define($k, $v);
$code = "";
foreach(array("Insert", "UpdateTyp", "Update_Val", "Delete", "Insert_batch", "Batch_row_len"
            , "Batch_row_sql", "Drop_batch_column", "Maybe_flush_batch", "Flush_batch", "Boolean_Store_Val"
            , "UniqueKeyUnmaskRefValue", "UniqueKeySplitRefValues", "UniqueKeyNormalizeRefs") as $f)
    $code .= core_function($CORE, $f);
$code .= core_function($JA, "ImportField").core_function($JA, "ImportHasValue");
eval("namespace ".__NAMESPACE__."; ".$code);
$BLOCK = core_plain_block($CORE);
if($BLOCK === ""){
    echo "FAIL не найден блок разбора строк DATA в index.php\n";
    exit(1);
}

// ── Схема: справочники 200 «Вид сырья», 210 «Склад», 510 «Артикул», 310 «Отдел»;
// 100 «Партия сырья» (unique=1, ключ — Вид + Склад, первая колонка — дата прихода, как в atex);
// 300 «Сотрудник» (без уникальности); 500 «Позиция» в «Заказе» 400 (ключ — Артикул).
function schema(){
    $GLOBALS["DB"] = array(); $GLOBALS["NEXT_ID"] = 10000; $GLOBALS["WRITES"] = array();
    $GLOBALS["DB"][400] = array("id" => 400, "up" => 0, "ord" => 1, "t" => 3, "val" => "Заказ");
    $GLOBALS["DB"][401] = array("id" => 401, "up" => 400, "ord" => 1, "t" => 500, "val" => "");
    $GLOBALS["SCHEMA"] = array(
        100 => array("base" => "9", "uniq" => "1", "keys" => array(101, 102),
                     "reqs" => array(101 => array("ref" => 200), 102 => array("ref" => 210), 103 => array("base" => "13"), 104 => array("base" => "11"))),
        300 => array("base" => "3", "uniq" => "0", "keys" => array(),
                     "reqs" => array(301 => array("base" => "3"), 302 => array("ref" => 310), 303 => array("base" => "11"))),
        500 => array("base" => "13", "uniq" => "0", "keys" => array(501),
                     "reqs" => array(501 => array("ref" => 510), 502 => array("base" => "13"))));
}
function dict($t, $name){ return db_insert(1, 1, $t, $name); }
function rec($t, $up, $val, $reqs = array()){
    $id = db_insert($up, 1, $t, $val);
    foreach($reqs as $rid => $v){
        $d = $GLOBALS["SCHEMA"][$t]["reqs"][$rid];
        if(isset($d["ref"])){
            $ref = db_rows(function($r) use ($d, $v){ return $r["t"] == $d["ref"] && $r["val"] === $v; });
            db_insert($id, 1, count($ref) ? $ref[0]["id"] : dict($d["ref"], $v), (string)$rid);
        }
        else
            db_insert($id, 1, $rid, $v);
    }
    return $id;
}
// Записи типа: "значение | реквизит=значение, …" (ссылки — именем цели), по порядку id
function recs($t, $up = NULL){
    $out = array();
    foreach(db_rows(function($r) use ($t, $up){ return $r["t"] == $t && ($up === NULL || $r["up"] == $up); }) as $o){
        $parts = array();
        foreach(db_rows(function($r) use ($o){ return $r["up"] == $o["id"]; }) as $c){
            $d = isset($GLOBALS["SCHEMA"][$t]["reqs"][(int)$c["val"]]) ? $GLOBALS["SCHEMA"][$t]["reqs"][(int)$c["val"]] : NULL;
            if($d && isset($d["ref"]) && isset($GLOBALS["DB"][$c["t"]]) && $GLOBALS["DB"][$c["t"]]["t"] == $d["ref"])
                $parts[(int)$c["val"]] = $GLOBALS["DB"][$c["t"]]["val"];
            else
                $parts[$c["t"]] = $c["val"];
        }
        ksort($parts);
        $s = array(); foreach($parts as $k => $v) $s[] = "$k=$v";
        $out[] = $o["val"].($s ? " | ".implode(", ", $s) : "");
    }
    return $out;
}

// Загрузка DATA-строк в таблицу $id так, как её делает ядро на object/{id}?JSON&import=1
function import_rows($id, $rows, $req = array()){
    global $BLOCK;
    $S = $GLOBALS["SCHEMA"][$id];
    $GLOBALS["local_struct"] = array($id => array(0 => "v") + array_fill_keys(array_keys($S["reqs"]), "r"));
    $GLOBALS["refs"] = $GLOBALS["base"] = $GLOBALS["MULTI"] = array();
    $GLOBALS["base"][$id] = $S["base"];
    foreach($S["reqs"] as $rid => $d)
        if(isset($d["ref"])){ $GLOBALS["refs"][$rid] = $d["ref"]; $GLOBALS["base"][$rid] = "3"; }
        else $GLOBALS["base"][$rid] = $d["base"];
    $GLOBALS["uniq"] = array($id => $S["uniq"]);
    $GLOBALS["KEYS"] = array($id => $S["keys"]);
    $GLOBALS["REQDESC"] = array($id => array());
    foreach($S["reqs"] as $rid => $d)
        $GLOBALS["REQDESC"][$id][$rid] = array("id" => $rid, "t" => isset($d["ref"]) ? $d["ref"] : $rid
                                        , "ref_id" => isset($d["ref"]) ? $d["ref"] : 0, "multi" => false);
    $GLOBALS["parents"] = array($id => 0);
    $GLOBALS["warning"] = "";
    $GLOBALS["GLOBAL_VARS"] = array("api" => array());
    foreach(array("IMPORT_DRY", "IMPORT_WRITES", "IMPORT_DRY_ID", "IMPORT_DRY_PARENTS", "IMPORT_DRY_VALS"
                , "SQLbatch", "SQLbatchKeys", "SQLbatchLen", "LOG_IMPORT") as $g)
        unset($GLOBALS[$g]);
    $GLOBALS["WRITES"] = array();
    $_REQUEST = $_POST = $req;
    $file = tempnam(sys_get_temp_dir(), "i5673");
    file_put_contents($file, implode("\r\n", $rows)."\r\n");
    $handle = fopen($file, "r");
    $GLOBALS["z"] = $z = "t"; $up = 1; $plain_data = TRUE; $json_import = FALSE; $count = 1;
    $res = array("json" => NULL, "die" => NULL);
    try{
        eval("namespace ".__NAMESPACE__."; ".$BLOCK);
        Insert_batch("", "", "", "", "Import");	# как ядро после разбора строк
    }
    catch(JsonDie $e){ $res["json"] = json_decode($e->json, TRUE); }
    catch(DieException $e){ $res["die"] = $e->getMessage(); }
    if(is_resource($handle)) fclose($handle);
    unlink($file);
    $res["api"] = isset($GLOBALS["GLOBAL_VARS"]["api"]["import"]) ? $GLOBALS["GLOBAL_VARS"]["api"]["import"] : NULL;
    $res["warning"] = $GLOBALS["warning"];
    $GLOBALS["IMPORT_DRY"] = FALSE;
    return $res;
}
function counts($s){
    if(!is_array($s)) return "нет счётчиков";
    $o = array(); foreach(array("created", "updated", "unchanged", "deleted", "skipped", "parents") as $k) $o[] = "$k=".(isset($s[$k]) ? $s[$k] : "?");
    return implode(" ", $o);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
echo "1. Без новых параметров: «Партия сырья» atex — составной ключ при unique=1, дата в ключе\n";
schema();
dict(200, "MR377"); dict(200, "MW411"); dict(210, "Атех");
rec(100, 1, "14.06.2026", array(101 => "MR377", 102 => "Атех", 103 => "50"));
$file = array("14.06.2026;MR377;Атех;40;;", "14.06.2026;MW411;Атех;10;;");
$r = import_rows(100, $file);
ok($r["die"] === NULL, "импорт прошёл", shown($r["die"]));
ok(recs(100) === array("14.06.2026 | 101=MR377, 102=Атех, 103=40", "14.06.2026 | 101=MW411, 102=Атех, 103=10")
    , "запись по ключу обновлена, новая создана", shown(recs(100)));
ok(counts($r["api"]) === "created=1 updated=1 unchanged=0 deleted=0 skipped=0 parents=0", "счётчики в ответе", counts($r["api"]));
$r = import_rows(100, $file);
ok(count(recs(100)) === 2 && counts($r["api"]) === "created=0 updated=0 unchanged=2 deleted=0 skipped=0 parents=0"
    , "повтор того же файла: без изменений", counts($r["api"]));
$r = import_rows(100, array("15.06.2026;MR377;Атех;40;;"));
ok(count(recs(100)) === 3, "другая дата прихода — новая партия (дата входит в ключ)", shown(recs(100)));
$r = import_rows(100, array(";MR377;Атех;;;", ";Итого;Атех;;;"));
ok(recs(100) === array("14.06.2026 | 101=MW411, 102=Атех, 103=10", "15.06.2026 | 101=MR377, 102=Атех, 103=40")
    , "пустая первая колонка удаляет одну партию по ключу, «Итого» ничего не трогает", shown(recs(100)));
ok(counts($r["api"]) === "created=0 updated=0 unchanged=0 deleted=1 skipped=1 parents=0", "удалено / пропущено", counts($r["api"]));

echo "2. importKey = реквизит: «Сотрудник» без уникальности, ключ — табельный номер (не первая колонка)\n";
schema();
rec(300, 1, "Иванов", array(301 => "T1", 302 => "Склад"));
$file = array("Иванов И.И.;T1;Цех;;", "Петров;T2;Цех;;", "Сидоров;;Цех;;", ";T9;;;");
$r = import_rows(300, $file, array("importKey" => "301"));
ok($r["die"] === NULL, "импорт прошёл", shown($r["die"]));
ok(recs(300) === array("Иванов И.И. | 301=T1, 302=Цех", "Петров | 301=T2, 302=Цех")
    , "запись найдена по табельному: имя и отдел обновлены; пустой ключ пропущен", shown(recs(300)));
ok(counts($r["api"]) === "created=1 updated=1 unchanged=0 deleted=0 skipped=2 parents=0", "счётчики", counts($r["api"]));
$r = import_rows(300, $file, array("importKey" => "301"));
ok(count(recs(300)) === 2 && counts($r["api"]) === "created=0 updated=0 unchanged=2 deleted=0 skipped=2 parents=0"
    , "повторная загрузка того же файла не плодит дублей", counts($r["api"]).", ".shown(recs(300)));
$r = import_rows(300, array(";T2;;;"), array("importKey" => "301"));
ok(recs(300) === array("Иванов И.И. | 301=T1, 302=Цех"), "пустая первая колонка удаляет запись по выбранному ключу", shown(recs(300)));
$r = import_rows(300, array("Иванов И.И.;T1;Цех;;"));
ok(count(recs(300)) === 2, "без importKey таблица без уникальности, как и раньше, создаёт запись заново", shown(recs(300)));

echo "3. importKey = первая колонка\n";
schema();
rec(300, 1, "Иванов", array(301 => "T1"));
$r = import_rows(300, array("Иванов;T5;;;", ";T5;;;"), array("importKey" => "300"));
ok(recs(300) === array("Иванов | 301=T5"), "запись найдена по имени, пустое имя ничего не удаляет", shown(recs(300)));
ok(counts($r["api"]) === "created=0 updated=1 unchanged=0 deleted=0 skipped=1 parents=0", "счётчики", counts($r["api"]));
$r = import_rows(300, array("Иванов;T6;;;"), array("importKey" => "999"));
ok($r["die"] !== NULL && strpos($r["die"], "999") !== FALSE && recs(300) === array("Иванов | 301=T5")
    , "чужой ключ — отказ без записи", shown($r["die"]));

echo "4. dryRun: те же поиски без записи, счётчики и новые значения справочников в ответе\n";
schema();
rec(300, 1, "Иванов", array(301 => "T1", 302 => "Склад"));
$file = array("Иванов И.И.;T1;Цех;;", "Козлов;T7;Новый отдел;;", "Козлов;T7;Новый отдел;;", "Сидоров;;Цех;;");
$before = serialize($GLOBALS["DB"]);
$r = import_rows(300, $file, array("importKey" => "301", "dryRun" => "1"));
ok($r["die"] === NULL && is_array($r["json"]) && !empty($r["json"]["dryRun"]), "ответ пробного прогона", shown($r["die"]).shown($r["json"]));
ok(serialize($GLOBALS["DB"]) === $before && !count($GLOBALS["WRITES"]), "в базу ничего не записано", shown($GLOBALS["WRITES"]));
$dry = isset($r["json"]["import"]) ? $r["json"]["import"] : NULL;
ok(counts($dry) === "created=1 updated=2 unchanged=0 deleted=0 skipped=1 parents=0"
    , "повтор ключа внутри файла — одна новая запись, не две", counts($dry));
ok(isset($dry["refs"]) && $dry["refs"] == array(302 => array("Цех", "Новый отдел")), "новые значения справочника по колонке", shown($dry["refs"]));
$r = import_rows(300, $file, array("importKey" => "301"));
$real = $r["api"];
ok(counts($real) === counts($dry) && $real["refs"] == $dry["refs"], "настоящая загрузка дала те же счётчики", counts($real));
ok(recs(300) === array("Иванов И.И. | 301=T1, 302=Цех", "Козлов | 301=T7, 302=Новый отдел"), "и записала то, что обещал прогон", shown(recs(300)));
$r = import_rows(300, $file, array("importKey" => "301", "dryRun" => "1"));
ok(counts($r["json"]["import"]) === "created=0 updated=0 unchanged=3 deleted=0 skipped=1 parents=0" && !count($r["json"]["import"]["refs"])
    , "прогон после загрузки: всё без изменений", counts($r["json"]["import"]));

echo "5. dryRun с родителем из колонки и созданием родителя (импорт заказов atex)\n";
schema();
$o1 = rec(400, 1, "З-1");
rec(500, $o1, "5", array(501 => "A1"));
rec(500, $o1, "2", array(501 => "A9"));
$file = array("З-1;7;A1;;", "З-2;3;A2;;", "З-2;4;A3;;", "З-1;;A9;;");
$req = array("autoParent" => "400", "createParent" => "1");
$before = serialize($GLOBALS["DB"]);
$r = import_rows(500, $file, $req + array("dryRun" => "1"));
ok(serialize($GLOBALS["DB"]) === $before && !count($GLOBALS["WRITES"]), "в базу ничего не записано", shown($r["die"]).shown($GLOBALS["WRITES"]));
$dry = isset($r["json"]["import"]) ? $r["json"]["import"] : NULL;
ok(counts($dry) === "created=2 updated=1 unchanged=0 deleted=1 skipped=0 parents=1"
    , "новый заказ — один на две позиции; позиция без количества — удалена", counts($dry));
$r = import_rows(500, $file, $req);
ok(counts($r["api"]) === counts($dry), "настоящая загрузка дала те же счётчики", counts($r["api"]));
$o2 = db_rows(function($x){ return $x["t"] == 400 && $x["val"] === "З-2"; });
ok(recs(500, $o1) === array("7 | 501=A1") && count($o2) === 1 && recs(500, $o2[0]["id"]) === array("3 | 501=A2", "4 | 501=A3")
    , "позиции заказов: две новые позиции с новыми артикулами — две записи", shown(recs(500)));

echo "6. keepFilled: пробел и пустое «да/нет» не стирают значения (без флага — стирают, как раньше)\n";
schema();
rec(300, 1, "Орлов", array(301 => "T8", 303 => "1"));
$r = import_rows(300, array("Орлов; ;; ;"), array("importKey" => "300", "keepFilled" => "1"));
ok(recs(300) === array("Орлов | 301=T8, 303=1") && counts($r["api"]) === "created=0 updated=0 unchanged=1 deleted=0 skipped=0 parents=0"
    , "с keepFilled значения на месте", shown(recs(300)).counts($r["api"]));
$r = import_rows(300, array("Орлов; ;; ;"), array("importKey" => "300"));
ok(recs(300) === array("Орлов") && counts($r["api"]) === "created=0 updated=1 unchanged=0 deleted=0 skipped=0 parents=0"
    , "без флага пробел стирает текст и «да/нет»", shown(recs(300)).counts($r["api"]));

echo $failed ? "\nFAIL: $failed\n" : "\nPASS\n";
exit($failed ? 1 : 0);
