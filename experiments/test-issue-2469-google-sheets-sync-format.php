<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2469($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

$values = [
    ['', '', '31.12.2025'],
    ['', '', '01.01.2026'],
    ['', '', 'ПЛАН'],
    ['Metric A', 'Region West', '900'],
];

$records = gss_extract_sheet_records(
    'NewFormat',
    $values,
    [
        ['Region *', 'Metric *'],
    ],
    [
        ['31.12.2025', '01.01.2026', 'ПЛАН'],
    ]
);

assertSameIssue2469(1, count($records), 'selects the matching intersection');
assertSameIssue2469('01.01.2026', $records[0]['date'], 'uses the maximum DD.MM.YYYY date from matched context');
assertSameIssue2469('Region West', $records[0]['row'], 'uses the rightmost matched row value');
assertSameIssue2469('ПЛАН', $records[0]['column'], 'uses the lowest matched column value');

$content = gss_build_bki_content($records, 1773328460);
$expected = "DATA\r\n"
    . "900;01.01.2026;Region West;ПЛАН;1773328460;\r\n";

assertSameIssue2469($expected, $content, 'builds value/date/row/column/timestamp import lines');

echo "PASS issue 2469 Google Sheets sync output format\n";
