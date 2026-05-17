<?php

/**
 * Test for issue #2689 (tasks block): инкрементальная выгрузка задач
 * по тому же шаблону, что лиды/сделки. Проверяем: фильтр запроса, парсинг
 * ответа tasks.task.list (result.tasks, ключи в lowercase), resume-режим.
 */

define('EXPORT_B3X_TASKS_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x_tasks.php';

function tasksAssert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

// 1. Запрос: правильный метод, фильтр по году и >ID, порядок ASC.
$capturedCalls = [];
$mockApi = function ($webhook, $method, $params) use (&$capturedCalls) {
    $capturedCalls[] = ['method' => $method, 'params' => $params];
    return [
        'result' => [
            'tasks' => [
                ['id' => 100, 'title' => 'T1', 'status' => '2'],
                ['id' => 101, 'title' => 'T2', 'status' => '5'],
            ],
        ],
        'total' => 2,
    ];
};

$batch = getTasksBatch(
    'https://example.test/rest/1/token/',
    2026,
    50,
    ['id', 'title', 'status'],
    $mockApi
);

tasksAssert(count($capturedCalls) === 1, 'expected one API call');
$call = $capturedCalls[0];
tasksAssert($call['method'] === 'tasks.task.list', 'must call tasks.task.list, got ' . $call['method']);
tasksAssert($call['params']['order'] === ['ID' => 'ASC'], 'must order by ID ASC');
tasksAssert($call['params']['filter']['>=CREATED_DATE'] === '2026-01-01T00:00:00', 'year start filter');
tasksAssert($call['params']['filter']['<=CREATED_DATE'] === '2026-12-31T23:59:59', 'year end filter');
tasksAssert($call['params']['filter']['>ID'] === 50, 'must filter by >ID = lastId');
tasksAssert($call['params']['select'] === ['id', 'title', 'status'], 'select must pass through');
tasksAssert(count($batch['tasks']) === 2, 'tasks batch size mismatch');
tasksAssert($batch['tasks'][0]['id'] === 100 && $batch['tasks'][1]['id'] === 101, 'tasks IDs mismatch');

// 2. lastId=0 → фильтр >ID не передаётся, тянем с начала года.
$capturedCalls = [];
getTasksBatch('https://example.test/', 2026, 0, ['id'], $mockApi);
tasksAssert(!array_key_exists('>ID', $capturedCalls[0]['params']['filter']), 'lastId=0 must omit >ID filter');

// 3. Парсинг ответа: tasks.task.list кладёт массив в result.tasks, а у других
// crm.*.list — прямо в result. Должны корректно вытащить из обоих форматов
// (на случай, если API однажды отдаст плоский result).
$flatApi = function () { return ['result' => [['id' => 1, 'title' => 'flat']]]; };
$flatBatch = getTasksBatch('https://example.test/', 2026, 0, ['id'], $flatApi);
tasksAssert(count($flatBatch['tasks']) === 1, 'must fallback to flat result format');
tasksAssert($flatBatch['tasks'][0]['title'] === 'flat', 'flat fallback content');

// 4. Resume: завершённый прогон с last_task_id > 0 → флаг снимается.
$completedState = normalizeTasksState([
    'last_task_id' => 9999,
    'tasks_complete' => true,
    'total_tasks' => 500,
]);
[$resumed, $isResume] = prepareTasksResumeAfterComplete($completedState);
tasksAssert($isResume === true, 'resume must trigger when complete with last_task_id > 0');
tasksAssert($resumed['tasks_complete'] === false, 'tasks_complete must be cleared');
tasksAssert($resumed['last_task_id'] === 9999, 'last_task_id must be preserved');
tasksAssert($resumed['total_tasks'] === 500, 'total_tasks must be preserved');

// 5. Resume не срабатывает на пустом / частичном / "complete без записей" стейте.
[$_, $r1] = prepareTasksResumeAfterComplete(getDefaultTasksState());
tasksAssert($r1 === false, 'no resume on fresh state');

[$_, $r2] = prepareTasksResumeAfterComplete(normalizeTasksState([
    'last_task_id' => 50, 'tasks_complete' => false,
]));
tasksAssert($r2 === false, 'no resume when not complete');

[$_, $r3] = prepareTasksResumeAfterComplete(normalizeTasksState([
    'last_task_id' => 0, 'tasks_complete' => true,
]));
tasksAssert($r3 === false, 'no resume when complete but nothing exported');

// 6. normalizeTasksState типизирует поля.
$norm = normalizeTasksState(['last_task_id' => '42', 'total_tasks' => '7', 'tasks_complete' => 1]);
tasksAssert($norm['last_task_id'] === 42 && $norm['total_tasks'] === 7 && $norm['tasks_complete'] === true,
    'normalize must coerce types');

echo "PASS: getTasksBatch calls tasks.task.list with year+>ID filter and ASC order\n";
echo "PASS: getTasksBatch parses result.tasks and falls back to flat result\n";
echo "PASS: tasks resume triggers only when complete with last_task_id > 0\n";
echo "PASS: normalizeTasksState coerces types\n";
