<?php
# crm#5435: ИИ-чат терял свои ответы — после повторного открытия диалога видны вопросы
# пользователя, а ответов агента нет.
#
# Ответ асинхронного агента приходит callback'ом. Маршрут callback стоит в начале index.php
# (до подключения к БД) и завершает запрос там же. PHP-функции видны во всём файле сразу, а
# define() срабатывает, только когда выполнение до него дошло. Константы истории диалогов
# (AI_AGENT_CHAT_*) объявлялись ниже маршрута, поэтому в callback aiAgentChatSaveTurn() падала
# Fatal «Undefined constant»: задача становилась done, а ход в истории навсегда оставался
# processing без ответа, и callback отвечал 500.
#
# Мерка воспроизводит условия callback: в дочернем PHP-процессе определены ТОЛЬКО константы,
# объявленные в index.php до маршрута callback, а функции aiAgent*, как и в PHP, доступны все.
# Через настоящий handleAiAgentCallback() приходит ответ:
#   1) в новый диалог (название диалога → AI_AGENT_CHAT_TITLE_LEN);
#   2) в существующий диалог (лимит ходов → AI_AGENT_CHAT_TURNS_MAX).
# В обоих случаях ход в истории должен стать done и содержать текст ответа.

$failures = 0;
function expect($cond, $name){
    global $failures;
    if($cond){ echo "PASS: $name\n"; } else { echo "FAIL: $name\n"; $failures++; }
}

function extract_function_source($source, $start){
    $brace = strpos($source, "{", $start);
    $depth = 0; $len = strlen($source);
    for($i = $brace; $i < $len; $i++){
        if($source[$i] === "{") $depth++;
        elseif($source[$i] === "}"){ $depth--; if($depth === 0) return substr($source, $start, $i - $start + 1); }
    }
    throw new Exception("function not closed at ".$start);
}

$source = file_get_contents(__DIR__."/../index.php");

# Граница: вызов handleAiAgentCallback($z) в диспетчере — всё, что ниже, в callback не выполняется.
$dispatch = strpos($source, "    handleAiAgentCallback(\$z);");
if($dispatch === false){
    echo "FAIL: не найден вызов handleAiAgentCallback(\$z) в диспетчере index.php\n";
    exit(1);
}
$head = substr($source, 0, $dispatch);

# Константы, объявленные до маршрута callback (строки верхнего уровня с define).
preg_match_all('/^(?:if\(!defined\("[A-Z0-9_]+"\)\) |defined\("[A-Z0-9_]+"\) \|\| )?define\("([A-Z0-9_]+)",.*;/m', $head, $m, PREG_SET_ORDER);
$defines = "";
foreach($m as $row){
    if($row[1] === "LOGS_DIR")
        continue;   # каталог логов — временный, задаётся мерой
    $line = preg_replace('/;\s*#.*$/', ';', $row[0]);
    $defines .= "try { ".$line." } catch(\\Throwable \$e) {}\n";
}

# Функции ИИ-агента — все (функции в PHP видны до строки объявления), кроме ввода тела запроса.
preg_match_all('/^function (aiAgent[A-Za-z]*|handleAiAgentCallback)\(/m', $source, $fm, PREG_OFFSET_CAPTURE);
$fns = "";
foreach($fm[1] as $f){
    if($f[0] === "aiAgentRawInput")
        continue;
    $fns .= extract_function_source($source, $f[1] - strlen("function "))."\n";
}

$tmp = sys_get_temp_dir()."/ai5435_".getmypid()."_".mt_rand();
@mkdir($tmp."/logs", 0700, true);

function child_script($defines, $fns, $logs, $body, $secret){
    return '<?php
define("LOGS_DIR", '.var_export($logs."/", true).');
'.$defines.'
function t9n($s){ return preg_replace("/^\\[RU\\](.*?)\\[EN\\].*$/su", "$1", $s); }
function aiConfigValue($keys){ return ""; }
function aiChatHttpStatusText($c){ return "Status"; }
function api_dump($json, $name = "api.json"){ echo $json; exit; }
function aiAgentRawInput(){ return '.var_export($body, true).'; }
$_SERVER["REQUEST_METHOD"] = "POST";
$_SERVER["HTTP_X_AGENT_SECRET"] = '.var_export($secret, true).';
'.$fns.'
handleAiAgentCallback("t5435");
';
}

function run_child($script){
    $file = tempnam(sys_get_temp_dir(), "ai5435");
    file_put_contents($file, $script);
    $out = array(); $code = 0;
    exec(escapeshellarg(PHP_BINARY)." -d display_errors=stdout ".escapeshellarg($file)." 2>&1", $out, $code);
    @unlink($file);
    return array(implode("\n", $out), $code);
}

