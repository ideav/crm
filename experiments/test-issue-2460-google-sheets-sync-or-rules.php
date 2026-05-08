<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2460($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function assertTrueIssue2460($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$values = [
    ['', '01.01.2026', '01.02.2026', '01.02.2026', '2025', '2026'],
    ['', '31.01.2026', '29.02.2026', '27.02.2026', '', ''],
    ['', 'ФАКТ', 'ПЛАН', 'ПЛАН', '', ''],
    ['Выручка новая', '100', '200', 'skip', '300', '400'],
];

$records = gss_extract_sheet_records(
    'OrRules',
    $values,
    [
        "'Выручка *'||'Расходы *'",
    ],
    [
        ['01.**.202*', '3*.**.202*', "'ПЛАН'||'ФАКТ'"],
        ['01.02.202*', "'28.02.202*'||'29.02.202*'", 'ПЛАН||ФАКТ'],
        '2025',
        '2026',
    ]
);

assertSameIssue2460(4, count($records), 'selects cells for scalar and combined column rules with OR alternatives');
assertSameIssue2460([4, 4, 4, 4], array_column($records, 'row_number'), 'stores the source sheet row number for every selected value');
assertSameIssue2460(['100', '200', '300', '400'], array_column($records, 'value'), 'does not select a column when no OR alternative satisfies the full rule');
assertSameIssue2460(['Выручка новая'], $records[0]['rows'], 'resolves OR row matcher to the actual matched row value');
assertSameIssue2460(['01.01.2026', '31.01.2026', 'ФАКТ'], $records[0]['columns'], 'resolves quoted OR column matcher to the actual matched value');
assertSameIssue2460(['01.02.2026', '29.02.2026', 'ПЛАН'], $records[1]['columns'], 'resolves unquoted OR column matcher alternatives');
assertTrueIssue2460(gss_pattern_matches("'ПЛАН'||'ФАКТ'", 'ФАКТ'), 'quoted OR expression matches either alternative');
assertTrueIssue2460(gss_pattern_matches('ПЛАН||ФАКТ', 'ПЛАН'), 'unquoted OR expression matches either alternative');
assertTrueIssue2460(!gss_pattern_matches('ПЛАН||ФАКТ', 'ПРОГНОЗ'), 'OR expression does not match unrelated values');

$overlappingMatch = gss_match_spec(['A', 'B'], ['A||B', 'A']);
assertSameIssue2460(['matched' => true, 'values' => ['B', 'A']], $overlappingMatch, 'finds a valid combination when the first OR alternative would block a later condition');

echo "PASS issue 2460 Google Sheets sync OR rules\n";
