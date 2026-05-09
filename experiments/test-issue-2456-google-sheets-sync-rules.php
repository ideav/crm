<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2456($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

$values = [
    ['', '', '2026', ''],
    ['', '', '2026', ''],
    ['', '', 'PLAN', ''],
    ['Metric A', 'Metric A', '10', 'future-only'],
    ['Metric B', '', '20', ''],
    ['Metric A', 'Metric A', '11', 'same-header-duplicate'],
    ['', '', '2026', '2026'],
    ['', '', '2026', '2026'],
    ['', '', 'PLAN', 'PLAN'],
    ['Metric A', 'Metric A', '12', '13'],
];

$records = gss_extract_sheet_records(
    'Rules',
    $values,
    [
        ['Metric A', 'Metric A'],
        'Metric B',
    ],
    [
        ['2026', '2026', 'PLAN'],
    ]
);

assertSameIssue2456(5, count($records), 'selects rows with matching row conditions and current-or-earlier column conditions');
assertSameIssue2456(4, $records[0]['row_number'], 'stores the 1-based sheet row number');
assertSameIssue2456(['Metric A'], $records[0]['rows'], 'deduplicates repeated row match values');
assertSameIssue2456(['2026', 'PLAN'], $records[0]['columns'], 'deduplicates repeated column match values');
assertSameIssue2456('10', $records[0]['value'], 'captures the first metric value');

assertSameIssue2456(5, $records[1]['row_number'], 'keeps independent matches per row condition');
assertSameIssue2456(['Metric B'], $records[1]['rows'], 'captures another row condition in the same header block');
assertSameIssue2456('20', $records[1]['value'], 'captures the second metric value');

assertSameIssue2456(6, $records[2]['row_number'], 'keeps using earlier column conditions for repeated row matches');
assertSameIssue2456('11', $records[2]['value'], 'captures the repeated metric value under the same header block');

assertSameIssue2456(10, $records[3]['row_number'], 'captures the repeated row condition after a new matching header block');
assertSameIssue2456('12', $records[3]['value'], 'captures the value under the refreshed existing column');
assertSameIssue2456(10, $records[4]['row_number'], 'does not let one selected column block another column on the same row');
assertSameIssue2456('13', $records[4]['value'], 'captures the value under the newly matching column');

$content = gss_build_bki_content($records, 1773328460);
$expected = "DATA\r\n"
    . "10;;Metric A;PLAN;1773328460\r\n"
    . "20;;Metric B;PLAN;1773328460\r\n"
    . "11;;Metric A;PLAN;1773328460\r\n"
    . "12;;Metric A;PLAN;1773328460\r\n"
    . "13;;Metric A;PLAN;1773328460\r\n";

assertSameIssue2456($expected, $content, 'builds BKI content with value/date/row/column/timestamp fields');

echo "PASS issue 2456 Google Sheets sync row rules\n";
