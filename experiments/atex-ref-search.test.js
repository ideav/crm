// Unit tests for shared AtexRefSearch helpers (download/atex/js/ref-search.js).
//   • formatDateTime — DATETIME (type 4) unix-штамп → «ДД.ММ.ГГГГ ЧЧ:ММ».
//
// Run with: node experiments/atex-ref-search.test.js
// TZ pinned to UTC for deterministic timestamp assertions.

process.env.TZ = 'UTC';
var rs = require('../download/atex/js/ref-search.js');

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── formatDateTime ──
assertEqual(rs.formatDateTime('1777815000'), '03.05.2026 13:30', 'unix-штамп (сек) → ДД.ММ.ГГГГ ЧЧ:ММ (UTC)');
assertEqual(rs.formatDateTime('1778065200'), '06.05.2026 11:00', 'другой штамп → корректная дата/время (UTC)');
assertEqual(rs.formatDateTime(''), '', 'пусто → пусто');
assertEqual(rs.formatDateTime(null), '', 'null → пусто');
assertEqual(rs.formatDateTime('03.05.2026'), '03.05.2026', 'уже дата-строка → как есть');
assertEqual(rs.formatDateTime('abc'), 'abc', 'не число → как есть');

console.log('\n' + passed + ' assertions passed');
