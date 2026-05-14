<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2658($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

// gss_escape_bki_value must only escape BKI row delimiters (`:` and `;`).
// Commas are not row-level delimiters and must pass through unchanged.
assertSameIssue2658('1,234.56', gss_escape_bki_value('1,234.56'), 'plain comma is not escaped');
assertSameIssue2658('A, B, C',  gss_escape_bki_value('A, B, C'),  'commas inside text are not escaped');
assertSameIssue2658('a\\:b',    gss_escape_bki_value('a:b'),      'colon is still escaped');
assertSameIssue2658('a\\;b',    gss_escape_bki_value('a;b'),      'semicolon is still escaped');
assertSameIssue2658('a\\:b\\;c,d', gss_escape_bki_value('a:b;c,d'), 'mixed: only : and ; are escaped');

// And the full BKI row must contain the original commas verbatim.
$records = [
    [
        'value' => '1,234.56',
        'date' => '01.01.2026',
        'row' => 'Выручка, факт',
        'column' => 'Я, Б',
        'rows' => ['Выручка, факт'],
        'columns' => ['Я, Б'],
        'sheet' => 'List, A',
    ],
];

$content = gss_build_bki_content($records, 1000000000);

$expected = "DATA\r\n"
    . "List, A;1,234.56;01.01.2026;Выручка, факт;Я, Б;;1000000000;\r\n";

assertSameIssue2658($expected, $content, 'commas pass through gss_build_bki_content unchanged');

echo "PASS issue 2658 BKI commas are not escaped\n";
