<?php
# Regression test for issue #3410
# https://github.com/ideav/crm/issues/3410
#
# Асинхронная работа ИИ-агента: запрос сохраняется как задача (job) в серверном
# хранилище (JSON-файл во временной директории, ключ — имя базы). Это нужно, чтобы
# показывать «агент думает», переживать таймаут сервера и не терять результат при
# повторном открытии панели (в т.ч. из другого браузера).
#
# Тест извлекает чистые функции работы с задачами из index.php и проверяет:
#   1) создание задачи (статус queued, нормализация полей);
#   2) операции над списком (append с ограничением, find, latest, prune, replace);
#   3) публичное представление (результат только у завершённой задачи);
#   4) файловый round-trip create → update → get → latest с реальным хранилищем.

$failures = 0;

function check($cond, $name){
    global $failures;
    if($cond){
        echo "PASS: $name\n";
    } else {
        echo "FAIL: $name\n";
        $failures++;
    }
}

# Хранилище ограничено этими лимитами (как в index.php).
define("AI_AGENT_JOBS_MAX", 20);
define("AI_AGENT_JOBS_TTL", 24 * 3600);

function extract_function_source($source, $name){
    $needle = "function ".$name."(";
    $start = strpos($source, $needle);
    if($start === false)
        throw new Exception("Function not found: ".$name);
    $brace = strpos($source, "{", $start);
    if($brace === false)
        throw new Exception("Function body not found: ".$name);
    $depth = 0;
    $length = strlen($source);
    for($i = $brace; $i < $length; $i++){
        if($source[$i] === "{")
            $depth++;
        elseif($source[$i] === "}"){
            $depth--;
            if($depth === 0)
                return substr($source, $start, $i - $start + 1);
        }
    }
    throw new Exception("Function body is not closed: ".$name);
}

$source = file_get_contents(__DIR__."/../index.php");
$fns = array(
    "aiAgentJobsFile", "aiAgentJobId", "aiAgentJobNew",
    "aiAgentJobsAppend", "aiAgentJobsFind", "aiAgentJobsLatest", "aiAgentJobsPrune",
    "aiAgentJobsApplyChanges", "aiAgentJobsReplace", "aiAgentJobPublic",
    "aiAgentJobsEncode", "aiAgentJobsDecode", "aiAgentJobsLoadRaw", "aiAgentJobsMutate",
    "aiAgentJobCreate", "aiAgentJobUpdate", "aiAgentJobGet", "aiAgentJobLatest"
);
foreach($fns as $fn)
    eval(extract_function_source($source, $fn));

# 1) Создание задачи.
$now = 1000000;
$job = aiAgentJobNew("привет", array("a.txt", 42), $now);
check($job["status"] === "queued", "new job starts in 'queued' status");
check($job["message"] === "привет", "new job keeps the message");
check($job["createdAt"] === $now && $job["updatedAt"] === $now, "new job stamps createdAt/updatedAt");
check($job["result"] === null && $job["error"] === null, "new job has no result/error yet");
check($job["attachments"] === array("a.txt", "42"), "attachment names normalized to strings");
check(is_string($job["id"]) && strlen($job["id"]) >= 16, "new job gets a non-trivial id");
check($job["id"] !== aiAgentJobNew("x", array(), $now)["id"], "job ids are unique");

# 2) Операции над списком.
$jobs = array();
for($i = 0; $i < 25; $i++)
    $jobs = aiAgentJobsAppend($jobs, array("id" => "j$i", "createdAt" => $now + $i), AI_AGENT_JOBS_MAX);
check(count($jobs) === AI_AGENT_JOBS_MAX, "append caps the list at AI_AGENT_JOBS_MAX");
check($jobs[0]["id"] === "j5" && $jobs[19]["id"] === "j24", "append keeps the most recent jobs");

