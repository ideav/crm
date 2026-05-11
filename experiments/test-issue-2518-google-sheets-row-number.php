<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2518($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

// Test 1: sheet_row_number reflects the actual 1-based row index in the fetched values (no range offset)
$values = [
    ['Период', '01.01.2026', '2025'],
    ['', '31.01.2026', ''],
    ['', 'ПЛАН', ''],
    ['Выручка', '123', '89'],
];

$records = gss_extract_sheet_records(
    'TestSheet',
    $values,
    ['Выручка'],
    [
        ['*.2026', '*.2026', 'ПЛАН'],
        '2025',
    ]
);

assertSameIssue2518(2, count($records), 'extracts 2 records');
assertSameIssue2518(4, $records[0]['sheet_row_number'], 'sheet_row_number is 4 for rowIndex=3 with no range offset');
assertSameIssue2518(4, $records[1]['sheet_row_number'], 'sheet_row_number is 4 for second column match on same row');

// Test 2: sheet_row_number accounts for range start offset (e.g. range starts at row 5)
$valuesOffset = [
    ['Header', '2025'],
    ['Выручка', '89'],
];

$records2 = gss_extract_sheet_records(
    'TestSheet',
    $valuesOffset,
    ['Выручка'],
    ['2025'],
    false,
    4  // rangeStartRow = 4 means the first row of $values is actually Google Sheets row 5
);

assertSameIssue2518(1, count($records2), 'extracts 1 record with range offset');
assertSameIssue2518(6, $records2[0]['sheet_row_number'], 'sheet_row_number is 6 when rangeStartRow=4 and rowIndex=1');

// Test 3: BKI output includes sheet name as first column and sheet_row_number between column and timestamp
$content = gss_build_bki_content($records, 1773328460);
$expected = "DATA\r\n"
    . "TestSheet;123;31.01.2026;Выручка;ПЛАН;4;1773328460;\r\n"
    . "TestSheet;89;;Выручка;2025;4;1773328460;\r\n";

assertSameIssue2518($expected, $content, 'BKI output includes sheet name as {sheet};{value};{date};{row};{column};{sheet_row_number};{timestamp};');

// Test 4: BKI output with range offset
$content2 = gss_build_bki_content($records2, 1773328460);
$expected2 = "DATA\r\n"
    . "TestSheet;89;;Выручка;2025;6;1773328460;\r\n";

assertSameIssue2518($expected2, $content2, 'BKI output uses correct sheet_row_number with range offset');

// Test 5: record without sheet or sheet_row_number (backward compat) produces empty fields
$manualRecord = [
    'value' => 'Val',
    'date' => '01.01.2026',
    'row' => 'Row',
    'column' => 'Col',
    'rows' => ['Row'],
    'columns' => ['Col'],
];
$content3 = gss_build_bki_content([$manualRecord], 12345);
$expected3 = "DATA\r\n"
    . ";Val;01.01.2026;Row;Col;;12345;\r\n";

assertSameIssue2518($expected3, $content3, 'record without sheet or sheet_row_number produces empty fields in BKI');

echo "PASS issue 2518 Google Sheets row number in BKI format\n";
