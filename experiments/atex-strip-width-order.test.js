// Единый порядок полос резки — по УБЫВАНИЮ ширины (широкие раньше узких).
//
// Проверяет sortStripsByWidthDesc и то, что все точки формирования дают полосы
// одним рядом по убыванию, вперемешку по назначению (Заказ/Склад/втулка):
//   • cut-layout.composeLayout — складской добор ШИРЕ заказных всё равно встаёт по ширине;
//   • cut-layout.sortStripsByWidthDesc — тай-брейк по назначению, пустые строки в конец;
//   • production-planning.appendCoreStrip — втулочная полоса встаёт в свою позицию по ширине.
//
// Run with: node experiments/atex-strip-width-order.test.js

process.env.TZ = 'UTC';

var layout = require('../download/atex/js/cut-layout.js').layout;
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function widths(strips) { return strips.map(function(s) { return s.width; }); }
function isNonIncreasing(ws) {
    for (var i = 1; i < ws.length; i++) {
        var a = Number(ws[i - 1]), b = Number(ws[i]);
        if (isFinite(a) && isFinite(b) && a < b) return false;   // строго меньше предыдущего — нарушение
    }
    return true;
}

// ── sortStripsByWidthDesc: убывание, тай-брейк по назначению, пустые в конец ──
var mixed = [
    { width: 40,  qty: 1, purpose: 'Заказ' },
    { width: 110, qty: 2, purpose: 'Склад' },
    { width: 70,  qty: 1, purpose: 'Заказ' },
    { width: '',  qty: '', purpose: 'Заказ' },   // пустая строка редактора
    { width: 70,  qty: 3, purpose: 'Склад' }
];
layout.sortStripsByWidthDesc(mixed);
assertEqual(widths(mixed), [110, 70, 70, 40, ''], 'sort (cut-layout): по убыванию, пустая строка в конец');
assertEqual([mixed[1].purpose, mixed[2].purpose], ['Заказ', 'Склад'], 'sort: при равной ширине 70 — Заказ раньше Склада');

// production-planning несёт тот же порядок (миррор), в т.ч. для строковых ширин.
var mixed2 = [
    { width: '40', qty: '1', purpose: 'Заказ' },
    { width: '110', qty: '2', purpose: 'Склад' },
    { width: '70', qty: '1', purpose: 'Заказ' }
];
planning.sortStripsByWidthDesc(mixed2);
assertEqual(widths(mixed2), ['110', '70', '40'], 'sort (production-planning): строковые ширины по убыванию');

// ── composeLayout: складской добор 70 ШИРЕ заказных 50/40 → единый ряд по убыванию ──
var L = layout.composeLayout(300, [{ width: 50, qty: 1, positionId: 'a' }, { width: 40, qty: 1, positionId: 'b' }],
    [{ width: 70, popularity: 10 }], 0);
assertEqual(isNonIncreasing(widths(L.strips)), true, 'composeLayout: полосы идут по убыванию ширины');
assertEqual(widths(L.strips), [70, 50, 40], 'composeLayout: 70(склад) → 50 → 40, склад не свален в конец');
assertEqual(L.strips[0].purpose, 'Склад', 'composeLayout: самая широкая (70) — складская, стоит первой');

// ── appendCoreStrip: втулочная полоса 110 встаёт МЕЖДУ 200 и 50 (не в конец) ──
var lay = { strips: [
    { width: 200, qty: 1, purpose: 'Заказ', positionIds: ['p1'] },
    { width: 50,  qty: 2, purpose: 'Заказ', positionIds: ['p2'] }
] };
planning.appendCoreStrip(lay, 110, 3);
assertEqual(widths(lay.strips), [200, 110, 50], 'appendCoreStrip: втулка 110 встаёт по своей ширине (между 200 и 50)');
assertEqual(isNonIncreasing(widths(lay.strips)), true, 'appendCoreStrip: единый ряд по убыванию сохранён');

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки порядка полос зелёные.');