check(aiAgentJobsFind($jobs, "j10")["id"] === "j10", "find returns the matching job");
check(aiAgentJobsFind($jobs, "nope") === null, "find returns null for unknown id");
check(aiAgentJobsLatest($jobs)["id"] === "j24", "latest returns the newest by createdAt");
check(aiAgentJobsLatest(array()) === null, "latest of empty list is null");

$mixed = array(
    array("id" => "old", "createdAt" => $now - 2 * AI_AGENT_JOBS_TTL),
    array("id" => "fresh", "createdAt" => $now)
);
$pruned = aiAgentJobsPrune($mixed, $now, AI_AGENT_JOBS_TTL);
check(count($pruned) === 1 && $pruned[0]["id"] === "fresh", "prune drops jobs older than TTL");

$applied = aiAgentJobsApplyChanges(array("id" => "j", "status" => "queued", "createdAt" => $now), array("status" => "done", "result" => array("x" => 1)), $now + 5);
check($applied["status"] === "done" && $applied["result"] === array("x" => 1), "applyChanges merges changes");
check($applied["updatedAt"] === $now + 5, "applyChanges bumps updatedAt");

$replaced = aiAgentJobsReplace($jobs, "j10", array("id" => "j10", "status" => "done"));
check(aiAgentJobsFind($replaced, "j10")["status"] === "done", "replace swaps the job by id");
check(count($replaced) === count($jobs), "replace keeps the list length");

# 3) Публичное представление.
$queued = aiAgentJobNew("q", array(), $now);
$pubQueued = aiAgentJobPublic($queued);
check($pubQueued["result"] === null, "public hides result while not done");
check(!array_key_exists("result", $pubQueued) || $pubQueued["result"] === null, "public result null for queued");

$doneJob = aiAgentJobsApplyChanges($queued, array("status" => "done", "result" => array("assistant" => array("content" => "ответ"))), $now + 1);
$pubDone = aiAgentJobPublic($doneJob);
check(isset($pubDone["result"]["assistant"]["content"]) && $pubDone["result"]["assistant"]["content"] === "ответ", "public exposes result for done job");
check($pubDone["status"] === "done" && $pubDone["message"] === "q", "public keeps status and message");

# 4) Файловый round-trip с реальным хранилищем.
$db = "t3410test" . getmypid();
$path = aiAgentJobsFile($db);
check($path !== "" && strpos($path, "ai_agent_jobs_") !== false, "store path is derived from db name");
check(aiAgentJobsFile("bad/name'; --") === sys_get_temp_dir()."/ai_agent_jobs_badname.json", "db name sanitized in store path");
@unlink($path);

$created = aiAgentJobCreate($db, "запрос", array("file.csv"));
check(is_file($path), "create writes the store file");
$fetched = aiAgentJobGet($db, $created["id"]);
check($fetched && $fetched["status"] === "queued", "get returns the created job (queued)");

aiAgentJobUpdate($db, $created["id"], array("status" => "processing"));
check(aiAgentJobGet($db, $created["id"])["status"] === "processing", "update moves job to processing");

$result = array("assistant" => array("content" => "готово"), "status" => "ok");
$updated = aiAgentJobUpdate($db, $created["id"], array("status" => "done", "result" => $result));
check($updated["status"] === "done", "update returns the updated job");
$pub = aiAgentJobPublic(aiAgentJobGet($db, $created["id"]));
check($pub["result"]["assistant"]["content"] === "готово", "stored done job exposes the result");

$second = aiAgentJobCreate($db, "второй", array());
check(aiAgentJobLatest($db)["id"] === $second["id"], "latest returns the most recent stored job");

check(aiAgentJobUpdate($db, "doesnotexist", array("status" => "done")) === null, "update of unknown id returns null");
check(aiAgentJobGet($db, "doesnotexist") === null, "get of unknown id returns null");

@unlink($path);
check(aiAgentJobLatest($db) === null, "latest is null when store is empty/cleared");

echo "\n";
if($failures){
    echo "FAILED: $failures check(s) failed\n";
    exit(1);
}
echo "ALL TESTS PASSED\n";
