// #4326 (Вариант A) — «замок дня» (заморозка) ПИНит существующие задания дня, но НЕ блокирует день.
//
// Прежняя реализация (Вариант B, откачена #4339) блокировала замороженный день целиком и исключала
// его задания из входа. Когда заморожен день = СРОК заданий, срочные задания не могли встать на свой
// срок-день → уходили за срок = ПРОСРОЧКА (#4338). Вариант A: замороженные задания лишь ПРИКАЛЫВАЮТСЯ
// (временный c.fixed, planCutOperations держит их день), день НЕ блокируется — срочные задания
// по-прежнему могут туда встать. Просрочки заморозка не создаёт.
//
// Здесь проверяем ИНВАРИАНТ на чистом planCutOperations (как #4074/#4200/#4312 повторяют glue
// контроллера): (1) приколотое задание держит свой день; (2) СВОБОДНОЕ задание сроком день-1 встаёт
// В СРОК (≤ день-1), даже когда на дне-1 стоит приколотое (замороженное) задание.
//
// Run with: node experiments/atex-production-planning-4326.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date('2026-07-21T00:00:00').getTime();   // день 0 = 21.07
function ymd(dayoff) { var d = new Date(BASE + dayoff * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function ecut(id, dayoff, o) {
    o = o || {};
    return { id: id, slitter: { id: 'm1' }, materialId: o.material || 'M1', winding: 'OUT',
             knifeWidths: o.knives || [50, 50], knifeCount: (o.knives || [50, 50]).length,
             rollerWidth: 0, plannedRuns: o.runs == null ? 1 : o.runs, isFoil: false, length: o.length == null ? 100 : o.length,
             planDate: dayoff == null ? '' : String(Math.floor((BASE + dayoff * 86400000) / 1000) + 480 * 60),
             status: '', fixed: !!o.fixed };
}

// planCutOperations по образцу #4074: слот-путь (сроки соблюдаются локальным штрафом слоя размещения).
function runPCO(cuts, dueDayByCut, dayAnchorByCut) {
    var perPass = {}; cuts.forEach(function (c) { perPass[c.id] = 60; });   // 60 мин/проход
    var dueKey = {}; Object.keys(dueDayByCut || {}).forEach(function (id) { dueKey[id] = ymd(dueDayByCut[id]); });
    return planning.planCutOperations(cuts, {
        weights: planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }), times: { BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 960, dayEndHourMin: 960, planBaseMidnightMs: BASE,
        perPassByCut: perPass, preserveOrder: false, gapFill: true, firstCutSetup: true,
        dayAnchorByCut: dayAnchorByCut || {}, dueDayByCut: dueDayByCut || {}, dueKeyByCut: dueKey,
        slotPlacement: true, slitterIds: ['m1'], intraDayResequence: false
    });
}
function placedDay(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === String(id); })[0];
    if (!u) return null;
    return Math.floor((Number(u.planStartTs) * 1000 - BASE) / 86400000);
}

// ── (1) приколотое (замороженное) задание держит свой день ────────────────────────────────────────
(function () {
    // E приколото на день 1 (заморожен): fixed + dayAnchor=1. N — свободное, срок день 3.
    var E = ecut('E', 1, { fixed: true, runs: 2 });
    var N = ecut('N', null, { runs: 2 });   // без «Даты план» — свободное
    var ops = runPCO([E, N], { E: 1, N: 3 }, { E: 1 });
    assert(placedDay(ops, 'E') === 1, '#4326: приколотое задание замороженного дня держит свой день (день 1)');
})();

// ── (2) ПРОСРОЧКА-инвариант: срочное задание встаёт В СРОК, хотя на его дне стоит приколотое ────────
(function () {
    // На дне 1 (заморожен) приколото E. N — СВОБОДНОЕ со сроком день 1. День НЕ блокируется (Вариант A) →
    // N обязано встать НЕ ПОЗЖЕ дня 1 (в срок). При Варианте B (блок дня) N выкидывало на день 2+ (просрочка).
    var E = ecut('E', 1, { fixed: true, runs: 2 });
    var N = ecut('N', null, { material: 'M2', runs: 2 });
    var ops = runPCO([E, N], { E: 1, N: 1 }, { E: 1 });
    var dN = placedDay(ops, 'N');
    assert(dN != null && dN <= 1,
        '#4326 (инвариант ПРОСРОЧКИ): срочное задание (срок д.1) встаёт ≤ дня 1, хотя на д.1 приколото замороженное — заморозка не создаёт просрочку (получено день ' + dN + ')');
})();

// ── (3) РЕАЛЬНЫЙ сценарий #4338: заморожен день 0 (база «С» = 21.07), срочные задания дня 1 ─────────
(function () {
    // На ateh1 был заморожен день 0 (21.07). Вариант B блокировал день 0 → всё сдвигалось на день+1,
    // и срок-22.07 (день 1) задания вытеснялись за срок. Вариант A: задание дня 0 лишь приколото,
    // день 0 НЕ блокируется → срок-day-1 задание встаёт на день 1 (в срок), без сдвига.
    var Z = ecut('Z', 0, { fixed: true, runs: 1 });          // приколотое замороженное задание дня 0
    var A = ecut('A', null, { material: 'M2', runs: 2 });     // срок день 1
    var ops = runPCO([Z, A], { Z: 0, A: 1 }, { Z: 0 });
    assert(placedDay(ops, 'Z') === 0, '#4326: приколотое задание замороженного дня 0 остаётся на дне 0');
    var dA = placedDay(ops, 'A');
    assert(dA != null && dA <= 1,
        '#4326 (#4338, реальный сценарий): при заморозке дня 0 срочное задание дня 1 НЕ уходит за срок (день ' + dA + ' ≤ 1)');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
