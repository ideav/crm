<?php

require_once __DIR__ . '/../google_sheets_sync.php';

function assertSameIssue2454($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function assertTrueIssue2454($condition, $message) {
    if (!$condition) {
        fwrite(STDERR, "FAIL: {$message}\n");
        exit(1);
    }
}

$tmpDir = sys_get_temp_dir() . '/gss-2454-' . uniqid('', true);
$outputFile = $tmpDir . '/nested/import.bki';

try {
    $staleContent = "DATA\r\nold-sheet:old-row:old-column;stale;\r\n";
    $freshContent = "DATA\r\nnew-sheet:new-row:new-column;fresh;\r\n";

    gss_write_file($outputFile, $staleContent);
    assertSameIssue2454($staleContent, file_get_contents($outputFile), 'writes initial import file content');

    gss_write_file($outputFile, $freshContent);
    $rewrittenContent = file_get_contents($outputFile);

    assertSameIssue2454($freshContent, $rewrittenContent, 'overwrites import file instead of appending to it');
    assertTrueIssue2454(strpos($rewrittenContent, 'stale') === false, 'removes stale rows from previous imports');

    $emptyImportContent = gss_build_bki_content([]);
    gss_write_file($outputFile, $emptyImportContent);

    assertSameIssue2454("DATA\r\n", file_get_contents($outputFile), 'rewrites import file from scratch even when no records are selected');

    echo "PASS issue 2454 Google Sheets sync overwrite\n";
} finally {
    if (is_file($outputFile)) {
        unlink($outputFile);
    }
    if (is_dir(dirname($outputFile))) {
        rmdir(dirname($outputFile));
    }
    if (is_dir($tmpDir)) {
        rmdir($tmpDir);
    }
}
