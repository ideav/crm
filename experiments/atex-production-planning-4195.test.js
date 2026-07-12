// Unit tests for #4195 / #4193 — «Упорядочить»/генерация оставляет ПРОСРОЧКУ, хотя слой размещения в
// трассе рапортует «просрочек нет ✓», а панель «Качество плана» показывает «просрочено: N».
//
// КОРЕНЬ (трасса ideav.ru issue #4195, задание 527055 «срок —»): buildSequenceOps строит срок каждой
// резки через cutDueKeys(c, supplies, genPositions) БЕЗ includeSupplyFallback. У резки, чья позиция
// ВЫПАЛА из активного positions_list (genPositions), но срок ЕСТЬ в обеспечении (cut_planning.due_date,
// #4051), планировщик срока НЕ ВИДИТ → dueDayByCut пуст → штраф DEADLINE_COST_MN к ней не применяется →
// она встаёт по переналадке, за своим сроком. Панель countOverdueCuts(..., true) её срок ВИДИТ и
// считает просроченной, оператор видит красную плашку. Отсюда «трасса: просрочек нет» vs «панель: 2».
//
// ФИКС: buildSequenceOps строит dueKeyByCut/dueDayByCut ТЕМ ЖЕ источником срока, что и панель/плашка —
// cutDueKeys(c, self.supplies, self.genPositions, /*includeSupplyFallback*/ true).
//
// Run with: node experiments/atex-production-planning-4195.test.js

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date('2026-06-23T00:00:00').getTime();
function ymd(dayoff) { var d = new Date(BASE + dayoff * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

// ── Часть 1: cutDueKeys — семантика fallback (пример 527055 из issue) ──────────────────────────────
(function () {
    var U = { id: 'U' };
    var supplies = [{ cutId: 'U', positionId: 'P1', dueKey: 20260701 }];
    var genPositions = [];   // позиция P1 выпала из активного positions_list
    var noFallback = planning.cutDueKeys(U, supplies, genPositions);          // как СТРОИТ планировщик (баг)
    var withFallback = planning.cutDueKeys(U, supplies, genPositions, true);  // как считает панель/плашка (#4051)
    assert(noFallback.length === 0,
        '#4195 репро: без fallback планировщик срока НЕ видит (cutDueKeys=[]) — резка «срок —»');
    assert(withFallback.length === 1 && withFallback[0] === 20260701,
        '#4195: с fallback срок берётся из обеспечения (cut_planning.due_date) = 20260701');
})();

// ── Часть 2: buildSequenceOps — резка с fallback-сроком должна встать В СРОК (репро + фикс) ─────────
// Окно 8:00–9:00 (60 мин) ⇒ 1 резка/день. U в очереди первой ⇒ естественно уезжает на последний день
// (day3). Её срок day0 обязан вернуть её на day0. A1..A3 — сроки в АКТИВНЫХ позициях (day8, планировщик
// их видит). Срок U ТОЛЬКО в обеспечении (позиции Pu нет в genPositions).
function fakeSelf(cuts, supplies, genPositions) {
    return {
        cuts: cuts, changeTimes: { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
        daySettings: { SLOT_PLACEMENT: '1', DEADLINE_COST_MN: '200', DAY_START_HOUR: '8:00', DAY_END_HOUR: '9:00' },
        opTimes: { WIND_100: 40 }, filter: { date: '2026-06-23' },
        supplies: supplies || [], footageBySupply: {}, genPositions: genPositions || [],
        slitters: [{ id: 'm1' }],
        nowMs: function () { return BASE; },
        workingWindow: Controller.prototype.workingWindow,
        slotPlacementOn: Controller.prototype.slotPlacementOn,
        dayIsWorking: function () { return true; },
        slitterOnVacationDay: function () { return false; },
        planningPrevSetupBySlitter: function () { return {}; },
        blockedRangesBySlitter: function () { return {}; }
    };
}
function scut(id) {
    return { id: id, orderId: 'O_' + id, slitter: { id: 'm1' }, materialId: 'A', winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: false, length: 100,
             planDate: '', status: '', fixed: false };
}
function dayOf(built, id) {
    var us = (built.ops.updates || []).filter(function (x) { return String(x.cutId) === id; });
    if (!us.length) return null;
    return Math.min.apply(null, us.map(function (u) { return Math.floor((Number(u.planStartTs) * 1000 - BASE) / 86400000); }));
}

var U = scut('U'), A1 = scut('A1'), A2 = scut('A2'), A3 = scut('A3');
var cuts = [U, A1, A2, A3];   // U первой → без срока естественно уезжает на последний день
var genPositions = [{ id: 'Pa1', dueKey: ymd(8) }, { id: 'Pa2', dueKey: ymd(8) }, { id: 'Pa3', dueKey: ymd(8) }];
var supplies = [
    { cutId: 'A1', positionId: 'Pa1', dueKey: ymd(8) },
    { cutId: 'A2', positionId: 'Pa2', dueKey: ymd(8) },
    { cutId: 'A3', positionId: 'Pa3', dueKey: ymd(8) },
    { cutId: 'U',  positionId: 'Pu',  dueKey: ymd(0) }   // Pu НЕ в genPositions → срок ТОЛЬКО через fallback
];
var built = Controller.prototype.buildSequenceOps.call(fakeSelf(cuts, supplies, genPositions), cuts, 'SETUP', false, null);

// Контроль: те же данные, но срок U — в АКТИВНОЙ позиции → планировщик ставит U В СРОК на day0.
var supActive = supplies.slice(0, 3).concat([{ cutId: 'U', positionId: 'Pu2', dueKey: ymd(0) }]);
var gpActive = genPositions.concat([{ id: 'Pu2', dueKey: ymd(0) }]);
var builtActive = Controller.prototype.buildSequenceOps.call(fakeSelf(cuts, supActive, gpActive), cuts, 'SETUP', false, null);
assert(dayOf(builtActive, 'U') <= 0,
    '#4195 контроль: когда срок U в АКТИВНОЙ позиции — планировщик ставит U В СРОК (day ' + dayOf(builtActive, 'U') + ' ≤ 0)');

// ГЛАВНОЕ: срок U только в обеспечении (fallback). До фикса U уезжает за срок (day3), после — day0.
assert(dayOf(built, 'U') <= 0,
    '#4195 фикс: срок из обеспечения (позиция вне positions_list) виден планировщику — U В СРОК (day ' + dayOf(built, 'U') + ' ≤ 0)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
