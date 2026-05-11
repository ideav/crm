<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2514($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

$records = [
    [
        'value' => 'TestValue',
        'date' => '01.01.2026',
        'row' => 'Row A',
        'column' => 'Col B',
        'rows' => ['Row A'],
        'columns' => ['Col B'],
    ],
];

$content = gss_build_bki_content($records, 1000000000);

// Each data line must end with a semicolon: sheet;value;date;row;column;sheet_row_number;timestamp;
$expected = "DATA\r\n"
    . ";TestValue;01.01.2026;Row A;Col B;;1000000000;\r\n";

assertSameIssue2514($expected, $content, 'each BKI data line ends with a trailing semicolon');

// Verify the trailing semicolon is present on the data line
$lines = explode("\r\n", rtrim($content, "\r\n"));
assertSameIssue2514('DATA', $lines[0], 'first line is DATA header');
assertSameIssue2514(';', substr($lines[1], -1), 'data line ends with semicolon');

echo "PASS issue 2514 BKI format trailing semicolon\n";
