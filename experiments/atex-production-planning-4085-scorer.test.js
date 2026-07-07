// Тесты #4085 (Стадия 1) — ЧИСТЫЙ scorer стоимости вставки (ТЗ §8).
//
// Покрывает transitionCost/insertionCost по каждому фактору §8 (ножи change/increase + «качество»,
// сырьё, лидер, фольга, срок DEADLINE/EXACT/раньше, простой), исключение freeAfterCarry, веса из
// «Настройки», и хелпер dayKeyFromOffset (индекс дня → YYYYMMDD для placementDayKey).
//
// Run with: node experiments/atex-production-planning-4085-scorer.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var tc = planning.transitionCost, ic = planning.insertionCost, dkfo = planning.dayKeyFromOffset;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function slot(o) {
    o = o || {};
    return { id: o.id || 'c', knifeWidths: o.kw || [50], knifeCount: o.kc != null ? o.kc : (o.kw || [50]).length,
             rollerWidth: o.rw || 0, materialId: o.mat || 'M1', winding: o.w || 'OUT', batchId: o.b,
             leader: o.leader, sleeveId: o.sleeve, isFoil: !!o.foil, dueKey: o.dueKey };
}

// ── §8.3 «качество» перехода: prev 110×3,60×5,40×10 → next 110×3,60×5,30×13 = 3/2 ────────────────
var prevQ = slot({ kw: [110, 60, 40], kc: 18, mat: 'X' });
var nextQ = slot({ kw: [110, 60, 30], kc: 21, mat: 'X' });   // полос больше (18→21) → KNIVES_INCREASE
var q = tc(prevQ, nextQ, { settings: {} });
assert(q.byFactor.knifeQuality === 1.5, '#4085 §8.3: «качество» ножей 110/60/(40→30) = 3/2 = 1.5 (совпали 2 из 3 с начала)');
assert(q.byFactor.knife === 50, '#4085 §8.1: полос стало больше (18→21) → KNIVES_INCREASE_COST_MN = 50');
assert(q.byFactor.material == null, '#4085: сырьё то же (X) → без штрафа смены сырья');
assert(q.weight === 50, '#4085: суммарный вес перехода = 50 (только ножи)');

// ── Ножи: полос стало МЕНЬШЕ → KNIVES_CHANGE (30) ───────────────────────────────────────────────
var dec = tc(slot({ kw: [110, 60, 30], kc: 21 }), slot({ kw: [110, 60, 40], kc: 18 }), { settings: {} });
assert(dec.byFactor.knife === 30, '#4085 §8.1: полос стало меньше (21→18) → KNIVES_CHANGE_COST_MN = 30');

// ── Смена сырья/намотки → MATERIAL_CHANGE (15) ──────────────────────────────────────────────────
var mat = tc(slot({ mat: 'X' }), slot({ mat: 'Y' }), { settings: {} });
assert(mat.byFactor.material === 15 && mat.byFactor.knife == null, '#4085 §8.2: другое сырьё X→Y → MATERIAL_CHANGE_COST_MN = 15, ножи не тронуты');

// ── Лидер/втулка → LEADER_COST_MN (2) ───────────────────────────────────────────────────────────
var lead = tc(slot({ sleeve: '76' }), slot({ sleeve: '152' }), { settings: {} });
assert(lead.byFactor.leader === 2, '#4085 §8.3: сменилась втулка → LEADER_COST_MN = 2');

// ── Фольга не в конце дня → FOIL_NOTEND (60) ─────────────────────────────────────────────────────
var foil = tc(slot(), slot({ foil: true }), { settings: {}, foilNotEnd: true });
assert(foil.byFactor.foilNotEnd === 60, '#4085 §8.2а: фольга не в конце дня → FOIL_NOTEND_COST_MN = 60');

// ── Срок: день размещения ПОЗЖЕ / РАВЕН / РАНЬШЕ ─────────────────────────────────────────────────
var late = tc(slot(), slot({ dueKey: 20260701 }), { settings: {}, placementDayKey: 20260702 });
assert(late.byFactor.deadline === 100 && late.byFactor.exactDeadline == null, '#4085 §8 п.4: день > срока → DEADLINE_COST_MN = 100');
var exact = tc(slot(), slot({ dueKey: 20260701 }), { settings: {}, placementDayKey: 20260701 });
assert(exact.byFactor.exactDeadline === 33 && exact.byFactor.deadline == null, '#4085 §8 п.5: день = сроку → EXACT_DEADLINE_COST_MN = 33 (НОВОЕ)');
var early = tc(slot(), slot({ dueKey: 20260701 }), { settings: {}, placementDayKey: 20260630 });
assert(early.byFactor.deadline == null && early.byFactor.exactDeadline == null, '#4085 §8: день < срока (раньше) → без штрафа срока');

// ── Простой между станками → MAX_DISTANCE (25) ──────────────────────────────────────────────────
var dist = tc(slot(), slot(), { settings: {}, distanceExceeded: true });
assert(dist.byFactor.distance === 25, '#4085 §8 п.6: простой > MAX_SLOTS_DISTANCE_HR → MAX_DISTANCE_COST_MN = 25');

// ── Исключение: переход после «хвоста» прошлого дня — смена бесплатна ────────────────────────────
var carry = tc(slot({ kw: [50], mat: 'X' }), slot({ kw: [30, 20], mat: 'Y' }), { settings: {}, freeAfterCarry: true });
assert(carry.weight === 0, '#4085 §8 искл.: freeAfterCarry — смена ножей/сырья не штрафуется (вес 0)');

// ── Веса переопределяются «Настройкой» ──────────────────────────────────────────────────────────
var custom = tc(slot(), slot({ dueKey: 20260701 }), { settings: { DEADLINE_COST_MN: 200 }, placementDayKey: 20260702 });
assert(custom.byFactor.deadline === 200, '#4085 §14: DEADLINE_COST_MN из «Настройки» (200) переопределяет дефолт 100');

// ── insertionCost = сумма двух переходов prev→slot и slot→next ───────────────────────────────────
var A = slot({ id: 'A', mat: 'X' }), B = slot({ id: 'B', mat: 'Y' }), C = slot({ id: 'C', mat: 'Z' });
var ins = ic(A, B, C, { settings: {} }, { settings: {} });
assert(ins.weight === 30 && ins.before.weight === 15 && ins.after.weight === 15,
    '#4085 §8.1: insertionCost = 15 (A→B) + 15 (B→C) = 30');

// ── dayKeyFromOffset: индекс дня от базы «С» → YYYYMMDD ──────────────────────────────────────────
var base = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();   // 01.07.2026 полночь
assert(dkfo(base, 0) === 20260701, '#4085: dayKeyFromOffset(base,0) = 20260701');
assert(dkfo(base, 1) === 20260702, '#4085: dayKeyFromOffset(base,1) = 20260702');
assert(dkfo(base, 30) === 20260731, '#4085: dayKeyFromOffset(base,30) = 20260731 (конец июля)');
assert(dkfo(base, 31) === 20260801, '#4085: dayKeyFromOffset(base,31) = 20260801 (перескок месяца)');
assert(dkfo('x', 1) === null, '#4085: dayKeyFromOffset при невалидной базе → null');

console.log('\n' + passed + '/' + total + ' passed');
