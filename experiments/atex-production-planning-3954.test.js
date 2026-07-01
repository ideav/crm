// Unit tests for lazy preferable_widths gating (ideav/crm#3954).
// The «Ходовые ширины» report (report/preferable_widths) is slow. Its result is only
// ever consumed to top up the jumbo remainder with stockable widths (filterStockableWidths,
// #3391) — so for a nomenclature FAMILY (material+length+winding) that has no entry in
// «Максимальный запас», the report would be filtered down to nothing. maxStockFamilyStockable
// is the width-agnostic gate that lets callers skip the report in exactly that case.
//
// Run with: node experiments/atex-production-planning-3954.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Метаданные и строки «Максимального запаса» — как в #3391.
var maxStockMeta = {
    id: '67113', val: 'Максимальный запас', reqs: [
        { id: '67114', val: 'Вид сырья' },
        { id: '67115', val: 'Ширина, мм' },
        { id: '67116', val: 'Длина, м' },
        { id: '67117', val: 'Тип намотки' },
        { id: '67118', val: 'Диаметр втулки' },
        { id: '67119', val: 'Лидер' },
        { id: '67120', val: 'Примечание' }
    ]
};
var MW308 = '1100', MWR200 = '1101';
var SLEEVE_GREY = '8193', LEADER_BRAND = '66408';
function row(i, limit, mat, width, length, winding, note) {
    return { i: String(i), r: [
        String(limit), mat + ':MW', String(width), String(length), winding,
        SLEEVE_GREY + ':1 пластик серый', LEADER_BRAND + ':Фирменный', note || ''
    ] };
}
var rows = [
    row(1, 1740, MW308, 30, 300, 'OUT'),
    row(2, 660, MW308, 80, 300, 'OUT'),
    row(3, 600, MW308, 60, 450, 'OUT'),
    row(4, 120, MWR200, 110, 300, 'OUT')
];
var index = planning.buildMaxStockIndex(rows, maxStockMeta);
var emptyIndex = planning.buildMaxStockIndex([], null);

// ── maxStockFamilyStockable ──
// Семейство присутствует (сырьё+длина+намотка) — независимо от того, есть ли конкретная
// ширина: гейт должен пропустить запрос отчёта (среди ходовых могут быть стокабельные).
assertEqual(planning.maxStockFamilyStockable(index, { material: MW308, length: 300, winding: 'OUT' }),
    true, 'family: MW308 300 OUT есть в таблице → true');
// Ширина в таблице отсутствует, но семейство есть → true (ширина в гейте не учитывается).
assertEqual(planning.maxStockFamilyStockable(index, { material: MW308, length: 300, winding: 'OUT', width: 999 }),
    true, 'family: ширина 999 нет, но семейство MW308 300 OUT есть → true (ширина игнорируется)');
// Другая длина этого сырья присутствует (450) — тоже семейство.
assertEqual(planning.maxStockFamilyStockable(index, { material: MW308, length: 450, winding: 'OUT' }),
    true, 'family: MW308 450 OUT есть → true');
// Нормализация: намотка в нижнем регистре, длина строкой с дробью.
assertEqual(planning.maxStockFamilyStockable(index, { material: MW308, length: '300.00', winding: 'out' }),
    true, 'family: нормализация намотки/длины → true');

// Семейства НЕТ → false: другая намотка, другая длина, другое сырьё.
assertEqual(planning.maxStockFamilyStockable(index, { material: MW308, length: 300, winding: 'IN' }),
    false, 'family: другая намотка (IN) → false');
assertEqual(planning.maxStockFamilyStockable(index, { material: MW308, length: 600, winding: 'OUT' }),
    false, 'family: другая длина (600) → false');
assertEqual(planning.maxStockFamilyStockable(index, { material: '9999', length: 300, winding: 'OUT' }),
    false, 'family: чужое сырьё → false');
// MWR200 есть только на 300 OUT — 450 OUT нет.
assertEqual(planning.maxStockFamilyStockable(index, { material: MWR200, length: 450, winding: 'OUT' }),
    false, 'family: MWR200 450 OUT нет → false');
assertEqual(planning.maxStockFamilyStockable(index, { material: MWR200, length: 300, winding: 'OUT' }),
    true, 'family: MWR200 300 OUT есть → true');

// Таблица не настроена → фича добора выключена, ходовые применяются как есть → всегда true.
assertEqual(planning.maxStockFamilyStockable(emptyIndex, { material: '9999', length: 1, winding: '' }),
    true, 'family: таблица выключена → true (поведение прежнее)');
assertEqual(planning.maxStockFamilyStockable(null, { material: MW308, length: 300, winding: 'OUT' }),
    true, 'family: index null → true (не настроено)');

// Согласованность с filterStockableWidths: если гейт вернул false, любой добор пуст.
var preferred = [{ width: 30, popularity: 10 }, { width: 60, popularity: 8 }, { width: 80, popularity: 3 }];
var deadFamily = { material: MW308, winding: 'IN', length: 300 };  // семейства нет
assertEqual(planning.maxStockFamilyStockable(index, deadFamily), false,
    'consistency: гейт для MW308 IN 300 → false');
assertEqual(planning.filterStockableWidths(index, preferred, deadFamily), [],
    'consistency: filterStockableWidths для того же семейства → [] (отчёт был бы напрасен)');

console.log('\n' + passed + ' assertions passed');
