<?php
# Функция колонки RECURSIVE на MariaDB: LIMIT в рекурсивной части CTE MariaDB (10.11, 11.4)
# отвергает — ERROR 1235 "This version of MariaDB doesn't yet support 'global ORDER_BY/LIMIT
# in recursive CTE spec'". Меню, перенесённое со старого ядра (запрос rec с RECURSIVE),
# падало у всех пользователей on-premise установки на MariaDB.
#
# Запуск: php experiments/recursive-mariadb-limit.test.php (в гейте — через одноимённый .test.js)
# Живая проверка на сервере БД (MariaDB и MySQL):
#   TEST_DB_HOST=… TEST_DB_USER=… TEST_DB_PASS=… TEST_DB_NAME=… php experiments/recursive-mariadb-limit.test.php
#
# Исполняется РЕАЛЬНЫЙ фрагмент index.php — от `$rec_limit = …` до трассировки готового SQL
# (приём recursive-recboth): фрагмент вырезается по якорям и исполняется eval-ом.
#
# Что проверяется:
#   1) MySQL: SQL байт-в-байт прежний (LIMIT внутри CTE — так на проде ideav.ru);
#   2) MariaDB: в рекурсивной части CTE нет LIMIT, ограничение числа строк сохранено;
#   3) (живьём) запрос исполняется сам по себе и подзапросом в IN(...), как его подставляет
#      ядро, на настоящем сервере; LIMIT ограничивает выдачу; цикл в графе не зацикливает обход.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

$src = file_get_contents(__DIR__."/../index.php");
$start = strpos($src, "\t\t\$rec_limit = \"LIMIT \".DDLIST_ITEMS;");
$end = $start === false ? false : strpos($src, "trace(\"RECURSIVE \".", $start);
if($start === false || $end === false){ echo "FAIL: фрагмент RECURSIVE не найден по якорям (дрейф index.php)\n"; exit(1); }
$GLOBALS['__fragment'] = substr($src, $start, $end - $start);

if(!defined("DDLIST_ITEMS")) define("DDLIST_ITEMS", 80);

# Сервер БД, на котором «исполняется» ядро: в index.php его определяет Is_mariadb()
# по mysqli_get_server_info соединения; здесь — подменой.
$GLOBALS['__is_maria'] = false;
if(!function_exists("Is_mariadb")){
    function Is_mariadb($connection = NULL){ return $GLOBALS['__is_maria']; }
}

# Фрагмент использует: $id, $z, $typ, $cond, $name, $_REQUEST, $GLOBALS["STORED_REPS"].
function run_fragment($maria, $selfRef, $z = "rep", $typ = 7, $refVal = "230", $request = array(), $cond = " AND id IS NOT NULL"){
    $GLOBALS['__is_maria'] = $maria;
    $GLOBALS["STORED_REPS"] = [];
    $id = 42; $name = "'Колонка'";
    $GLOBALS["STORED_REPS"][$id] = ["types" => [null, $typ]];
    if($selfRef) $GLOBALS["STORED_REPS"][$id]["references"][$typ][$typ] = $refVal;
    $_REQUEST = $request;
    eval($GLOBALS['__fragment']);
    return $GLOBALS["STORED_REPS"][$id]["sql"];
}

# Тело рекурсивного CTE: от "WITH RECURSIVE c AS (" до парной скобки.
function cte_body($sql){
    $p = strpos($sql, "WITH RECURSIVE c AS (");
    if($p === false) return null;
    $i = $p + strlen("WITH RECURSIVE c AS (");
    $depth = 1; $q = false;
    for($j = $i; $j < strlen($sql); $j++){
        $ch = $sql[$j];
        if($ch === "'" ) $q = !$q;
        if($q) continue;
        if($ch === "(") $depth++;
        if($ch === ")" && --$depth === 0) return substr($sql, $i, $j - $i);
    }
    return null;
}

# 1. MySQL — байт-в-байт прежний SQL.
expect(run_fragment(false, true) === " WITH RECURSIVE c AS (SELECT id, 0 t FROM rep WHERE t=7 AND up!=0 AND t!=up  AND id IS NOT NULL"
        ."  UNION SELECT ref.up id, ref.t FROM rep ref INNER JOIN c ON c.id=ref.t WHERE ref.val='230' LIMIT 80)"
        ." SELECT DISTINCT id 'Колонка' FROM c",
    "MySQL самоссылка: SQL байт-в-байт прежний");
