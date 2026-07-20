// #4292 — при удалении задания с продолжением в следующем дне продолжение теряло
// обеспечение/заказ и висело «нет связей» в ОТХОДЫ. Причина: кнопка «🗑» сносила ТОЛЬКО
// кликнутую запись + её обеспечения, а записи-продолжения дробления по дням (одна логическая
// резка) оставались; автогенерация их НЕ чистит (проходы>0 → planCutOperations сносит лишь
// setup-only-мусор с 0 проходов). Фикс: удаление любого звена сносит ВСЮ цепочку дробления.
//
// Здесь покрываем ЧИСТЫЙ помощник chainRecordIdsForCut(cuts, cutId) — он даёт список id всех
// записей цепочки (голова + продолжения), который delete-путь сносит целиком.
//
// Run with: node experiments/atex-production-planning-4292.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var chain = planning.chainRecordIdsForCut;

var passed = 0, total = 0;
function eq(actual, expected, name) {
    total++;
    var ok = JSON.stringify((actual || []).slice().sort()) === JSON.stringify((expected || []).slice().sort());
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  ожидалось (без порядка):', JSON.stringify(expected), '\n  получено: ', JSON.stringify(actual)); process.exitCode = 1; }
}
function cut(id, o) {
    o = o || {};
    return { id: id, firstPartId: o.fp != null ? o.fp : id, planDate: String(o.day || 100),
             slitter: { id: o.m || 'm1' }, materialId: o.mat || 'MW308', winding: o.w || 'OUT',
             knifeWidths: o.kw || [59], knifeCount: (o.kw || [59]).length, rollerWidth: 0,
             orderId: o.ord != null ? o.ord : 'O1', plannedRuns: o.runs != null ? o.runs : 48 };
}

// ── Явная цепочка (firstPartId): голова H (день1) + продолжение C (день2) ──────────────────────────
(function () {
    var cuts = [cut('H', { fp: 'H', day: 100, runs: 48 }), cut('C', { fp: 'H', day: 200, runs: 47 })];
    eq(chain(cuts, 'H'), ['H', 'C'], '#4292: удаление ГОЛОВЫ H → сносит и продолжение C (вся цепочка)');
    eq(chain(cuts, 'C'), ['H', 'C'], '#4292: удаление ПРОДОЛЖЕНИЯ C → сносит и голову H (одна логическая резка)');
})();

// ── Цепочка из 3 частей (H → C1 → C2) ─────────────────────────────────────────────────────────────
(function () {
    var cuts = [cut('H', { fp: 'H', day: 100 }), cut('C1', { fp: 'H', day: 200 }), cut('C2', { fp: 'H', day: 300 })];
    eq(chain(cuts, 'C1'), ['H', 'C1', 'C2'], '#4292: клик по средней части → вся цепочка из 3 записей');
})();

// ── Одиночная резка (не дроблённая) — только она ───────────────────────────────────────────────────
(function () {
    var cuts = [cut('H', { fp: 'H' }), cut('C', { fp: 'H', day: 200 }), cut('Z', { fp: 'Z', m: 'm2', mat: 'B', w: 'IN' })];
    eq(chain(cuts, 'Z'), ['Z'], '#4292: одиночная резка Z → только [Z] (чужую цепочку не трогаем)');
})();

// ── Легаси-цепочка (без firstPartId): та же сигнатура, смежные дни, один заказ ──────────────────────
(function () {
    var d1 = 1784600000, d2 = d1 + 86400;   // 10-значные unix-секунды, смежные календарные дни
    var cuts = [
        { id: 'L1', firstPartId: '', planDate: String(d1), slitter: { id: 'm1' }, materialId: 'MW308', winding: 'OUT', knifeWidths: [59], knifeCount: 1, rollerWidth: 0, orderId: 'O9', plannedRuns: 48 },
        { id: 'L2', firstPartId: '', planDate: String(d2), slitter: { id: 'm1' }, materialId: 'MW308', winding: 'OUT', knifeWidths: [59], knifeCount: 1, rollerWidth: 0, orderId: 'O9', plannedRuns: 47 }
    ];
    eq(chain(cuts, 'L1'), ['L1', 'L2'], '#4292: легаси-цепочка (сигнатура+смежные дни+заказ) сносится целиком');
})();

// ── Устойчивость к мусору ───────────────────────────────────────────────────────────────────────
(function () {
    eq(chain([], 'H'), ['H'], '#4292: пустой список резок → [cutId] (сносим хотя бы кликнутую)');
    eq(chain([cut('H', { fp: 'H' })], 'X'), ['X'], '#4292: неизвестный id → [id] (defensive)');
    eq(chain(null, ''), [], '#4292: пустой cutId → [] (нечего удалять)');
})();

console.log('\n' + passed + '/' + total + ' passed');
