<?php
/**
 * Reproduces issue #2512: BKI lines missing trailing semicolons cause the import
 * loop (while count(object) <= typesCount) to consume the next record's line,
 * corrupting field values in multi-field schemas.
 */

require_once __DIR__ . '/../google_sheets_sync.php';

$passed = 0;
$failed = 0;

function ok($cond, $msg) {
    global $passed, $failed;
    if ($cond) {
        echo "  PASS: $msg\n";
        $passed++;
    } else {
        fwrite(STDERR, "  FAIL: $msg\n");
        $failed++;
    }
}

echo "\n=== Reproduce issue #2512: missing trailing semicolon ===\n";

// Produce BKI content with two records
$records = [
    ['value' => '322', 'date' => '31.01.2026', 'row' => 'Выручка (ддл)', 'column' => 'ПЛАН'],
    ['value' => '456', 'date' => '31.01.2026', 'row' => 'Выручка (ддо)', 'column' => 'ПЛАН'],
];
$content = gss_build_bki_content($records, 1774970163);

// Split into data lines
$lines = array_values(array_filter(explode("\r\n", $content), function($l) {
    return $l !== '' && $l !== 'DATA';
}));

echo "\n--- BKI line format check ---\n";
foreach ($lines as $i => $line) {
    $hasSemicolon = substr($line, -1) === ';';
    ok($hasSemicolon, "Line $i ends with trailing semicolon: " . json_encode($line));
}

echo "\n--- Part count check (must be > typesCount=5 to avoid extra-line read) ---\n";
$typesCount = 5; // 5-field schema: base + Дата + строка + Колонка + Обновлено
foreach ($lines as $i => $line) {
    $parts = explode(';', $line);
    $count = count($parts);
    ok($count > $typesCount, "Line $i produces $count parts (need > $typesCount to avoid consuming next record)");
}

echo "\n--- Simulate import corruption with two consecutive records ---\n";
// This simulates what index.php does: reads a line, if count(parts) <= typesCount, reads more.
// With no trailing semicolons, line 1 absorbs line 2's content into its last field.
$line0 = $lines[0] . "\r\n";
$line1 = $lines[1] . "\r\n";

$buffer = $line0;
$object = explode(';', $buffer);
$line0ExtraReads = 0;
if (count($object) <= $typesCount) {
    // Bug: absorbs the next record's line
    $buffer .= $line1;
    $object = explode(';', $buffer);
    $line0ExtraReads = 1;
}

ok($line0ExtraReads === 0, "Record 0 reads 0 extra lines (got $line0ExtraReads)");

// The Обновлено field (object[6]) must be the clean timestamp, not contaminated by record 1
// Format: sheet(0);value(1);date(2);row(3);column(4);sheet_row_number(5);timestamp(6);
$obnovleno = isset($object[6]) ? rtrim($object[6], "\t\n\r\0\x0B") : '';
ok($obnovleno === '1774970163', "Record 0: Обновлено = '1774970163' (got '$obnovleno')");

$contaminated = $line0ExtraReads > 0 && isset($object[6]) && strpos($object[6], "\r\n") !== false;
if ($contaminated) {
    fwrite(STDERR, "  BUG: Record 0's Обновлено field contains next record's data: " . json_encode($object[6]) . "\n");
}

echo "\n=== Results: $passed passed, $failed failed ===\n\n";
exit($failed > 0 ? 1 : 0);
