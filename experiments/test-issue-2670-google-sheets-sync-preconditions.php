<?php
/**
 * Reproducible test for issue #2670:
 * Google Sheets sync should support precondition prefixes in row matchers
 * like "[Section]pattern" so that the same row label can be captured under
 * different logical sections of the sheet.
 *
 * Precondition rules per issue:
 *  - "[A]pattern" means: only match `pattern` after a cell `A` has been seen.
 *  - "[A][B]pattern" chains preconditions across levels.
 *  - When a new precondition fires at the same level, the previous one at
 *    that level (and all higher levels) is reset.
 *  - Captured row values are prefixed with the precondition chain, e.g.
 *    spec "[Выручка]Выручка *" matching cell "Выручка (ддл)" yields
 *    row value "[Выручка]Выручка (ддл)".
 */

require_once __DIR__ . '/../include/google_sheets_sync.php';

function assert_eq_2670($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function records_row_values($records) {
    $out = [];
    foreach ($records as $record) {
        $out[] = [
            'row_index' => $record['row_index'],
            'column_index' => $record['column_index'],
            'value' => $record['value'],
            'row' => $record['row'],
        ];
    }
    return $out;
}

// -----------------------------------------------------------------------------
// 1. Backward-compat: specs without preconditions behave as before.
// -----------------------------------------------------------------------------

$values = [
    ['',              '01.01.2026', '01.02.2026'],
    ['Выручка (ддл)', '100',        '110'],
    ['Выручка (ддо)', '200',        '220'],
];
$records = gss_extract_sheet_records(
    'TestSheet',
    $values,
    ['Выручка *'],
    ['01.01.2026', '01.02.2026'],
    false,
    0
);
assert_eq_2670(4, count($records), 'backward compat: spec without preconditions still matches');
assert_eq_2670('Выручка (ддл)', $records[0]['row'], 'backward compat: row value is unprefixed');
assert_eq_2670('100', $records[0]['value'], 'backward compat: value is captured');

// -----------------------------------------------------------------------------
// 2. Single precondition activation per issue example.
// -----------------------------------------------------------------------------

$values = [
    ['',                  '01.01.2026', '01.02.2026'],
    ['Выручка'],
    ['Выручка (ддл)',     '100',        '110'],
    ['Выручка (ддо)',     '200',        '220'],
    ['Поступления'],
    ['Поступления (всё)', '500',        '550'],
    ['Выручка (ддл)',     '300',        '310'],
];
$records = gss_extract_sheet_records(
    'TestSheet',
    $values,
    [
        '[Выручка]Выручка *',
        '[Поступления]Поступления *',
        '[Поступления]Выручка *',
    ],
    ['01.01.2026', '01.02.2026'],
    false,
    0
);

$summary = records_row_values($records);

// The two "Выручка ..." data rows in the Выручка section: 2 columns × 2 rows = 4 records, prefixed with [Выручка]
$revRecords = array_values(array_filter($summary, function ($r) {
    return strpos($r['row'], '[Выручка]') === 0;
}));
assert_eq_2670(4, count($revRecords), 'section 1: 4 records captured under [Выручка]');
assert_eq_2670('[Выручка]Выручка (ддл)', $revRecords[0]['row'], 'section 1: row prefixed with [Выручка]');

// In the Поступления section we expect:
//   - row "Поступления (всё)" matched by "[Поступления]Поступления *"
//     -> 2 records, prefixed with [Поступления]
//   - row "Выручка (ддл)" matched by "[Поступления]Выручка *"
//     -> 2 records, prefixed with [Поступления]
//   - spec "[Выручка]Выручка *" must NOT match here because [Выручка] was reset.
$postRecords = array_values(array_filter($summary, function ($r) {
    return strpos($r['row'], '[Поступления]') === 0;
}));
assert_eq_2670(4, count($postRecords), 'section 2: 4 records captured under [Поступления]');

$postRevRows = array_values(array_filter($postRecords, function ($r) {
    return $r['row'] === '[Поступления]Выручка (ддл)';
}));
assert_eq_2670(2, count($postRevRows), 'section 2: "Выручка (ддл)" captured under [Поступления]');

$staleRevRows = array_values(array_filter($summary, function ($r) {
    return $r['row_index'] === 6 && strpos($r['row'], '[Выручка]') === 0;
}));
assert_eq_2670(0, count($staleRevRows), 'section 2: stale [Выручка] precondition is reset and no longer matches');

// -----------------------------------------------------------------------------
// 3. Precondition row itself does not produce records.
// -----------------------------------------------------------------------------

$headerRecords = array_values(array_filter($records, function ($r) {
    return $r['row_index'] === 1 || $r['row_index'] === 4;
}));
assert_eq_2670(0, count($headerRecords), 'precondition header rows do not produce data records');

// -----------------------------------------------------------------------------
// 4. Backward-compat: a literal "[" cell value still works.
// -----------------------------------------------------------------------------

$literalValues = [
    ['',          '01.01.2026'],
    ['[bracket]', '42'],
];
$literalRecords = gss_extract_sheet_records(
    'TestSheet',
    $literalValues,
    ['[bracket]'],
    ['01.01.2026'],
    false,
    0
);
assert_eq_2670(1, count($literalRecords), 'literal bracketed pattern with no trailing text behaves as a normal pattern');
assert_eq_2670('[bracket]', $literalRecords[0]['row'], 'literal bracketed pattern keeps the cell value');

// -----------------------------------------------------------------------------
// 5. Multi-level preconditions: a different level-1 precondition resets level 2.
// -----------------------------------------------------------------------------

$mlValues = [
    ['',  '01.01.2026'],
    ['A'],
    ['B'],
    ['x', '1'], // level 1=A, level 2=B  -> matches [A][B]x
    ['C'],      // level 1 -> C (different), level 2 cleared
    ['x', '2'], // [A][B]x should NOT match here
    ['A'],      // level 1 -> A again, level 2 still cleared
    ['x', '3'], // still no level 2 -> should NOT match
    ['B'],      // level 2 -> B again
    ['x', '4'], // now both active again
];
$mlRecords = gss_extract_sheet_records(
    'TestSheet',
    $mlValues,
    ['[A][B]x', '[C]x'],
    ['01.01.2026'],
    false,
    0
);
$mlValuesCaptured = array_map(function ($r) { return $r['value']; }, $mlRecords);
sort($mlValuesCaptured);
assert_eq_2670(['1', '2', '4'], $mlValuesCaptured, 'multi-level: level-2 resets when level-1 changes');

// -----------------------------------------------------------------------------
// 6. Repeating the same level-1 precondition does NOT reset higher levels.
// -----------------------------------------------------------------------------

$repValues = [
    ['',  '01.01.2026'],
    ['A'],
    ['B'],
    ['A'],      // same level 1 key fires again -> no reset of level 2
    ['x', '1'], // [A][B]x must still apply
];
$repRecords = gss_extract_sheet_records(
    'TestSheet',
    $repValues,
    ['[A][B]x'],
    ['01.01.2026'],
    false,
    0
);
$repValuesCaptured = array_map(function ($r) { return $r['value']; }, $repRecords);
assert_eq_2670(['1'], $repValuesCaptured, 'multi-level: re-firing same level-1 key keeps higher levels active');

echo "PASS issue 2670 google_sheets_sync precondition prefixes\n";
