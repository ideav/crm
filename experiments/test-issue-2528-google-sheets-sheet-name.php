<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2528($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

// Test 1: BKI output includes sheet name as first column
$values = [
    ['Период', '01.01.2026', '2025'],
    ['', '31.01.2026', ''],
    ['', 'ПЛАН', ''],
    ['Выручка', '123', '89'],
];

$records = gss_extract_sheet_records(
    'Лист1',
    $values,
    ['Выручка'],
    [
        ['*.2026', '*.2026', 'ПЛАН'],
        '2025',
    ]
);

assertSameIssue2528(2, count($records), 'extracts 2 records');
assertSameIssue2528('Лист1', $records[0]['sheet'], 'record contains sheet name');

$content = gss_build_bki_content($records, 1773328460);
$expected = "DATA\r\n"
    . "Лист1;123;31.01.2026;Выручка;ПЛАН;4;1773328460;\r\n"
    . "Лист1;89;;Выручка;2025;4;1773328460;\r\n";

assertSameIssue2528($expected, $content, 'BKI output has sheet name as first column: {sheet};{value};{date};{row};{column};{sheet_row_number};{timestamp};');

// Test 2: records from different sheets each carry their own sheet name
$recordsA = gss_extract_sheet_records(
    'ШитА',
    [['X', '2025'], ['Выручка', '10']],
    ['Выручка'],
    ['2025']
);
$recordsB = gss_extract_sheet_records(
    'ШитБ',
    [['X', '2025'], ['Выручка', '20']],
    ['Выручка'],
    ['2025']
);

$combined = gss_build_bki_content(array_merge($recordsA, $recordsB), 1000);
$expectedCombined = "DATA\r\n"
    . "ШитА;10;;Выручка;2025;2;1000;\r\n"
    . "ШитБ;20;;Выручка;2025;2;1000;\r\n";

assertSameIssue2528($expectedCombined, $combined, 'BKI output shows correct sheet name for records from different sheets');

// Test 3: record without sheet key produces empty sheet field (backward compat)
$manualRecord = [
    'value' => 'Val',
    'date' => '01.01.2026',
    'row' => 'Row',
    'column' => 'Col',
    'sheet_row_number' => 5,
    'rows' => ['Row'],
    'columns' => ['Col'],
];
$content3 = gss_build_bki_content([$manualRecord], 12345);
$expected3 = "DATA\r\n"
    . ";Val;01.01.2026;Row;Col;5;12345;\r\n";

assertSameIssue2528($expected3, $content3, 'record without sheet key produces empty sheet field in BKI');

// Test 4: sheet name with special characters is properly escaped
$recordsSpecial = gss_extract_sheet_records(
    'Лист;2026',
    [['Выручка', '2025'], ['100', '']],
    ['Выручка'],
    ['2025']
);

assertSameIssue2528(1, count($recordsSpecial), 'extracts 1 record with special sheet name');
$contentSpecial = gss_build_bki_content($recordsSpecial, 9999);
$expectedSpecial = "DATA\r\n"
    . "Лист\\;2026;100;;Выручка;2025;2;9999;\r\n";

assertSameIssue2528($expectedSpecial, $contentSpecial, 'sheet name with semicolons is escaped in BKI');

// Test 5: gss_normalize_config sets createParent and autoParent defaults
$config = gss_normalize_config(['sheets' => []], '/tmp');
assertSameIssue2528('1', $config['integram']['createParent'], 'default createParent is "1"');
assertSameIssue2528('449960', $config['integram']['autoParent'], 'default autoParent is "449960"');

// Test 6: createParent and autoParent can be overridden via config
$config2 = gss_normalize_config([
    'sheets' => [],
    'integram' => [
        'createParent' => '0',
        'autoParent' => '123',
    ],
], '/tmp');
assertSameIssue2528('0', $config2['integram']['createParent'], 'createParent can be overridden');
assertSameIssue2528('123', $config2['integram']['autoParent'], 'autoParent can be overridden');

// Test 7: createParent and autoParent can be disabled by setting to empty string
$config3 = gss_normalize_config([
    'sheets' => [],
    'integram' => [
        'createParent' => '',
        'autoParent' => '',
    ],
], '/tmp');
assertSameIssue2528('', $config3['integram']['createParent'], 'createParent can be set to empty to disable');
assertSameIssue2528('', $config3['integram']['autoParent'], 'autoParent can be set to empty to disable');

echo "PASS issue 2528 Google Sheets sheet name in BKI format and createParent/autoParent POST params\n";
