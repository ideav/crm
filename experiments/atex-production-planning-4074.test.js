// Unit tests for #4074 — ручной перенос 🗓 пересобирает план ПО СРОКАМ и не создаёт просрочку.
//
// Дефект: moveCutToDay завершался autoSequenceQueue(preserveOrder=true). preserveOrder ⇒
// deadlineAware=false: упаковщик паковал всё от «С» вперёд, ИГНОРИРУЯ сроки, и задания уезжали за
// срок («перенос с несоблюдением сроков», появлялись просроченные задания — issue #4074).
//
// Фикс: перенос пересобирает план ПО СРОКАМ (preserveOrder=false, deadlineAware — как «Упорядочить»),
// а перенесённое задание ЗАКРЕПЛЯЕТСЯ на выбранном дне (moveScope.pinCutIds → временный c.fixed=«замок
// дня» в buildSequenceOps). Остальное раскладывается по срокам вокруг него.
//
// Run with: node experiments/atex-production-planning-4074.test.js

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Часть 1: planCutOperations — по срокам (preserveOrder=false) vs слепо (preserveOrder=true) ────
var BASE = new Date('2026-06-23T00:00:00').getTime();
function ecut(id, opts) {
    opts = opts || {};
    return { id: id, slitter: { id: 'm1' }, materialId: opts.material || 'M1', winding: 'OUT',
             knifeWidths: opts.knives || [50, 50], knifeCount: (opts.knives || [50, 50]).length,
             rollerWidth: 0, plannedRuns: opts.runs == null ? 1 : opts.runs, isFoil: !!opts.foil,
             length: opts.length == null ? 100 : opts.length,
             planDate: opts.day == null ? '' : String(Math.floor((BASE + opts.day * 86400000) / 1000) + 480 * 60),
             status: '', fixed: !!opts.fixed };
}
function runPCO(cuts, preserveOrder, dueDayByCut, dayAnchorByCut) {
    var perPass = {};
    cuts.forEach(function (c) { perPass[c.id] = 100; });   // 100 мин/проход
    return planning.planCutOperations(cuts, {
        weights: planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }),
        times: { BETWEEN_CUTS: 0 },
        dayStartMin: 0, dayEndMin: 120, dayEndHourMin: 120,
        perPassByCut: perPass, planBaseMidnightMs: BASE,
        preserveOrder: preserveOrder, dayAnchorByCut: dayAnchorByCut || {},
        dueDayByCut: dueDayByCut || {}, gapFill: true
    });
}
function opDay(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    if (!u) return null;
    return Math.round((Number(u.planStartTs) * 1000 - BASE) / 86400000);
}

// U — срок day1 (срочное), в очереди ПОСЛЕДНЕЕ; B1/B2 — срок day8 (поздние). Одна резка на день (120 мин).
var U = ecut('U'), B1 = ecut('B1'), B2 = ecut('B2');
var due = { U: 1, B1: 8, B2: 8 };
var input = [B1, B2, U];   // U последним — как в очереди при переносе

var blind = runPCO(input, true, due);        // старое поведение (preserveOrder, deadlineAware выкл)
var byDue = runPCO(input, false, due);       // фикс #4074 (preserveOrder=false, deadlineAware вкл)

assert(opDay(blind, 'U') > 1,
    '#4074 репро: слепая (preserveOrder) пересборка гонит срочное U за срок (день ' + opDay(blind, 'U') + ' > 1)');
assert(opDay(byDue, 'U') <= 1,
    '#4074 фикс: пересборка ПО СРОКАМ ставит срочное U в срок (день ' + opDay(byDue, 'U') + ' ≤ 1)');

// ── Часть 2: закрепление перенесённого задания (fixed=замок дня) при пересборке по срокам ─────────
// F закреплено на day2 (fixed + якорь day2). По срокам вокруг — но F остаётся на day2.
var F = ecut('F', { fixed: true, day: 2, foil: true, length: 305 });
var U2 = ecut('U2'), B3 = ecut('B3');
var due2 = { F: 5, U2: 1, B3: 8 };
var pinned = runPCO([B3, U2, F], false, due2, { F: 2 });
assert(opDay(pinned, 'F') === 2,
    '#4074: закреплённое (fixed) перенесённое задание F держит выбранный день 2');
assert(opDay(pinned, 'U2') <= 1,
    '#4074: срочное U2 при этом всё равно ставится в срок (день ' + opDay(pinned, 'U2') + ' ≤ 1)');

// ── Часть 3: buildSequenceOps wiring — moveScope.pinCutIds закрепляет и СНИМАЕТ временный c.fixed ──
function fakeSelf(cuts) {
    return {
        cuts: cuts, changeTimes: { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 }, daySettings: {},
        opTimes: { WIND_100: 20, WIND_FOIL_305: 4 }, filter: { date: '2026-06-23' },
        supplies: [], footageBySupply: {}, genPositions: [],
        nowMs: function () { return BASE; },
        workingWindow: Controller.prototype.workingWindow,   // реальный (читает daySettings/changeTimes)
        planningPrevSetupBySlitter: function () { return {}; },
        blockedRangesBySlitter: function () { return {}; }
    };
}
function mcut(id, day, foil) {
    // distinct orderId — иначе смежные дни одной конфигурации склеиваются в цепочку (легаси #3280)
    return { id: id, orderId: 'O_' + id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT', knifeWidths: [50, 50],
             knifeCount: 2, rollerWidth: 0, plannedRuns: foil ? 30 : 4, isFoil: !!foil, length: foil ? 305 : 100,
             planDate: String(Math.floor((BASE + day * 86400000) / 1000) + 480 * 60), status: '', fixed: false };
}
var mCuts = [mcut('a', 0), mcut('b', 1), mcut('foil', 2, true)];
var selfM = fakeSelf(mCuts);
var built = Controller.prototype.buildSequenceOps.call(selfM, mCuts, 'SETUP', false, { pinCutIds: ['foil'] });
var movedDay = (function () {
    var u = built.ops.updates.filter(function (x) { return String(x.cutId) === 'foil'; })[0];
    return u ? Math.round((Number(u.planStartTs) * 1000 - BASE) / 86400000) : null;
})();
assert(movedDay === 2,
    '#4074 wiring: закреплённая фольга удержана на своём дне 2 при пересборке по срокам');
assert(mCuts.every(function (c) { return c.fixed === false; }),
    '#4074 wiring: временный c.fixed снят после buildSequenceOps (self.cuts не мутированы)');
// Без pinCutIds фольга свободна — deadlineAware может поставить её иначе (контроль: замок именно от pin).
var mCuts2 = [mcut('a', 0), mcut('b', 1), mcut('foil', 2, true)];
var built2 = Controller.prototype.buildSequenceOps.call(fakeSelf(mCuts2), mCuts2, 'SETUP', false, null);
assert(mCuts2.every(function (c) { return c.fixed === false; }),
    '#4074 wiring: без moveScope c.fixed не мутируется вовсе');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
