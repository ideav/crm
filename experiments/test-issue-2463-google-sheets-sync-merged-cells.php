<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2463($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

$values = [
    ['', '01.01.2026'],
    ['', '31.01.2026'],
    ['', 'ПЛАН', '% от выручки (план)', 'ФАКТ', '% от выручки (факт)', 'Комментарий'],
    ['Выручка (ддо)', '100', '10%', '90', '9%', 'note'],
];

$rowMatchers = ['Выручка (ддо)'];
$columnMatchers = [
    ['01.01.2026', '31.01.2026', 'ПЛАН'],
    ['01.01.2026', '31.01.2026', 'ФАКТ'],
    ['01.01.2026', '31.01.2026', 'Комментарий'],
];

$recordsWithoutMergeExpansion = gss_extract_sheet_records('MergedCells', $values, $rowMatchers, $columnMatchers);
assertSameIssue2463(1, count($recordsWithoutMergeExpansion), 'documents Google values API behavior before merged header expansion');

$expandedValues = gss_apply_google_sheet_merges($values, [
    [
        'startRowIndex' => 0,
        'endRowIndex' => 1,
        'startColumnIndex' => 1,
        'endColumnIndex' => 6,
    ],
    [
        'startRowIndex' => 1,
        'endRowIndex' => 2,
        'startColumnIndex' => 1,
        'endColumnIndex' => 6,
    ],
]);

$records = gss_extract_sheet_records('MergedCells', $expandedValues, $rowMatchers, $columnMatchers);

assertSameIssue2463(3, count($records), 'selects every matching leaf column under the same merged date headers');
assertSameIssue2463([1, 3, 5], array_column($records, 'column_index'), 'keeps matching non-adjacent columns under the merged header');
assertSameIssue2463(['100', '90', 'note'], array_column($records, 'value'), 'exports values from all matching columns under merged headers');
assertSameIssue2463(['01.01.2026', '31.01.2026', 'ФАКТ'], $records[1]['columns'], 'uses expanded merged header values for the actual column match');

$offsetValues = [
    ['01.02.2026'],
    ['31.01.2026'],
];
$offsetExpandedValues = gss_apply_google_sheet_merges($offsetValues, [
    [
        'startRowIndex' => 0,
        'endRowIndex' => 1,
        'startColumnIndex' => 10,
        'endColumnIndex' => 13,
    ],
], 0, 10);
assertSameIssue2463(['01.02.2026', '01.02.2026', '01.02.2026'], $offsetExpandedValues[0], 'applies merge ranges relative to a non-A1 requested range');
assertSameIssue2463(['row' => 0, 'column' => 10], gss_value_range_start_indexes("'Plan Sheet'!K:R"), 'parses column offsets from A1 ranges');
assertSameIssue2463('Range Sheet', gss_sheet_title_for_merge_lookup(['name' => 'Config Sheet'], "'Range Sheet'!A1:R"), 'uses the sheet title embedded in an explicit range');
assertSameIssue2463('Config Sheet', gss_sheet_title_for_merge_lookup(['name' => 'Config Sheet'], 'A1:R'), 'falls back to sheet config name when range has no title');

echo "PASS issue 2463 Google Sheets sync merged cells\n";
