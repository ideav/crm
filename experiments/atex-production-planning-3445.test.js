// Unit tests for «Максимальный запас» — КОЛИЧЕСТВЕННЫЙ лимит (ideav/crm#3445).
// PR #3395/#3391 решал членство (Склад vs Отходы). #3445 добавляет лимит: на склад
// по номенклатуре нельзя нарезать больше «Максимального запаса» (первая колонка) с
// учётом текущего остатка. Проверяем чистое ядро:
//   • buildStockBalanceIndex — «Партии ГП» (не «Отгружен») → остаток рулонов по ключу;
//   • currentStock / stockHeadroom — остаток и свободный лимит (limit − остаток);
//   • capStockToHeadroom — обрезка добора и перепроизводства до headroom (capping).
//
// Run with: node experiments/atex-production-planning-3445.test.js

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

// ── Индекс «Максимального запаса» (как в #3391, table/67113) ──
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
function row(i, limit, mat, width, length, winding) {
    return { i: String(i), r: [String(limit), mat + ':MW', String(width), String(length), winding, '', '', ''] };
}
var maxStockIndex = planning.buildMaxStockIndex([
    row(1, 3150, MW308, 60, 300, 'OUT'),
    row(2, 1620, MW308, 60, 300, 'OUT'),   // дубль → максимум 3150
    row(3, 120, MWR200, 110, 300, 'OUT')
], maxStockMeta);

// ── buildStockBalanceIndex / currentStock ──
var balance = planning.buildStockBalanceIndex([
    { material: MW308, width: 60, length: 300, winding: 'OUT', rolls: 1000, shipped: false },
    { material: MW308, width: 60, length: 300, winding: 'OUT', rolls: 500, shipped: false },
    { material: MW308, width: 60, length: 300, winding: 'OUT', rolls: 9999, shipped: true },  // отгружено → не считаем
    { material: MWR200, width: 110, length: 300, winding: 'OUT', rolls: 0, shipped: false },   // 0 рулонов → пропуск
    null
]);
assertEqual(balance.byKey[MW308 + '|60|300|OUT'], 1500, 'buildStockBalanceIndex: суммирует не-отгруженные (1000+500)');
assertEqual(balance.byKey[MWR200 + '|110|300|OUT'], undefined, 'buildStockBalanceIndex: 0 рулонов не попадает в индекс');
assertEqual(planning.currentStock(balance, { material: MW308, width: 60, length: 300, winding: 'OUT' }), 1500, 'currentStock: 1500');
assertEqual(planning.currentStock(balance, { material: MWR200, width: 110, length: 300, winding: 'OUT' }), 0, 'currentStock: пусто → 0');

// ── stockHeadroom ──
assertEqual(planning.stockHeadroom(maxStockIndex, balance, { material: MW308, width: 60, length: 300, winding: 'OUT' }),
    1650, 'stockHeadroom: 3150 − 1500 = 1650');
assertEqual(planning.stockHeadroom(maxStockIndex, balance, { material: MWR200, width: 110, length: 300, winding: 'OUT' }),
    120, 'stockHeadroom: 120 − 0 = 120');
assertEqual(planning.stockHeadroom(maxStockIndex, balance, { material: MW308, width: 999, length: 300, winding: 'OUT' }),
    null, 'stockHeadroom: нет в справочнике → null');
// Остаток уже превышает лимит → headroom 0 (не отрицателен).
var balanceOver = planning.buildStockBalanceIndex([
    { material: MWR200, width: 110, length: 300, winding: 'OUT', rolls: 200, shipped: false }
]);
assertEqual(planning.stockHeadroom(maxStockIndex, balanceOver, { material: MWR200, width: 110, length: 300, winding: 'OUT' }),
    0, 'stockHeadroom: остаток > лимита → 0');

// ── capStockToHeadroom ──
// Контекст: проходы и спрос задаём явно (в проде — plannedRunsForLayout / спрос позиций).
function makeCtx(runs, demandMap) {
    return {
        runsForLayout: function() { return runs; },
        demandRollsForWidth: function(layout, w) { return (demandMap && demandMap[String(w)]) || 0; },
        headroomForNom: function(nom) { return planning.stockHeadroom(maxStockIndex, balanceOver, nom); }
    };
}

// (1) Добор «Склад» обрезается до headroom; перепроизводство заказа — до минимума,
//     покрывающего спрос. Кумулятивно по двум раскладкам одной номенклатуры.
//     MWR200 110×300 OUT: лимит 120, остаток 200 → headroom 0 → весь впрок режется.
var layoutsZero = [
    { mat: MWR200, windDir: 'OUT', windLength: 300, strips: [
        { width: 110, qty: 20, purpose: 'Склад', positionIds: [] }
    ] }
];
var resZero = planning.capStockToHeadroom(layoutsZero, makeCtx(10, {}));
assertEqual(layoutsZero[0].strips.length, 0, 'capping: headroom 0 → складская полоса удалена');
assertEqual(resZero.trimmed, [{ key: MWR200 + '|110|300|OUT', width: 110, kind: 'добор', droppedRolls: 200 }],
    'capping: добор урезан на 200 рулонов');

