// Unit tests for the «Карта раскроя» layout core (ideav/crm#2917).
// Verifies the cutting-map geometry derived from the atex spec
// («Производственная резка» → «Тип резки» → «Полоса»):
//   • each strip yields «количество» knives of «ширина»;
//   • «Занято, мм» = Σ(ширина × количество);
//   • «Остаток, мм» = «Ширина входа» − «Занято, мм»;
//   • segments expand each strip into its individual knives with left offsets;
//   • widthPercent scales to max(вход, занято) so overflow stays visible.
//
// Run with: node experiments/atex-cut-map.test.js

var layout = require('../js/atex-cut-map.js').layout;

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
assertEqual(layout.toNumber('25'), 25, 'toNumber parses integer string');
assertEqual(layout.toNumber('25,5'), 25.5, 'toNumber accepts comma decimal');
assertEqual(layout.toNumber(' 1 200 '), 1200, 'toNumber strips spaces');
assertEqual(layout.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(layout.toNumber('abc'), 0, 'toNumber garbage → 0');

var strips1 = [
    { width: 25, qty: 10, purpose: 'Заказ' },
    { width: 35, qty: 12, purpose: 'Заказ' },
    { width: 55, qty: 1, purpose: 'Склад' }
];

// ── totalKnives = Σ количество ──
assertEqual(layout.totalKnives(strips1), 23, 'totalKnives sums all quantities (10+12+1)');

// ── usedWidth = Σ(ширина × количество) ──
// 25*10 + 35*12 + 55*1 = 250 + 420 + 55 = 725
assertEqual(layout.usedWidth(strips1), 725, 'usedWidth sums width*qty');

// ── expandSegments: один сегмент на каждый нож, со смещением слева ──
var segs = layout.expandSegments([
    { width: 25, qty: 3, purpose: 'Заказ', name: 'A' },
    { width: 55, qty: 1, purpose: 'Склад', name: 'B' }
]);
assertEqual(segs.length, 4, 'expandSegments expands qty into individual knives (3+1)');
assertEqual(segs.map(function(s) { return s.offset; }), [0, 25, 50, 75],
    'expandSegments accumulates left offset per knife');
assertEqual(segs.map(function(s) { return s.width; }), [25, 25, 25, 55],
    'expandSegments keeps each knife width');
assertEqual(segs[3].purpose, 'Склад', 'expandSegments carries purpose from its strip');
assertEqual(segs.map(function(s) { return s.stripIndex; }), [0, 0, 0, 1],
    'expandSegments tags each knife with its source strip index');

// ── computeLayout: совокупный результат ──
var lay1 = layout.computeLayout(910, strips1, 15);
assertEqual({
    inputWidth: lay1.inputWidth,
    usedWidth: lay1.usedWidth,
    remainder: lay1.remainder,
    totalKnives: lay1.totalKnives,
    stripKinds: lay1.stripKinds,
    segCount: lay1.segments.length,
    overflow: lay1.overflow,
    withinTolerance: lay1.withinTolerance
}, {
    inputWidth: 910,
    usedWidth: 725,
    remainder: 185,             // 910 − 725
    totalKnives: 23,
    stripKinds: 3,
    segCount: 23,
    overflow: false,
    withinTolerance: false      // |185| > 15
}, 'computeLayout aggregates входа/занято/остаток, segments, flags');

// Перекрытие входа полосами → отрицательный остаток (overflow).
var strips2 = [
    { width: 100, qty: 5, purpose: 'Заказ' },
    { width: 60, qty: 8, purpose: 'Заказ' }
];
// used = 500 + 480 = 980; вход 900 → остаток −80, overflow
var lay2 = layout.computeLayout(900, strips2, 15);
assertEqual({ used: lay2.usedWidth, rem: lay2.remainder, overflow: lay2.overflow },
    { used: 980, rem: -80, overflow: true },
    'computeLayout flags overflow when strips exceed input width');

// Остаток в пределах допуска.
var strips3 = [
    { width: 200, qty: 2, purpose: 'Заказ' },
    { width: 150, qty: 3, purpose: 'Склад' }
];
// used = 400 + 450 = 850; вход 860 → остаток 10; допуск 15 → в норме
var lay3 = layout.computeLayout(860, strips3, 15);
assertEqual({ rem: lay3.remainder, within: lay3.withinTolerance },
    { rem: 10, within: true }, 'computeLayout marks remainder within tolerance');

// Без допуска признак не вычисляется.
assertEqual(layout.computeLayout(860, strips3).withinTolerance, null,
    'withinTolerance is null when tolerance not provided');

// Пустой набор полос: всё нули, остаток равен ширине входа.
var layEmpty = layout.computeLayout(500, []);
assertEqual({ used: layEmpty.usedWidth, rem: layEmpty.remainder, segs: layEmpty.segments.length },
    { used: 0, rem: 500, segs: 0 }, 'empty strips: remainder equals input width, no segments');

// ── widthPercent: масштаб по max(вход, занято) ──
// вход 910 ≥ занято 725 → шкала 910; 25/910*100 = 2.747
assertEqual(layout.widthPercent(25, lay1), 2.747, 'widthPercent scales to input width when not overflowing');
// overflow: занято 980 > вход 900 → шкала 980; 100/980*100 = 10.204
assertEqual(layout.widthPercent(100, lay2), 10.204, 'widthPercent scales to used width on overflow');
assertEqual(layout.widthPercent(50, { inputWidth: 0, usedWidth: 0 }), 0,
    'widthPercent is 0 when scale is 0');

// Дробные значения и запятые-разделители из БД.
var strips4 = [
    { width: '12,5', qty: '4', purpose: 'Заказ' },
    { width: '7,5', qty: '2', purpose: 'Отходы' }
];
// used = 12.5*4 + 7.5*2 = 50 + 15 = 65; вход 70 → остаток 5; ножей 6
var lay4 = layout.computeLayout('70', strips4, '5');
assertEqual({ used: lay4.usedWidth, rem: lay4.remainder, knives: lay4.totalKnives, segs: lay4.segments.length },
    { used: 65, rem: 5, knives: 6, segs: 6 },
    'computeLayout parses comma decimals from DB values');

console.log('\n' + passed + ' assertions passed');
