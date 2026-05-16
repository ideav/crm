<?php
/**
 * Issue #2689: инкрементальная выгрузка задач в tasks_YYYY.csv.
 * Шаблон: как в export_b3x.php — state + фильтр >ID + перезагрузки по таймауту.
 * API: tasks.task.list. Особенности:
 *  - поля в ответе в lowercase (id, title, ...), хотя select принимается в любом регистре
 *  - данные лежат в result.tasks (а не result, как у crm.*.list)
 */

define('EXPORT_B3X_SKIP_RUN', true);
require_once __DIR__ . '/export_b3x.php';

$TARGET_YEAR_TASKS = 2026;

// Поля в lowercase, потому что tasks.task.list возвращает ключи в нижнем
// регистре. Headers — русские, для CSV.
$taskFieldsMap = [
    'id' => 'ID',
    'title' => 'Название',
    'status' => 'Статус',
    'priority' => 'Приоритет',
    'createdBy' => 'Создал (ID)',
    'responsibleId' => 'Ответственный (ID)',
    'createdDate' => 'Дата создания',
    'changedDate' => 'Дата изменения',
    'deadline' => 'Крайний срок',
    'closedDate' => 'Дата закрытия',
    'groupId' => 'Группа (ID)',
    'timeEstimate' => 'Оценка времени',
    'allowChangeDeadline' => 'Можно менять срок',
    'tags' => 'Теги',
];

$taskFields = array_keys($taskFieldsMap);
$taskHeaders = array_values($taskFieldsMap);

$tasksCsvFile = $csvPath . 'tasks_' . $TARGET_YEAR_TASKS . '.csv';
$tasksStateFile = __DIR__ . '/export_tasks_state.json';
$tasksErrorLogFile = $csvPath . 'export_tasks_error_counter_' . $TARGET_YEAR_TASKS . '.json';

/**
 * Один запрос tasks.task.list с фильтром по году создания и >ID.
 */
function getTasksBatch($bitrix24_webhook, $year, $lastId = 0, $selectFields = [], $apiCaller = null) {
    $filter = [
        '>=CREATED_DATE' => $year . '-01-01T00:00:00',
        '<=CREATED_DATE' => $year . '-12-31T23:59:59',
    ];
    if ($lastId > 0) {
        $filter['>ID'] = $lastId;
    }
    $params = [
        'order' => ['ID' => 'ASC'],
        'filter' => $filter,
        'select' => $selectFields,
    ];
    $apiCaller = $apiCaller ?: 'callBitrix';
    $response = $apiCaller($bitrix24_webhook, 'tasks.task.list', $params);

    $tasks = $response['result']['tasks'] ?? ($response['result'] ?? []);
    return [
        'tasks' => is_array($tasks) ? $tasks : [],
        'total' => $response['total'] ?? 0,
    ];
}

function getDefaultTasksState() {
    return [
        'state_version' => 1,
        'last_task_id' => 0,
        'tasks_complete' => false,
        'total_tasks' => 0,
    ];
}

function normalizeTasksState($state) {
    $default = getDefaultTasksState();
    if (!is_array($state)) {
        return $default;
    }
    $state = array_merge($default, $state);
    $state['last_task_id'] = (int)$state['last_task_id'];
    $state['total_tasks'] = (int)$state['total_tasks'];
    $state['tasks_complete'] = (bool)$state['tasks_complete'];
    return $state;
}

function getTasksState($stateFile) {
    if (!file_exists($stateFile)) {
        return getDefaultTasksState();
    }
    return normalizeTasksState(json_decode(file_get_contents($stateFile), true));
}

function saveTasksState($stateFile, $state) {
    file_put_contents($stateFile, json_encode(normalizeTasksState($state), JSON_PRETTY_PRINT));
}

/**
 * Аналог prepareResumeAfterComplete для задач: при повторном запуске
 * после tasks_complete=true снимаем флаг и догружаем новое от last_task_id.
 */
function prepareTasksResumeAfterComplete($state) {
    $isResume = !empty($state['tasks_complete']) && (int)($state['last_task_id'] ?? 0) > 0;
    if ($isResume) {
        $state['tasks_complete'] = false;
    }
    return [$state, $isResume];
}

if (defined('EXPORT_B3X_TASKS_SKIP_RUN') && EXPORT_B3X_TASKS_SKIP_RUN) {
    return;
}

if (isset($_GET['reset']) && $_GET['reset'] == 1) {
    if (file_exists($tasksStateFile)) unlink($tasksStateFile);
    resetErrorCounter($tasksErrorLogFile);
    echo "Состояние задач сброшено. <a href='" . str_replace('?reset=1', '', $_SERVER['REQUEST_URI']) . "'>Начать заново</a><br>\n";
    exit;
}

header('Content-Type: text/html; charset=utf-8');
ob_implicit_flush(true);
while (ob_get_level()) ob_end_flush();

if (!is_dir($csvPath)) {
    mkdir($csvPath, 0755, true);
}

global $bitrix24_webhook;
$startTime = time();
$state = getTasksState($tasksStateFile);

[$state, $isResumeAfterComplete] = prepareTasksResumeAfterComplete($state);
if ($isResumeAfterComplete) {
    saveTasksState($tasksStateFile, $state);
}

$lastTaskId = $state['last_task_id'];

if ($lastTaskId == 0 && empty($state['tasks_complete'])) {
    if (file_exists($tasksCsvFile)) unlink($tasksCsvFile);
}