// (2) Свободный headroom — частичная обрезка. MW308 60×300 OUT: лимит 3150, остаток 1500
//     → headroom 1650. runs=100. Добор qty=20 → 2000 рулонов > 1650 → qty=16 (1600), −400.
var ctxFree = {
    runsForLayout: function() { return 100; },
    demandRollsForWidth: function() { return 0; },
    headroomForNom: function(nom) { return planning.stockHeadroom(maxStockIndex, balance, nom); }
};
var layoutsFree = [
    { mat: MW308, windDir: 'OUT', windLength: 300, strips: [
        { width: 60, qty: 20, purpose: 'Склад', positionIds: [] }
    ] }
];
var resFree = planning.capStockToHeadroom(layoutsFree, ctxFree);
assertEqual(layoutsFree[0].strips[0].qty, 16, 'capping: добор 20→16 полос (1600 ≤ 1650 рулонов)');
assertEqual(resFree.trimmed, [{ key: MW308 + '|60|300|OUT', width: 60, kind: 'добор', droppedRolls: 400 }],
    'capping: добор урезан на 400 рулонов');

// (3) Перепроизводство заказной ширины при headroom 0 → до минимума покрытия спроса.
//     MWR200 110×300 OUT headroom 0. runs=10, спрос=100 → minQty=10. qty=15→10, −50.
var layoutsOrder = [
    { mat: MWR200, windDir: 'OUT', windLength: 300, strips: [
        { width: 110, qty: 15, purpose: 'Заказ', positionIds: ['p1'] }
    ] }
];
var resOrder = planning.capStockToHeadroom(layoutsOrder, makeCtx(10, { '110': 100 }));
assertEqual(layoutsOrder[0].strips[0].qty, 10, 'capping: перепроизводство 15→10 (покрытие спроса сохранено)');
assertEqual(resOrder.trimmed, [{ key: MWR200 + '|110|300|OUT', width: 110, kind: 'перепроизводство', droppedRolls: 50 }],
    'capping: перепроизводство урезано на 50 рулонов');

// (4) Заказ под спрос без излишка и неизвестная номенклатура — не трогаем.
var layoutsKeep = [
    { mat: MWR200, windDir: 'OUT', windLength: 300, strips: [
        { width: 110, qty: 10, purpose: 'Заказ', positionIds: ['p1'] }   // ровно спрос
    ] },
    { mat: MW308, windDir: 'OUT', windLength: 300, strips: [
        { width: 999, qty: 7, purpose: 'Склад', positionIds: [] }        // нет в справочнике → null headroom
    ] }
];
var resKeep = planning.capStockToHeadroom(layoutsKeep, makeCtx(10, { '110': 100 }));
assertEqual(layoutsKeep[0].strips[0].qty, 10, 'capping: заказ ровно под спрос не урезан');
assertEqual(layoutsKeep[1].strips[0].qty, 7, 'capping: номенклатура вне справочника не урезается');
assertEqual(resKeep.trimmed, [], 'capping: ничего не урезано');

// (5) Интеграция: реальный planLayouts → plannedRunsForLayout → capStockToHeadroom.
//     Проверяет, что capping работает на фактических полях раскладки (positionsCovered,
//     mat/windDir/windLength, strips). MWR200 110×300 OUT: остаток 200 > лимит 120 →
//     headroom 0 → весь добор ходовыми (110) срезается, заказная ширина 300 (нет в
//     справочнике → лимита нет) остаётся.
var layoutCore = require('../download/atex/js/cut-layout.js').layout;
var plan = layoutCore.planLayouts({
    jumboWidth: 1000,
    positions: [{ id: 'p1', width: 300, qty: 1, dueKey: 1, stockable: true }],
    preferred: [{ width: 110, popularity: 9 }],
    options: { windowDays: Infinity, tolerance: 0 }
});
var lay = plan.layouts[0];
lay.mat = MWR200; lay.windDir = 'OUT'; lay.windLength = 300;
var hadStockStrip = lay.strips.some(function(s) { return planning.isStockStrip(s) && s.width === 110; });
assertEqual(hadStockStrip, true, 'integration: planLayouts дал складскую полосу 110 (добор)');
var posById = { p1: { id: 'p1', width: 300, qty: 1 } };
var intRes = planning.capStockToHeadroom([lay], {
    runsForLayout: function(l) { return planning.plannedRunsForLayout(l, posById); },
    demandRollsForWidth: function(l, w) {
        var sum = 0;
        (l.positionsCovered || []).forEach(function(pid) {
            var p = posById[String(pid)];
            if (p && Number(p.width) === Number(w)) sum += Number(p.qty) || 0;
        });
        return sum;
    },
    headroomForNom: function(nom) { return planning.stockHeadroom(maxStockIndex, balanceOver, nom); }
});
assertEqual(lay.strips.some(function(s) { return planning.isStockStrip(s); }), false,
    'integration: добор 110 срезан (headroom 0), складских полос не осталось');
assertEqual(lay.strips.some(function(s) { return Number(s.width) === 300; }), true,
    'integration: заказная ширина 300 (вне справочника) сохранена');
assertEqual(intRes.trimmed.length >= 1 && intRes.trimmed[0].kind, 'добор',
    'integration: trimmed помечает срез добора');

console.log('\n' + passed + ' проверок пройдено');
