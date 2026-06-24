// Unit tests for ideav/crm#3698 — хранение активностей переналадки в «Задание в
// производство» («Наладка ножей, мин» / «Сырье/намотка, мин») и их использование в Ганте.
//   • planning.setupActivityMinutes  — расщепление переналадки prev→next на KNIFE/MATERIAL_WINDING;
//   • planning.setupActivityColumns  — активности по упорядоченной очереди станка (+ carryPrevCut/firstCutSetup);
//   • gantt.rowsToCuts               — чтение хранимых колонок (null, если их нет);
//   • gantt.attachSetupMinutes       — предпочтение хранимых минут пересчёту (в т.ч. сохранённый 0).
//
// Run with: node experiments/atex-issue-3698-setup-columns.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;
var gantt = require('../download/atex/js/cut-gantt.js').gantt;

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

var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30 };

// Дескрипторы резок в форме changeoverParts (materialId/winding/batchId/knifeWidths/knifeCount/rollerWidth).
function cut(id, over) {
    var base = { id: id, materialId: '1', winding: 'IN', batchId: 'b1', knifeWidths: [100, 200], knifeCount: 2, rollerWidth: 1000 };
    for (var k in (over || {})) base[k] = over[k];
    return base;
}

// ── setupActivityMinutes: расщепление переналадки ──
var A = cut('A');
var same = cut('B');                                   // та же конфигурация
var matOnly = cut('C', { materialId: '2' });           // другое сырьё
var knifeOnly = cut('D', { knifeWidths: [100, 300] }); // другой набор ножей
var both = cut('E', { materialId: '2', knifeWidths: [100, 300] });

assertEqual(planning.setupActivityMinutes(A, same, TIMES), { knifeMin: 0, materialWindingMin: 0 }, 'минуты: без изменений → 0/0');
assertEqual(planning.setupActivityMinutes(A, matOnly, TIMES), { knifeMin: 0, materialWindingMin: 15 }, 'минуты: смена сырья → 0/15');
assertEqual(planning.setupActivityMinutes(A, knifeOnly, TIMES), { knifeMin: 30, materialWindingMin: 0 }, 'минуты: смена ножей → 30/0');
assertEqual(planning.setupActivityMinutes(A, both, TIMES), { knifeMin: 30, materialWindingMin: 15 }, 'минуты: смена сырья и ножей → 30/15');
assertEqual(planning.setupActivityMinutes(null, A, TIMES), { knifeMin: 0, materialWindingMin: 0 }, 'минуты: нет предыдущей и нет firstCutSetup → 0/0');
assertEqual(planning.setupActivityMinutes(null, A, TIMES, { firstCutSetup: true }), { knifeMin: 30, materialWindingMin: 0 }, 'минуты: первая резка дня (firstCutSetup) → настройка ножей 30/0');

// ── setupActivityColumns: по очереди станка ──
var queue = [cut('A'), cut('C', { materialId: '2' }), cut('D', { materialId: '2', knifeWidths: [100, 300] })];
// Без заправки станка: первая резка — настройка ножей с нуля (firstCutSetup).
assertEqual(planning.setupActivityColumns(queue, TIMES), {
    A: { knifeMin: 30, materialWindingMin: 0 },   // ножи с нуля
    C: { knifeMin: 0, materialWindingMin: 15 },   // A→C: смена сырья
    D: { knifeMin: 30, materialWindingMin: 0 }    // C→D: только ножи (сырьё то же '2')
}, 'колонки: очередь без заправки станка');

// С известной заправкой станка (carryPrevCut совпадает с A) → первая резка 0/0.
var carry = { materialId: '1', winding: 'IN', batchId: 'b1', knifeWidths: [100, 200], knifeCount: 2, rollerWidth: 0 };
assertEqual(planning.setupActivityColumns(queue, TIMES, carry), {
    A: { knifeMin: 0, materialWindingMin: 0 },    // совпадает с заправкой
    C: { knifeMin: 0, materialWindingMin: 15 },
    D: { knifeMin: 30, materialWindingMin: 0 }
}, 'колонки: очередь от заправки станка (carryPrevCut)');

// ── gantt.rowsToCuts: чтение хранимых колонок ──
var gcuts = gantt.rowsToCuts([
    { cut_id: '10', cut_slitter_id: '1', cut_sequence: '1', cut_knife_setup_min: '30', cut_material_winding_min: '0' },
    { cut_id: '11', cut_slitter_id: '1', cut_sequence: '2' }   // колонок нет → null
]);
assertEqual([gcuts[0].storedKnifeMin, gcuts[0].storedMaterialMin], [30, 0], 'rowsToCuts: хранимые колонки прочитаны (30/0, ноль ≠ пусто)');
assertEqual([gcuts[1].storedKnifeMin, gcuts[1].storedMaterialMin], [null, null], 'rowsToCuts: нет колонок → null/null');

// ── gantt.attachSetupMinutes: предпочтение хранимых значений ──
function gcut(id, seq, materialId, stored) {
    return {
        id: id, slitter: { id: 's1' }, sequence: seq, materialId: materialId, winding: 'IN',
        knifeWidths: [100], knifeCount: 1, rollerWidth: 0,
        storedKnifeMin: stored ? stored.k : null, storedMaterialMin: stored ? stored.m : null
    };
}
var gq = [
    gcut('1', 1, 'm1', { k: 7, m: 3 }),   // хранимые нестандартные минуты
    gcut('2', 2, 'm2', null),             // не сохранено → пересчёт от предыдущей (смена сырья m1→m2)
    gcut('3', 3, 'm3', { k: 0, m: 0 })    // сохранённый 0 — НЕ пересчитываем (смена сырья проигнорирована)
];
gantt.attachSetupMinutes(gq, TIMES, {});
assertEqual([gq[0].setupKnifeMin, gq[0].setupMaterialMin], [7, 3], 'attachSetupMinutes: хранимые минуты использованы как есть');
assertEqual([gq[1].setupKnifeMin, gq[1].setupMaterialMin], [0, 15], 'attachSetupMinutes: без хранимых → пересчёт (смена сырья 15)');
assertEqual([gq[2].setupKnifeMin, gq[2].setupMaterialMin], [0, 0], 'attachSetupMinutes: сохранённый 0 уважается (не пересчитываем)');

console.log('\n' + passed + ' assertions passed');
