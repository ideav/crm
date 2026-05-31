// Unit tests for the «Калькулятор типов резки» calc core (ideav/crm#2912).
// Verifies the design-spec formulas from the atex spec («Тип резки»):
//   • «Итого ножей» = сумма всех количеств полос (Σ количество);
//   • «Остаток, мм» = «Ширина входа» − Σ(ширина полосы × количество).
//
// Run with: node experiments/atex-cut-calc.test.js

var calc = require('../download/atex/js/cut-calc.js').calc;

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

// ── toNumber: терпимый разбор ──
assertEqual(calc.toNumber('25'), 25, 'toNumber parses integer string');
assertEqual(calc.toNumber('25,5'), 25.5, 'toNumber accepts comma decimal');
assertEqual(calc.toNumber(' 1 200 '), 1200, 'toNumber strips spaces');
assertEqual(calc.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(calc.toNumber('abc'), 0, 'toNumber garbage → 0');
assertEqual(calc.toNumber(null), 0, 'toNumber null → 0');

// ── totalKnives = Σ количество ──
var strips1 = [
    { width: 25, qty: 10, purpose: 'Заказ' },
    { width: 35, qty: 12, purpose: 'Заказ' },
    { width: 55, qty: 1, purpose: 'Склад' }
];
assertEqual(calc.totalKnives(strips1), 23, 'totalKnives sums all quantities (10+12+1)');
assertEqual(calc.totalKnives([]), 0, 'totalKnives of empty set is 0');

// ── usedWidth = Σ(ширина × количество) ──
// 25*10 + 35*12 + 55*1 = 250 + 420 + 55 = 725
assertEqual(calc.usedWidth(strips1), 725, 'usedWidth sums width*qty');

// ── remainder = ширина входа − usedWidth ──
// вход 910 − 725 = 185
assertEqual(calc.remainder(910, strips1), 185, 'remainder = inputWidth − usedWidth');

// ── computeSummary: совокупный результат ──
assertEqual(calc.computeSummary(910, strips1, 15), {
    totalKnives: 23,
    usedWidth: 725,
    remainder: 185,
    withinTolerance: false   // |185| > 15
}, 'computeSummary aggregates knives/used/remainder, flags tolerance');

// Перекрытие входа полосами → отрицательный остаток.
var strips2 = [
    { width: 100, qty: 5, purpose: 'Заказ' },
    { width: 60, qty: 8, purpose: 'Заказ' }
];
// used = 500 + 480 = 980; вход 900 → остаток −80
assertEqual(calc.computeSummary(900, strips2, 15), {
    totalKnives: 13,
    usedWidth: 980,
    remainder: -80,
    withinTolerance: false
}, 'computeSummary handles over-allocation (negative remainder)');

// Остаток в пределах допуска.
var strips3 = [
    { width: 200, qty: 2, purpose: 'Заказ' },
    { width: 150, qty: 3, purpose: 'Склад' }
];
// used = 400 + 450 = 850; вход 860 → остаток 10; допуск 15 → в норме
assertEqual(calc.computeSummary(860, strips3, 15), {
    totalKnives: 5,
    usedWidth: 850,
    remainder: 10,
    withinTolerance: true
}, 'computeSummary marks remainder within tolerance');

// Без допуска признак не вычисляется.
assertEqual(calc.computeSummary(860, strips3).withinTolerance, null,
    'withinTolerance is null when tolerance not provided');

// Дробные значения и запятые-разделители из формы.
var strips4 = [
    { width: '12,5', qty: '4', purpose: 'Заказ' },
    { width: '7,5', qty: '2', purpose: 'Отходы' }
];
// used = 12.5*4 + 7.5*2 = 50 + 15 = 65; вход 70 → остаток 5; ножей 6
assertEqual(calc.computeSummary('70', strips4, '5'), {
    totalKnives: 6,
    usedWidth: 65,
    remainder: 5,
    withinTolerance: true
}, 'computeSummary parses comma decimals from form inputs');

// Пустой набор полос: всё нули, остаток равен ширине входа.
assertEqual(calc.computeSummary(500, []), {
    totalKnives: 0,
    usedWidth: 0,
    remainder: 500,
    withinTolerance: null
}, 'empty strips: remainder equals input width');

// round3 убирает артефакты float.
assertEqual(calc.usedWidth([{ width: 0.1, qty: 3 }]), 0.3, 'usedWidth avoids float drift (0.1*3)');

console.log('\n' + passed + ' assertions passed');