initCsvFile($tasksCsvFile, $taskHeaders);

echo "<!DOCTYPE html>
<html>
<head>
    <meta charset='UTF-8'>
    <title>Экспорт задач за {$TARGET_YEAR_TASKS} год</title>
    <style>
        body { font-family: monospace; padding: 6px; background: #1e1e1e; color: #d4d4d4; }
        .info { color: #4ec9b0; }
        .success { color: #6a9955; }
        .error { color: #f48771; }
        .progress { color: #ce9178; }
        a { color: #4ec9b0; }
    </style>
</head>
<body>
<pre>
";

echo ">>> ЭКСПОРТ ЗАДАЧ ЗА {$TARGET_YEAR_TASKS} ГОД <<<\n";
echo "   Таймаут: {$timeLimit} сек\n";
echo "   URL: " . parse_url($bitrix24_webhook, PHP_URL_HOST) . "\n";
echo "   Полей: " . count($taskFields) . "\n";
echo "   Последний ID задачи: {$lastTaskId}\n";
echo "   Задачи завершены: " . (!empty($state['tasks_complete']) ? 'Да' : 'Нет') . "\n";
echo "   Выгружено задач: " . ($state['total_tasks'] ?? 0) . "\n";
if ($isResumeAfterComplete) {
    echo "   <span class='info'>[ДОГРУЗКА] Ищу новые задачи с ID > {$lastTaskId}</span>\n";
}
echo "\n";

$batchesProcessed = 0;
$shouldStop = false;
$maxTaskId = $lastTaskId;

try {
    while (empty($state['tasks_complete']) && !$shouldStop) {
        if (time() - $startTime >= $timeLimit) {
            echo "\n<span class='info'>[ВРЕМЯ] Лимит ({$timeLimit} сек). Перезагрузка...</span>\n";
            resetErrorCounter($tasksErrorLogFile);
            $shouldStop = true;
            break;
        }

        echo "   Запрос задач (ID > {$lastTaskId})... ";
        try {
            $batch = getTasksBatch($bitrix24_webhook, $TARGET_YEAR_TASKS, $lastTaskId, $taskFields);
            $tasks = $batch['tasks'];
            resetErrorCounter($tasksErrorLogFile);
        } catch (Exception $e) {
            incrementErrorCounter($tasksErrorLogFile);
            checkErrorLimit($tasksErrorLogFile, 3);
            echo "<span class='error'>Ошибка: " . $e->getMessage() . "</span>\n";
            sleep(2);
            continue;
        }

        $tasksCount = count($tasks);
        $processedTasks = 0;

        if ($tasksCount == 0) {
            echo "<span class='info'>0 задач — блок завершён</span>\n";
            $state['tasks_complete'] = true;
        } else {
            echo "<span class='progress'>получено {$tasksCount} задач</span>\n";

            foreach ($tasks as $task) {
                $row = prepareRowData($task, $taskFields);
                appendCsvRow($tasksCsvFile, $row);
                $processedTasks++;

                $taskId = (int)($task['id'] ?? 0);
                if ($taskId > $maxTaskId) {
                    $maxTaskId = $taskId;
                }
            }
        }

        $state['last_task_id'] = $maxTaskId;
        $state['total_tasks'] = ($state['total_tasks'] ?? 0) + $processedTasks;
        saveTasksState($tasksStateFile, $state);
        $lastTaskId = $maxTaskId;

        $batchesProcessed++;
        echo "      Пачка {$batchesProcessed}: +{$processedTasks} задач | task ID: {$maxTaskId}\n";
    }

    $totalTasks = $state['total_tasks'] ?? 0;
    echo "\n<span class='info'>ИТОГИ СЕССИИ:</span>\n";
    echo "   Обработано пачек: {$batchesProcessed}\n";
    echo "   Всего задач: {$totalTasks}\n";

    if (!empty($state['tasks_complete'])) {
        echo "\n<span class='success'>[ГОТОВО] ЗАДАЧИ ЗА {$TARGET_YEAR_TASKS} ГОД ВЫГРУЖЕНЫ</span>\n";
        echo "<hr>\n";
        echo "📁 <a href='" . basename($tasksCsvFile) . "' download>Скачать задачи ({$totalTasks})</a>\n";
        echo "<br><br>🗑️ <a href='?reset=1'>Сбросить и начать заново</a>\n";
    } else {
        echo "\n<span class='progress'>[ПЕРЕЗАГРУЗКА] Через 0,1 секунду...</span>\n";
        echo "</pre><script>setTimeout(function(){ location.reload(); }, 100);</script>";
    }
} catch (Exception $e) {
    echo "\n<span class='error'>[ОШИБКА] " . $e->getMessage() . "</span>\n";
    if ($maxTaskId > $state['last_task_id']) {
        $state['last_task_id'] = $maxTaskId;
    }
    saveTasksState($tasksStateFile, $state);

    $errorCount = incrementErrorCounter($tasksErrorLogFile);
    if ($errorCount >= 3) {
        echo "\n<span class='error'>[ПРЕРВАНО] 3 ошибки подряд.</span>\n";
        echo "<br><a href='?reset=1'>Сбросить счётчик</a>\n";
    } else {
        echo "\n<span class='info'>[ПЕРЕЗАГРУЗКА] Через 3 секунды...</span>";
        echo "</pre><script>setTimeout(function(){ location.reload(); }, 3000);</script>";
    }
}

echo "</pre></body></html>";
