<?php
# Мерка к issue #5432: шаблон, вставляющий сам себя через маркер File, не роняет ядро.
# https://github.com/ideav/crm/issues/5432
#
# Запуск: php experiments/template-self-include-5432.test.php (в гейте — через одноимённый .test.js)
#
# Маркер File: a подставляет файл действия (<действие>.html), маркер File: x — файл из ?x=имя.
# Действие main (GET /<база>/main) вставляло main.html в самого себя, Make_tree уходил в
# бесконечную рекурсию и падал по памяти (Allowed memory size … exhausted). Правило: файл,
# который уже разбирается выше по цепочке (и сам main.html), повторно не вставляется — вместо
# него info.html, а если и он в цепочке — ничего. Проверяются оба ядра: index.php и integram.io/index.php. Каждый случай — в своём процессе php с
# ограничением памяти: без правила процесс падает, а не виснет.

if(isset($argv[1]) && $argv[1] === "--case"){
    ini_set("memory_limit", "64M");
    $case = json_decode(base64_decode($argv[2]), true);

    function extract_function_source($source, $name){
        $start = strpos($source, "\nfunction ".$name."(");
        if($start === false) throw new Exception("not found: ".$name);
        $end = strpos($source, "\nfunction ", $start + 1);
        return substr($source, $start, ($end === false ? strlen($source) : $end) - $start);
    }
    $src = file_get_contents(__DIR__."/../".$case["core"]);
    foreach(array("Make_tree", "Parse_block") as $fn)
        eval(extract_function_source($src, $fn));

    $FILES = $case["files"];
    function Get_file($file, $fatal=TRUE){
        global $FILES;
        if(isset($FILES[$file])) return $FILES[$file];
        if($fatal) throw new Exception("no file $file");
        return "";
    }
    function Get_block_data($block){ global $blocks; if($block === "&main") $blocks[$block]["z"][] = "shop"; }
    function trace($text){}
    function isApi(){ return FALSE; }
    function BuiltIn($par){ return $par; }
    function t9n($text){ return $text; }
    function die_info($msg){ throw new Exception($msg); }

    $blocks = array();
    $_GET = $_REQUEST = $case["get"];
    $GLOBALS["GLOBAL_VARS"] = array("z"=>"shop", "action"=>$case["action"]);
    Make_tree(Get_file("main.html"), "&main");
    echo Parse_block("&main");
    exit(0);
}

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
function run_case($files, $action, $get = array()){
    global $CORE;
    $arg = base64_encode(json_encode(array("core"=>$CORE, "files"=>$files, "action"=>$action, "get"=>(object)$get)));
    $cmd = escapeshellarg(PHP_BINARY)." ".escapeshellarg(__FILE__)." --case ".escapeshellarg($arg)." 2>&1";
    exec($cmd, $out, $code);
    return array($code, implode("\n", $out));
}

foreach(array("index.php", "integram.io/index.php") as $CORE){
echo "== ядро $CORE
";
$files = array(
    "main.html" => "<body>[MAIN]<!-- File: a --></body>",
    "info.html" => "[INFO]",
    "object.html" => "[OBJECT]",
    "loop.html" => "[LOOP]<!-- File: a -->",
);

list($code, $page) = run_case($files, "object");
expect($code === 0 && $page === "<body>[MAIN][OBJECT]</body>", "действие object: его файл вставлен как прежде");

list($code, $page) = run_case($files, "");
expect($code === 0 && $page === "<body>[MAIN][INFO]</body>", "главная: info.html как прежде");

list($code, $page) = run_case($files, "main");
expect($code === 0, "действие main: разбор завершается (код $code)");
expect($page === "<body>[MAIN][INFO]</body>", "действие main: вместо main.html — info.html");

list($code, $page) = run_case($files, "MAIN");
expect($code === 0 && strpos($page, "Allowed memory") === FALSE, "действие MAIN: имя сравнивается без учёта регистра");

list($code, $page) = run_case($files, "loop");
expect($code === 0, "файл, вставляющий сам себя через File: a, не зацикливается (код $code)");
expect($page === "<body>[MAIN][LOOP][INFO]</body>", "повторная вставка файла заменена на info.html");

$x = $files;
$x["main.html"] = "<body>[MAIN]<!-- File: x --></body>";
$x["x.html"] = "[X]";
list($code, $page) = run_case($x, "", array("x"=>"main"));
expect($code === 0 && $page === "<body>[MAIN][INFO]</body>", "?x=main в маркере File: x не вставляет main.html в себя");
list($code, $page) = run_case($x, "", array("x"=>"object"));
expect($code === 0 && $page === "<body>[MAIN][OBJECT]</body>", "?x=object выбирает файл как прежде");

$y = $files;
$y["info.html"] = "[INFO]<!-- File: a -->";
list($code, $page) = run_case($y, "");
expect($code === 0 && $page === "<body>[MAIN][INFO]</body>", "info.html, вставляющий сам себя, вставляется один раз");
}

echo $failures ? "\n$failures FAIL\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