expect(run_fragment(false, false) === " WITH RECURSIVE c AS (SELECT id, 0 t FROM rep WHERE t=7 AND up!=0 AND t!=up AND val!=''  AND id IS NOT NULL"
        ."  UNION SELECT ref.id id, ref.t FROM rep ref INNER JOIN c ON c.id=ref.up WHERE ref.t=7 LIMIT 80)"
        ." SELECT DISTINCT id 'Колонка' FROM c",
    "MySQL дерево: SQL байт-в-байт прежний");

# 2. MariaDB — в рекурсивной части нет LIMIT, ограничение выдачи осталось.
foreach(array(true => "самоссылка", false => "дерево") as $self => $label)
    foreach(array(array(), array("RECBOTH" => "1"), array("LIMIT" => "0,5")) as $req){
        $sql = run_fragment(true, (bool)$self, "rep", 7, "230", $req);
        $body = cte_body($sql);
        $lim = isset($req["LIMIT"]) ? "LIMIT 5" : "LIMIT 80";
        expect($body !== null && stripos($body, "LIMIT") === false,
            "MariaDB $label ".json_encode($req).": в рекурсивной части CTE нет LIMIT — $sql");
        expect(strpos($sql, $lim) !== false, "MariaDB $label ".json_encode($req).": выдача ограничена $lim");
    }

# 3. Живьём на сервере БД.
$host = getenv("TEST_DB_HOST");
if($host && function_exists("mysqli_connect")){
    mysqli_report(MYSQLI_REPORT_OFF);
    $c = mysqli_connect($host, getenv("TEST_DB_USER"), getenv("TEST_DB_PASS"), getenv("TEST_DB_NAME"), (int)(getenv("TEST_DB_PORT") ?: 3306));
    expect((bool)$c, "соединение с $host");
    if($c){
        mysqli_set_charset($c, "utf8mb4");
        $server = mysqli_get_server_info($c);
        $maria = stripos($server, "mariadb") !== false;
        echo "server: $server (".($maria ? "MariaDB" : "MySQL").")\n";
        $z = "rec_mariadb_limit_t";
        mysqli_query($c, "DROP TABLE IF EXISTS $z");
        mysqli_query($c, "CREATE TABLE $z (id INT PRIMARY KEY, up INT NOT NULL, ord INT NOT NULL DEFAULT 0, t INT NOT NULL, val VARCHAR(100) NOT NULL DEFAULT '')");
        # Термин 7 «Пункт» с самоссылкой-реквизитом 8 (t=7) — как «Меню→Меню» после переноса.
        # Объекты 100..129 под корнем; связи 100→101→…→129 и замыкание 129→100 (цикл).
        $rows = array("(7,0,0,7,'Пункт')", "(8,7,1,7,'')");
        for($k = 100; $k < 130; $k++){
            $rows[] = "($k,1,0,7,'Пункт $k')";
            $next = $k == 129 ? 100 : $k + 1;
            $rows[] = "(".($k + 1000).",$next,1,$k,'8')"; # up=объект-сосед, t=объект, val=реквизит
        }
        mysqli_query($c, "INSERT INTO $z (id,up,ord,t,val) VALUES ".implode(",", $rows));
        foreach(array(array("self" => true, "lim" => 5), array("self" => true, "lim" => 1000),
                      array("self" => false, "lim" => 5), array("self" => false, "lim" => 1000)) as $case){
            $label = ($case["self"] ? "самоссылка" : "дерево")." LIMIT ".$case["lim"];
            $sql = run_fragment($maria, $case["self"], $z, 7, "8", array("LIMIT" => "0,".$case["lim"]), " AND id=100");
            $res = mysqli_query($c, $sql);
            expect($res !== false, "$label: запрос исполняется — ".mysqli_error($c));
            $ids = array();
            if($res) while($r = mysqli_fetch_row($res)) $ids[] = (int)$r[0];
            echo "  $label: ".count($ids)." строк\n";
            if($case["self"])
                expect(count($ids) == min($case["lim"], 30), "$label: выдача = min(LIMIT, 30 объектов цикла)");
            else
                expect(count($ids) == 1, "$label: дерево из одного объекта");
            $in = mysqli_query($c, "SELECT id FROM $z WHERE id IN($sql)");
            expect($in !== false, "$label: запрос исполняется подзапросом в IN(...) — ".mysqli_error($c));
            if($in) expect(mysqli_num_rows($in) == count($ids), "$label: IN(...) отдаёт те же строки");
        }
        mysqli_query($c, "DROP TABLE IF EXISTS $z");
    }
}
else
    echo "SKIP live: TEST_DB_HOST не задан или нет mysqli\n";

exit($failures ? 1 : 0);
