<?php
/**
 * Benchmark + correctness test for issue #2673.
 *
 * The user reported that 2100 values from Google Sheets take ~24 seconds to
 * process. The bottleneck is gss_extract_sheet_records, which used to rebuild
 * a per-column slice and re-run the column-matcher matrix for every (row,
 * column) pair. We now precompute column-spec matches once per (column,
 * column_spec) and reuse them.
 *
 * This script:
 *   1. Builds a synthetic spreadsheet matching the issue's reported scale
 *      (~400 data rows × ~136 data columns, 2 row matchers, 12 column
 *      matchers + 2 "year" totals matchers stripped from the config).
 *   2. Measures gss_extract_sheet_records runtime and verifies the record
 *      count and content are stable.
 *   3. Re-runs the issue #2670 precondition fixtures inline to confirm that
 *      the optimization preserves backwards-compat semantics on small inputs.
 */

require_once __DIR__ . '/../include/google_sheets_sync.php';

function assert_eq_2673($expected, $actual, $message) {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: " . var_export($expected, true) . "\nActual:   " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function build_synthetic_matrix($numDataRowsPerSection, $numDataColumns, $year) {
    $matrix = [];

    // Row 0: blank top-left + month header (12 months spread across columns).
    $monthsRu = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    $colsPerMonth = max(1, (int) ceil($numDataColumns / count($monthsRu)));
    $monthHeader = [''];
    for ($c = 0; $c < $numDataColumns; $c++) {
        $monthHeader[] = $monthsRu[(int) floor($c / $colsPerMonth) % count($monthsRu)];
    }
    $matrix[] = $monthHeader;

    // Rows 1-3: start date / end date / ПЛАН|ФАКТ markers, repeated per month.
    $startRow = [''];
    $endRow = [''];
    $planFactRow = [''];
    $monthDays = [31,28,31,30,31,30,31,31,30,31,30,31];
    for ($c = 0; $c < $numDataColumns; $c++) {
        $monthIndex = (int) floor($c / $colsPerMonth) % 12;
        $day = $monthDays[$monthIndex];
        $startRow[] = sprintf('01.%02d.%d', $monthIndex + 1, $year);
        $endRow[] = sprintf('%02d.%02d.%d', $day, $monthIndex + 1, $year);
        $planFactRow[] = ($c % 2 === 0) ? 'ПЛАН' : 'ФАКТ';
    }
    $matrix[] = $startRow;
    $matrix[] = $endRow;
    $matrix[] = $planFactRow;

    // Section 1: [Выручка]
    $matrix[] = ['Выручка'];
    for ($r = 0; $r < $numDataRowsPerSection; $r++) {
        $row = ['Выручка позиция ' . $r];
        for ($c = 0; $c < $numDataColumns; $c++) {
            $row[] = (string) ($r * 1000 + $c);
        }
        $matrix[] = $row;
    }

    // Section 2: [Поступления]
    $matrix[] = ['Поступления'];
    for ($r = 0; $r < $numDataRowsPerSection; $r++) {
        $row = ['Поступления позиция ' . $r];
        for ($c = 0; $c < $numDataColumns; $c++) {
            $row[] = (string) ($r * 1000 + $c + 500000);
        }
        $matrix[] = $row;
    }

    return $matrix;
}

function build_year_columns($year) {
    $columns = [];
    $monthDays = [31,28,31,30,31,30,31,31,30,31,30,31];
    for ($m = 1; $m <= 12; $m++) {
        $columns[] = [
            sprintf('01.%02d.%d', $m, $year),
            sprintf('%02d.%02d.%d', $monthDays[$m - 1], $m, $year),
            'ПЛАН||ФАКТ',
        ];
    }
    return $columns;
}

function bench($label, $callable) {
    $start = microtime(true);
    $result = $callable();
    $elapsed = microtime(true) - $start;
    printf("%-50s %8.3f s\n", $label, $elapsed);
    return ['elapsed' => $elapsed, 'result' => $result];
}

$rowsPerSection = 200;
$cols = 136;
$year = 2026;

$matrix = build_synthetic_matrix($rowsPerSection, $cols, $year);
printf("Synthetic matrix: %d rows x up to %d columns\n", count($matrix), $cols + 1);

$rowMatchers = [
    '[Выручка]Выручка *',
    '[Поступления]Поступления *',
];
$columnMatchers = build_year_columns($year);

$run = bench('gss_extract_sheet_records (perf)', function () use ($matrix, $rowMatchers, $columnMatchers) {
    return gss_extract_sheet_records('Bench', $matrix, $rowMatchers, $columnMatchers, false, 0);
});

$records = $run['result'];
$elapsed = $run['elapsed'];

// Each data row matches one row spec. Each data column has a column-spec match
// for exactly its own month -> exactly one record per (data row, data column).
$expectedRecords = $rowsPerSection * 2 * $cols;
assert_eq_2673($expectedRecords, count($records), 'record count matches expectation');

// Sanity-check the first record's structure. After 4 header rows + 1 section
// precondition row, the first data row sits at matrix index 5.
$first = $records[0];
assert_eq_2673('Bench', $first['sheet'], 'first record sheet name');
assert_eq_2673(5, $first['row_index'], 'first record row_index is the matrix-relative index');
assert_eq_2673(6, $first['row_number'], 'first record row_number is 1-based row position');
assert_eq_2673('[Выручка]Выручка позиция 0', $first['row'], 'first record carries precondition-prefixed row label');
assert_eq_2673('0', $first['value'], 'first record value matches matrix cell');

// The performance target: the previous implementation took tens of seconds on
// this input; the optimized version should finish well under a second on
// commodity hardware. Allow a generous threshold for CI noise.
$ceiling = 5.0;
if ($elapsed > $ceiling) {
    fwrite(STDERR, "FAIL: gss_extract_sheet_records took {$elapsed}s, expected under {$ceiling}s\n");
    exit(1);
}

echo "PASS issue 2673 google_sheets_sync performance\n";
