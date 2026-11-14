<?php
# ideav/python2node#1252: aiAgentScreenContext пропускает context.scripts — только статику базы
# /download/<база>/…js без ?версии и .., до 10 штук. Запуск: php experiments/ai-agent-page-scripts-p2n1252.test.php
# (обёртка гейта — ai-agent-page-scripts-p2n1252.test.js).

$failures = 0;
function expect($cond, $name){
    global $failures;
    echo ($cond ? "PASS: " : "FAIL: ").$name."\n";
    if(!$cond) $failures++;
}
function extract_function_source($source, $name){
    $start = strpos($source, "function ".$name."(");
    if($start === false) throw new Exception("not found: ".$name);
    $depth = 0;
    for($i = strpos($source, "{", $start); $i < strlen($source); $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}" && --$depth === 0) return substr($source, $start, $i - $start + 1);
    }
    throw new Exception("not closed: ".$name);
}
$index = getenv("INDEX_PHP") ?: __DIR__."/../index.php";
eval(extract_function_source(file_get_contents($index), "aiAgentScreenContext"));

$scripts = array(
    "/download/ateh/js/ref-search.js",
    "/download/ateh/js/production-planning.js?260101.168",
    "/download/ateh/js/production-planning.js",
    "https://evil.example/download/ateh/js/x.js",
    "/download/ateh/js/../../etc/x.js",
    "/download/ateh/./x.js",
    "/js/ai-agent-chat.js",
    "/download/ateh/css/a.css",
    array("x"), 5,
);
for($i = 0; $i < 20; $i++) $scripts[] = "/download/ateh/js/m$i.js";
$ctx = aiAgentScreenContext(json_encode(array("page" => "workplace", "workplace" => "production-planning",
    "scripts" => $scripts)));
$got = isset($ctx["scripts"]) ? $ctx["scripts"] : null;
expect(is_array($got) && $got[0] === "/download/ateh/js/ref-search.js" && $got[1] === "/download/ateh/js/production-planning.js",
    "#1252: скрипты статики базы проходят без ?версии");
expect(is_array($got) && count($got) === 10, "#1252: не больше 10 скриптов");
expect(is_array($got) && !preg_grep('~evil|\.\.|/\./|\.css|^/js/~', $got) && count(array_unique($got)) === count($got),
    "#1252: чужие хосты, .., css, скрипты вне /download/ и дубли отброшены");

$ctx = aiAgentScreenContext(json_encode(array("page" => "table", "table_id" => 18, "scripts" => "/download/ateh/a.js")));
expect(is_array($ctx) && !isset($ctx["scripts"]), "#1252: scripts не списком — поля нет");

if($failures){
    fwrite(STDERR, "FAILED: $failures check(s) failed\n");
    exit(1);
}
echo "\nALL TESTS PASSED\n";
