<?php
# Мерка к python2node#839 (решение владельца из python2node#778/#779): ИИ своего пользователя
# не имеет и ходит токеном пользователя, помечая запросы параметром client=ai. В логах базы
# (<db>_log.txt, <db>_sql.txt) такой запрос пишется под логином с суффиксом ~ai.
#
# Запуск: php experiments/ai-log-suffix-839.test.php (в гейте — через одноимённый .test.js)

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}
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
$source = file_get_contents(__DIR__."/../index.php");
try {
    eval(extract_function_source($source, "aiLogUser"));
} catch(Exception $e) {
    echo "FAIL: в index.php нет aiLogUser() — ".$e->getMessage()."\n";
    echo "\nFAILED: 1 check(s) failed\n";
    exit(1);
}

function as_request($user, $get = array(), $post = array()){
    $GLOBALS["GLOBAL_VARS"] = $user === null ? array() : array("user" => $user);
    $_GET = $get; $_POST = $post; $_REQUEST = array_merge($get, $post);
}

as_request("ivanov");
expect(aiLogUser() === "ivanov", "обычный запрос — логин как есть");

as_request("ivanov", array("client" => "ai"));
expect(aiLogUser() === "ivanov~ai", "client=ai в строке запроса — ivanov~ai");

as_request("ivanov", array(), array("client" => "ai"));
expect(aiLogUser() === "ivanov~ai", "client=ai в теле POST — ivanov~ai");

as_request("ivanov", array("client" => "AI"));
expect(aiLogUser() === "ivanov~ai", "регистр значения client не важен");

as_request("ivanov", array("client" => "web"));
expect(aiLogUser() === "ivanov", "другой client — без суффикса");

as_request("ivanov", array("client" => array("ai")));
expect(aiLogUser() === "ivanov", "client массивом — не метка ИИ и не падение");

as_request(null, array("client" => "ai"));
expect(aiLogUser() === "~ai", "до входа (логина нет) ИИ всё равно помечен");

as_request(null);
expect(aiLogUser() === "", "до входа без метки — пусто, как раньше");

echo "\n";
if($failures){ echo "FAILED: $failures check(s) failed\n"; exit(1); }
echo "ALL TESTS PASSED\n";
