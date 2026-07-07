// Тесты #4085 (Стадия 4) — врезка слоя размещения в planCutOperations (gated opts.slotPlacement).
//
// В слот-режиме planCutOperations выбирает СТАНОК + порядок перебором точек вставки (computeSlotPlacement),
// пакует с orderAuthoritative, без резерва #4068; в ops.updates приходит slitterId (назначение станка).
// Дефолт (без флага) — путь не тронут (контракт ops прежний; существующие тесты зелёные).
//
// Run with: node experiments/atex-production-planning-4085-slotplacement-wiring.test.js

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

function cut(id, o) {
    o = o || {};
    return { id: id, slitter: { id: o.m || 'm1' }, materialId: o.mat || 'M1', winding: 'OUT',
             knifeWidths: o.kw || [50], knifeCount: (o.kw || [50]).length, rollerWidth: 0,
             plannedRuns: o.runs || 3, isFoil: !!o.foil };
}
var BASE = 1780963200000;
function opts(extra) {
    var o = { perPassByCut: {}, dayStartMin: 0, dayEndMin: 1000, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
              planBaseMidnightMs: BASE, gapFill: true };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}
function slitterOf(ops, id) { var r = null; ops.updates.forEach(function (u) { if (u.cutId === id) r = u.slitterId; }); return r; }
function orderOn(ops, sid) {
    return ops.updates.filter(function (u) { return u.slitterId === sid; })
        .sort(function (a, b) { return a.sequence - b.sequence; }).map(function (u) { return u.cutId; });
}

// ── 1) Слот-режим: другое сырьё уходит на пустой станок (мин. штраф), одинаковое группируется ─────
// A,B (сырьё M1), C (сырьё M2) — все во входе на m1. slitterIds [m1,m2]. Перебор: A,B дешевле на m1
// (переналадки 0), C на m1 стоил бы MATERIAL_CHANGE 15, а на пустом m2 — 0 → C уходит на m2.
(function () {
    var cuts = [cut('A', { mat: 'M1' }), cut('B', { mat: 'M1' }), cut('C', { mat: 'M2' })];
    var pp = { A: 10, B: 10, C: 10 };
    var ops = planning.planCutOperations(cuts, opts({ slotPlacement: true, perPassByCut: pp, slitterIds: ['m1', 'm2'] }));
    assert(slitterOf(ops, 'A') === 'm1' && slitterOf(ops, 'B') === 'm1', '#4085 wiring: одинаковое сырьё A,B сгруппировано на m1');
    assert(slitterOf(ops, 'C') === 'm2', '#4085 wiring: другое сырьё C уходит на пустой m2 (переналадка дешевле) — РЕАЛЬНОЕ переназначение станка');
    assert(JSON.stringify(orderOn(ops, 'm1')) === JSON.stringify(['A', 'B']), '#4085 wiring: порядок на m1 = входной A,B (append при равной цене)');
})();

// ── 2) Слот-режим: фольга уводится в конец дня ШТРАФОМ FOIL_NOTEND (#3717 через штраф, не жёсткое правило) ──
// Один станок, вход [F(фольга,M1), A(M1)]. Нефольга размещается первой, затем фольга — штраф «не последняя»
// уводит F в конец → порядок A,F (не жёстким orderCuts-правилом, а стоимостью размещения #3985).
(function () {
    var cuts = [cut('F', { mat: 'M1', foil: true }), cut('A', { mat: 'M1' })];
    var pp = { F: 10, A: 10 };
    var ops = planning.planCutOperations(cuts, opts({ slotPlacement: true, perPassByCut: pp, slitterIds: ['m1'] }));
    assert(JSON.stringify(orderOn(ops, 'm1')) === JSON.stringify(['A', 'F']),
        '#4085 wiring: фольга уводится в конец штрафом FOIL_NOTEND (порядок A,F — инвариант #3717 через штраф)');
})();

// ── 3) Дефолт (без slotPlacement): контракт ops прежний — slitterId отсутствует ──────────────────
(function () {
    var cuts = [cut('A'), cut('B')];
    var ops = planning.planCutOperations(cuts, opts({ perPassByCut: { A: 10, B: 10 }, preserveOrder: true }));
    var hasSlitter = ops.updates.some(function (u) { return 'slitterId' in u && u.slitterId !== undefined; });
    assert(!hasSlitter, '#4085 wiring: без флага slotPlacement — slitterId в ops НЕ появляется (контракт не изменён)');
})();

console.log('\n' + passed + '/' + total + ' passed');
