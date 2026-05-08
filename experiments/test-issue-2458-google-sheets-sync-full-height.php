<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2458($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

$values = [
    ['', '2026', ''],
    ['', '2026', ''],
    ['', 'PLAN', ''],
    ['Metric A', '10', 'future-only'],
    ['Metric A', '11', 'still-before-header'],
    ['', '', '2026'],
    ['', '', '2026'],
    ['', '', 'PLAN'],
    ['Metric A', '12', '13'],
];

$records = gss_extract_sheet_records(
    'FullHeight',
    $values,
    ['Metric A'],
    [
        ['2026', '2026', 'PLAN'],
    ]
);

assertSameIssue2458(4, count($records), 'matches column conditions from sheet top through the current row, not only after the previous match');
assertSameIssue2458([4, 5, 9, 9], array_column($records, 'row_number'), 'keeps reusing earlier headers for later matching rows');
assertSameIssue2458(['10', '11', '12', '13'], array_column($records, 'value'), 'does not select values under future headers before those headers are above the row');

echo "PASS issue 2458 Google Sheets sync full-height column matching\n";
