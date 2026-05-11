<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameValue($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function assertTrueValue($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$values = [
    ['Период', '01.01.2026', '2025', 'Ненужный столбец'],
    ['', '31.01.2026', '', ''],
    ['', 'ПЛАН', '', ''],
    ['Выручка (ддо - b2b)', '123:45;6,7', '89', 'не выбирать'],
    ['Выручка (ддо)', '', '100', 'не выбирать'],
];

$records = gss_extract_sheet_records(
    'Выручка (ддо - b2b)',
    $values,
    ['Выручка (ддо - b2b)'],
    [
        ['*.2026', '*.2026', 'ПЛАН'],
        '2025',
    ]
);

assertSameValue(2, count($records), 'extracts intersections of matching rows and columns');
assertSameValue(['Выручка (ддо - b2b)'], $records[0]['rows'], 'keeps actual matched row value');
assertSameValue(['01.01.2026', '31.01.2026', 'ПЛАН'], $records[0]['columns'], 'resolves wildcard column matcher to actual header values');
assertSameValue('123:45;6,7', $records[0]['value'], 'keeps source cell value unchanged before BKI escaping');
assertSameValue(['2025'], $records[1]['columns'], 'matches scalar column matcher');

$content = gss_build_bki_content($records, 1773328460);
$expected = "DATA\r\n"
    . "123\\:45\\;6\\,7;31.01.2026;Выручка (ддо - b2b);ПЛАН;1773328460;\r\n"
    . "89;;Выручка (ддо - b2b);2025;1773328460;\r\n";

assertSameValue($expected, $content, 'builds DATA-prefixed BKI content in value/date/row/column/timestamp format and escapes delimiters');
assertTrueValue(gss_pattern_matches('*.2026', '31.01.2026'), 'asterisk mask matches arbitrary leading text');
assertTrueValue(gss_pattern_matches('ПЛ*', 'ПЛАН'), 'asterisk mask matches arbitrary trailing text');
assertTrueValue(!gss_pattern_matches('2026', '2025'), 'exact matcher does not match different value');

echo "PASS issue 2450 Google Sheets sync extraction\n";
