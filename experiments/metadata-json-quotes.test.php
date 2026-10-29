<?php
# metadata и obj_meta обязаны отдавать валидный JSON при любых символах в именах таблиц и
# колонок: кавычки " и ', обратная косая черта, проценты, эмодзи, управляющие символы.
# Найдено при переносе базы в on-premise установку: имя «Объект "О'Брайен"» ломало
# /<база>/metadata?JSON у фронта (JSON.parse) — `"` не экранировался, `'` становился `\'`.
#
# Запуск: php experiments/metadata-json-quotes.test.php (в гейте — через одноимённый .test.js)
#
# Исполняется РЕАЛЬНЫЙ код ветвей case "obj_meta" и case "metadata" из index.php: он
# вырезается по меткам case и исполняется eval-ом; Exec_sql, api_dump и выборка строк
# подменены — вместо БД строки, какие отдал бы запрос.

error_reporting(E_ALL & ~E_DEPRECATED);
require __DIR__ . "/../include/field_attrs.php";

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

$src = file_get_contents(__DIR__."/../index.php");
$start = strpos($src, "case \"obj_meta\":");
$end = $start === false ? false : strpos($src, "case \"exit\":", $start);
if($start === false || $end === false || strpos(substr($src, $start, $end - $start), "case \"metadata\":") === false){
    echo "FAIL: ветви obj_meta/metadata не найдены по меткам case (дрейф index.php)\n"; exit(1);
}
# Функции index.php, которыми пользуются ветви (если они есть), — настоящие, не подмены.
foreach(array("Json_str") as $fn)
    if(preg_match("/\nfunction $fn\(.*?\n\}\n/s", str_replace("\r\n", "\n", $src), $m))
        eval(substr($m[0], 1));
# Строки результата отдаёт подмена: mysqli_fetch_array встроенная, её не переопределить.
$GLOBALS['__fragment'] = str_replace("mysqli_fetch_array(\$data_set)", "fake_fetch(\$data_set)", substr($src, $start, $end - $start));

if(!defined("MYSQLI_ASSOC")) define("MYSQLI_ASSOC", 1); # php без расширения mysqli
class FakeResult {
    public $rows; public $i = 0;
    function __construct($rows){ $this->rows = $rows; }
    function fetch_all($mode = 0){ return $this->rows; }
}
function fake_fetch($r){ return $r->i < count($r->rows) ? $r->rows[$r->i++] : null; }
function Exec_sql($sql, $why){ return new FakeResult($GLOBALS['__rows']); }
class ApiDump extends Exception {}
function api_dump($json, $name = "api.json"){ $GLOBALS['__out'] = $json; throw new ApiDump(); }

function run_action($a, $id, $rows){
    $GLOBALS['__rows'] = $rows; $GLOBALS['__out'] = null;
    $GLOBALS["GRANTS"] = array(1 => "WRITE");
    $z = "base";
    try { eval("switch(\$a){ ".$GLOBALS['__fragment']." }"); } catch(ApiDump $e) {}
    return $GLOBALS['__out'];
}

$names = array(
    "Объект \"О'Брайен\" 50% \\ 🛡",
    "Кратко O'Reilly",
    "Таб\tи\nперевод строки / слэш",
);
$alias = "Псевдоним \"к\" O'K \\";

# --- metadata: таблица 500 с самоописателем (псевдоним) и колонкой 501 ---
function metaRows($tbl, $col, $alias){
    $base = array("id" => "500", "up" => "0", "t" => "3", "uniq" => "0", "val" => $tbl, "arr_id" => null, "ref" => null);
    return array(
        $base + array("req_t" => "499", "ref_id" => "500", "attrs" => FieldAttrsBuild("", false, false, $alias), "ord" => "0", "base_typ" => "3", "req_val" => ""),
        $base + array("req_t" => "501", "ref_id" => "3", "attrs" => "", "ord" => "1", "base_typ" => "3", "req_val" => $col),
    );
}
foreach($names as $tbl) foreach($names as $col){
    $label = json_encode(array($tbl, $col), JSON_UNESCAPED_UNICODE);
    foreach(array(500 => "metadata/500", 0 => "metadata") as $id => $what){
        $out = run_action("metadata", $id, metaRows($tbl, $col, $alias));
        $j = json_decode((string)$out, true);
        expect(is_array($j), "$what $label: валидный JSON — $out");
        if(!is_array($j)) continue;
        $t = $id ? $j : $j[0];
        expect(isset($t["val"]) && $t["val"] === $tbl, "$what $label: имя таблицы прочитано как есть");
        expect(isset($t["alias"]) && $t["alias"] === $alias, "$what $label: псевдоним прочитан как есть");
        expect(isset($t["reqs"][0]["val"]) && $t["reqs"][0]["val"] === $col, "$what $label: имя колонки прочитано как есть");
    }
    # --- obj_meta: объект 500 той же таблицы ---
    $out = run_action("obj_meta", 500, array(
        array("id" => "500", "up" => "1", "t" => "3", "val" => $tbl, "req_t" => "501", "ref_id" => "3", "ref" => null,
              "attrs" => "", "ord" => "1", "base_typ" => "3", "req_val" => $col, "arr_id" => null),
    ));
    $j = json_decode((string)$out, true);
    expect(is_array($j), "obj_meta $label: валидный JSON — $out");
    if(is_array($j)){
        expect($j["val"] === $tbl, "obj_meta $label: значение прочитано как есть");
        expect(isset($j["reqs"]["1"]["val"]) && $j["reqs"]["1"]["val"] === $col, "obj_meta $label: имя колонки прочитано как есть");
    }
}

exit($failures ? 1 : 0);
