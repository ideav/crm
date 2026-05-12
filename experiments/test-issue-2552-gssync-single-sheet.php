<?php
/**
 * Test for issue #2552:
 * - User pastes a single sheet config (object) instead of an array of sheets.
 * - gss_normalize_config() should wrap a single sheet config into a one-element array.
 * - gss_sync() must NOT throw "Each sheet config must define name or range" for the user's payload.
 */

require_once __DIR__ . '/../include/google_sheets_sync.php';

// User-supplied config from the issue:
$userPayload = [
    'spreadsheet_id' => 'some-id',
    'sheets' => [
        'name' => '(План-Факт) (2026)',
        'rows' => ['Выручка *', 'Поступления *'],
        'columns' => [
            ['01.01.202*', '31.01.202*', 'ПЛАН||ФАКТ'],
            ['01.02.202*', '28.02.202*', 'ПЛАН||ФАКТ'],
            '2025',
            '2026',
        ],
    ],
];

$normalized = gss_normalize_config($userPayload, __DIR__);
assert(is_array($normalized['sheets']), 'sheets must be an array');
assert(count($normalized['sheets']) === 1, 'single sheet should be wrapped into a 1-element array');
assert(isset($normalized['sheets'][0]['name']), 'wrapped sheet must keep the "name" field');
assert($normalized['sheets'][0]['name'] === '(План-Факт) (2026)', 'sheet name preserved');

echo "OK: gss_normalize_config wraps a single sheet object into [sheet]\n";

// Verify the array-of-sheets form still works unchanged.
$arrayPayload = [
    'spreadsheet_id' => 'some-id',
    'sheets' => [
        [
            'name' => 'Sheet A',
            'rows' => ['Row A'],
            'columns' => [['x', 'y', 'z']],
        ],
        [
            'name' => 'Sheet B',
            'rows' => ['Row B'],
            'columns' => [['x', 'y', 'z']],
        ],
    ],
];
$normalized = gss_normalize_config($arrayPayload, __DIR__);
assert(count($normalized['sheets']) === 2, 'two-sheet array preserved as-is');
echo "OK: array-of-sheets form preserved\n";

// Verify empty sheets stays empty (no spurious wrapping).
$emptyPayload = ['sheets' => []];
$normalized = gss_normalize_config($emptyPayload, __DIR__);
assert($normalized['sheets'] === [], 'empty sheets stays empty');
echo "OK: empty sheets unchanged\n";

// Verify the exact JSON from the issue parses, normalizes, and matches the schema gss_sync() expects.
$issueRaw = '{
  "name": "(План-Факт) (2026)",
  "rows": [
    "Выручка *",
    "Поступления *"
  ],
  "columns": [
    ["01.01.202*", "31.01.202*", "ПЛАН||ФАКТ"],
    ["01.02.202*", "28.02.202*", "ПЛАН||ФАКТ"],
    ["01.03.202*", "31.03.202*", "ПЛАН||ФАКТ"],
    ["01.04.202*", "30.04.202*", "ПЛАН||ФАКТ"],
    ["01.05.202*", "31.05.202*", "ПЛАН||ФАКТ"],
    ["01.06.202*", "30.06.202*", "ПЛАН||ФАКТ"],
    ["01.07.202*", "31.07.202*", "ПЛАН||ФАКТ"],
    ["01.08.202*", "31.08.202*", "ПЛАН||ФАКТ"],
    ["01.09.202*", "30.09.202*", "ПЛАН||ФАКТ"],
    ["01.10.202*", "31.10.202*", "ПЛАН||ФАКТ"],
    ["01.11.202*", "30.11.202*", "ПЛАН||ФАКТ"],
    ["01.12.202*", "31.12.202*", "ПЛАН||ФАКТ"],
    "2025",
    "2026"
  ]
}';
$sheet = json_decode($issueRaw, true);
assert($sheet !== null, 'issue payload must parse as JSON');
$saved = ['spreadsheet_id' => 'X', 'sheets' => $sheet];
$normalized = gss_normalize_config($saved, __DIR__);
assert(is_array($normalized['sheets']) && count($normalized['sheets']) === 1, 'issue payload wrapped to array of size 1');
assert($normalized['sheets'][0]['name'] === '(План-Факт) (2026)', 'issue sheet name preserved');
echo "OK: exact issue payload normalized to array of one sheet\n";

echo "All assertions passed.\n";