# Задача в файле задач базы — как её оставил POST вопроса (status processing, секрет callback).
function put_job($jobId, $conversation, $secret){
    $now = time();
    $job = array("id" => $jobId, "user" => "liza", "createdAt" => $now, "updatedAt" => $now,
        "status" => "processing", "message" => "сделай перенос мышкой", "attachments" => array(),
        "result" => null, "error" => null, "conversation" => $conversation, "callbackSecret" => $secret);
    file_put_contents(sys_get_temp_dir()."/ai_agent_jobs_t5435.json", json_encode(array("jobs" => array($job)), JSON_UNESCAPED_UNICODE));
}

function chats_of($logs){
    $path = $logs."/ai_chats/t5435/".sha1("liza").".json";
    $data = is_readable($path) ? json_decode(file_get_contents($path), true) : null;
    return is_array($data) && isset($data["chats"]) ? $data["chats"] : array();
}
function turn_of($chats, $conversation, $jobId){
    foreach($chats as $c)
        if($c["id"] === $conversation)
            foreach($c["turns"] as $t)
                if($t["id"] === $jobId)
                    return $t;
    return null;
}

$secret = "sec5435";
$conversation = "d9cd48e55d0e97cd027eba080338888b";

# 1) Первый ответ в новом диалоге.
$job1 = "0a43c5ec00000000000000000000aaaa";
put_job($job1, $conversation, $secret);
list($out, $code) = run_child(child_script($defines, $fns, $tmp."/logs",
    json_encode(array("job_id" => $job1, "status" => "done", "content" => "Готово: перенос мышкой включён")), $secret));
$turn = turn_of(chats_of($tmp."/logs"), $conversation, $job1);
expect(stripos($out, "Fatal") === false && $code === 0, "новый диалог: callback без Fatal (код $code)");
expect(strpos($out, '"status":"done"') !== false, "новый диалог: callback ответил done");
expect($turn !== null && $turn["status"] === "done", "новый диалог: ход в истории done (был: ".($turn ? $turn["status"] : "нет хода").")");
expect($turn !== null && isset($turn["result"]["assistant"]["content"]) && $turn["result"]["assistant"]["content"] === "Готово: перенос мышкой включён",
    "новый диалог: в истории есть текст ответа агента");
if(stripos($out, "Fatal") !== false) echo "  вывод: ".substr($out, 0, 300)."\n";

# 2) Следующий ответ в существующем диалоге (ход сначала записан как processing — так делает POST).
$job2 = "628e91b200000000000000000000bbbb";
$now = time();
$chats = chats_of($tmp."/logs");
if(!count($chats))
    $chats = array(array("id" => $conversation, "title" => "сделай перенос мышкой", "createdAt" => $now, "updatedAt" => $now, "turns" => array()));
$chats[0]["turns"][] = array("id" => $job2, "status" => "processing", "createdAt" => $now, "updatedAt" => $now,
    "message" => "проверь встало ли изменение?", "attachments" => array(), "result" => null, "error" => null, "progress" => null);
@mkdir($tmp."/logs/ai_chats/t5435", 0700, true);
file_put_contents($tmp."/logs/ai_chats/t5435/".sha1("liza").".json", json_encode(array("chats" => $chats), JSON_UNESCAPED_UNICODE));
put_job($job2, $conversation, $secret);
list($out, $code) = run_child(child_script($defines, $fns, $tmp."/logs",
    json_encode(array("job_id" => $job2, "status" => "done", "content" => "Да, изменение на месте")), $secret));
$turn = turn_of(chats_of($tmp."/logs"), $conversation, $job2);
expect(stripos($out, "Fatal") === false && $code === 0, "существующий диалог: callback без Fatal (код $code)");
expect($turn !== null && $turn["status"] === "done", "существующий диалог: ход в истории done (был: ".($turn ? $turn["status"] : "нет хода").")");
expect($turn !== null && isset($turn["result"]["assistant"]["content"]) && $turn["result"]["assistant"]["content"] === "Да, изменение на месте",
    "существующий диалог: в истории есть текст ответа агента");
if(stripos($out, "Fatal") !== false) echo "  вывод: ".substr($out, 0, 300)."\n";

@unlink(sys_get_temp_dir()."/ai_agent_jobs_t5435.json");
foreach(glob($tmp."/logs/ai_chats/t5435/*") as $f) @unlink($f);
@rmdir($tmp."/logs/ai_chats/t5435"); @rmdir($tmp."/logs/ai_chats"); @rmdir($tmp."/logs"); @rmdir($tmp);

echo $failures ? "\n$failures FAIL\n" : "\nALL PASS\n";
exit($failures ? 1 : 0);
