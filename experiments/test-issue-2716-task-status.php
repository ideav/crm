<?php

/**
 * Test for issue #2716: task export must write readable status names instead
 * of raw Bitrix task status IDs.
 */

define('EXPORT_B3X_TASKS_SKIP_RUN', true);
require_once __DIR__ . '/../export_b3x_tasks.php';

function taskStatusAssert($condition, $message) {
    if (!$condition) {
        throw new Exception($message);
    }
}

$fields = ['id', 'title', 'status', 'priority'];
$cases = [
    ['5', 'Завершена'],
    ['6', 'Отложена'],
    ['2', 'Принята'],
    ['3', 'Выполняется'],
    ['4', 'Ждёт контроля'],
];

foreach ($cases as $case) {
    [$rawStatus, $expectedStatus] = $case;
    $row = prepareTaskRowData([
        'id' => 612233,
        'title' => 'Task',
        'status' => $rawStatus,
        'priority' => 1,
    ], $fields);

    taskStatusAssert(
        $row === ['612233', 'Task', $expectedStatus, '1'],
        'status ' . $rawStatus . ' must export as ' . $expectedStatus . ', got: '
            . json_encode($row, JSON_UNESCAPED_UNICODE)
    );
}

$unknownStatusRow = prepareTaskRowData([
    'id' => 42,
    'title' => "Line\nBreak",
    'status' => '999',
    'priority' => true,
], $fields);
taskStatusAssert(
    $unknownStatusRow === ['42', 'Line Break', '999', 'Да'],
    'unknown statuses must stay raw while shared field formatting still applies, got: '
        . json_encode($unknownStatusRow, JSON_UNESCAPED_UNICODE)
);

$bkiLine = formatBkiRow(prepareTaskRowData([
    'id' => 612233,
    'title' => 'Начислить занники',
    'status' => '5',
    'priority' => 1,
], $fields));
taskStatusAssert(
    $bkiLine === '612233;Начислить занники;Завершена;1',
    'BKI rows must also receive translated task statuses, got: ' . $bkiLine
);

echo "PASS: task status IDs are translated to readable Russian names in CSV/BKI rows\n";
echo "PASS: unknown task statuses keep their original value\n";
