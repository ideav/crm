// Unit tests for #3706 — кнопку «Полосы» в очереди красим светло-красным там, где
// остаток джамбо резки ВНЕ ДОПУСКА (отход вне допуска виден без открытия панели).
// Покрываем чистое ядро planning.cutRemainderStatus(jumboWidth, knifeWidths, tolerance):
//   'warn'    — |остаток| > допуска;
//   'ok'      — |остаток| <= допуска;
//   'unknown' — ширина джамбо не задана (не сигналим ложный негатив, #3116 п.5).
// Числа — из разбора #3684 (сырьё MWR116L: «Ширина, мм» = 891, допуск 20).
//
// Run with: node experiments/atex-production-planning-3706.test.js

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

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

var JUMBO = 891, TOL = 20;

// 1) Джамбо не задан → 'unknown' (не красим), для любых форм «пусто».
assertEqual(planning.cutRemainderStatus(0, [33, 33], TOL), 'unknown',
    '#3706: джамбо 0 → unknown (не сигналим)');
assertEqual(planning.cutRemainderStatus('', [33, 33], TOL), 'unknown',
    '#3706: джамбо «» → unknown');
assertEqual(planning.cutRemainderStatus(null, [33, 33], TOL), 'unknown',
    '#3706: джамбо null → unknown');

// 2) Полная раскладка менеджера: 33×7 + 55×10 + 34×3 = 883 → остаток 8 ≤ 20 → ok.
var ok883 = [].concat(
    Array(7).fill(33), Array(10).fill(55), Array(3).fill(34)
);
assertEqual(planning.cutRemainderStatus(JUMBO, ok883, TOL), 'ok',
    '#3706: остаток 8 мм (≤ допуска 20) → ok');

// 3) Джамбо занят ровно (33×27 = 891) → остаток 0 → ok.
assertEqual(planning.cutRemainderStatus(JUMBO, Array(27).fill(33), TOL), 'ok',
    '#3706: остаток 0 мм → ok');

// 4) Осиротевшая резка из #3684: 34×3 = 102 → остаток 789 ≫ 20 → warn.
assertEqual(planning.cutRemainderStatus(JUMBO, Array(3).fill(34), TOL), 'warn',
    '#3706: остаток 789 мм (≫ допуска) → warn');

// 5) Граница: остаток ровно = допуску → ok (в допуске, не строго меньше).
//    used = 871 → остаток 20 == TOL.
assertEqual(planning.cutRemainderStatus(JUMBO, [871], TOL), 'ok',
    '#3706: остаток ровно = допуску → ok (граница включительно)');
//    used = 870 → остаток 21 > TOL → warn.
assertEqual(planning.cutRemainderStatus(JUMBO, [870], TOL), 'warn',
    '#3706: остаток на 1 мм больше допуска → warn');

// 6) Пустая резка (полос ещё нет) → остаток = весь джамбо → warn.
assertEqual(planning.cutRemainderStatus(JUMBO, [], TOL), 'warn',
    '#3706: нет полос → остаток = джамбо → warn');
assertEqual(planning.cutRemainderStatus(JUMBO, undefined, TOL), 'warn',
    '#3706: knifeWidths undefined → остаток = джамбо → warn');

// 7) Переполнение (полосы шире джамбо): used 920 → остаток −29, |−29| > 20 → warn.
assertEqual(planning.cutRemainderStatus(JUMBO, [920], TOL), 'warn',
    '#3706: полосы превышают джамбо (остаток < 0, вне допуска) → warn');

// 8) Нечисловые/нулевые полосы игнорируются при подсчёте занятой ширины.
assertEqual(planning.cutRemainderStatus(JUMBO, [33, '', null, 0, -5, 33], 825), 'ok',
    '#3706: мусорные значения полос не ломают подсчёт (used 66, остаток 825 ≤ допуска 825)');

console.log('\n' + passed + ' assertions passed.');
