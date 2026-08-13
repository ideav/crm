// #4743 — «ПОЧЕМУ ДНИ НЕ НАБИТЫ?»: ПОТОЛОК ДНЯ РАБОТАЕТ В ОБЕ СТОРОНЫ.
//
// СИМПТОМ (боевое 13.08.2026, ateh1, бандл .146): после «Урегулировать» Чт 13.08 держит 306 минут
// при потолке 455, а РМ отвечает «День не набит до конца: смен, не набитых до потолка, — 2.
// Недостающая работа стои́т в следующем дне — нажмите „Упорядочить“, чтобы затянуть её сюда».
//
// ПРИЧИНА — ДВЕ, И ОБЕ НАДО СНЯТЬ:
//   1. ПОЛ ПАРОВОЗА. #4732 запретил ставить задание в день РАНЬШЕ ХРАНИМОГО. Пол оказался шире
//      своей цели: он запирал каждое задание в его собственном дне, и работа следующего дня не
//      спускалась в недобранный НИКОГДА. Защищал же #4732 не «хранимый день», а день, который
//      станок УЖЕ ОТРАБОТАЛ (боевое #4732: остатки уехали из 13.08 обратно в начатый 12.08 и
//      встали МЕЖДУ выполненными). Теперь пол сказан прямо: не ниже последнего отработанного дня.
//   2. ВХОД В ВЫРАВНИВАНИЕ. Хвост записи запускался только на ПЕРЕПОЛНЕННОМ дне; недобранный день
//      не трогал никто. DAY_FILL (#4469) — правило той же твёрдости, что и потолок (#4467).
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: пол «не раньше хранимого дня» недобранный день добить не даёт;
//   B — пол «не ниже отработанного дня» — работа следующего дня спускается и день добирается;
//   C — в ОТРАБОТАННЫЙ день паровоз назад НЕ спускается (регрессия #4732);
//   D — порядок очереди при этом не меняется;
//   E — проводка: «Урегулировать» зовёт выравнивание и когда день НЕДОбран, а не только переполнен;
//   F — мерка недобора у выравнивания и у предупреждения ОДНА (чиним то, о чём говорим).
//
// Run with: node experiments/atex-pp-4743-settle-fills-days.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 7, 13, 0, 0, 0, 0).getTime();   // Чт 13.08.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;
var DAY = 86400, CAP = 450, SID = '1279';

function widths(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cut(id, o) {
    return { id: id, slitter: { id: o.sid || SID }, materialId: o.mat || 'MW308', winding: 'OUT',
             batchId: 'B' + (o.mat || 'MW308'), knifeWidths: widths(59, 10), knifeCount: 10,
             rollerWidth: 60, plannedRuns: o.runs, isFoil: false, status: '', fixed: !!o.fixed,
             firstPartId: id, startDate: o.startDate || '', endDate: o.endDate || '',
             planDate: String(D0 + o.day * DAY + (o.min || 0) * 60) };
}

// Раскладка теми же параметрами, какими её зовёт выравнивание дня (preserveOrder + trainOnly).
function pack(cuts, opts) {
    var pp = {}, anchor = {}, due = {};
    cuts.forEach(function (c) {
        pp[String(c.id)] = 10;                                // 10 мин на проход
        due[String(c.id)] = 30;
        anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 480 + CAP, dayEndHourMin: 480 + CAP,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: true, trainOnly: true, slotPlacement: false, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: pp,
        slitterIds: [SID], dueDayByCut: due, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (opts || {})) o[k] = opts[k];
    var ops = P.planCutOperations(cuts, o);
    var placed = [];
    (ops.updates || []).forEach(function (u) {
        placed.push({ id: String(u.cutId), ts: Number(u.planStartTs), runs: Number(u.plannedRuns), isNew: false });
    });
    (ops.creates || []).forEach(function (cr) {
        placed.push({ id: String(cr.parentCutId), ts: Number(cr.planStartTs), runs: Number(cr.plannedRuns), isNew: true });
    });
    placed.sort(function (a, b) { return a.ts - b.ts; });
    placed.forEach(function (p) { p.day = Math.floor((p.ts * 1000 - BASE) / 86400000); });
    return { ops: ops, placed: placed,
             minutesIn: function (d) {
                 var m = 0;
                 placed.forEach(function (p) { if (p.day === d) m += p.runs * 10; });
                 return m;
             },
             dayOf: function (id) {
                 var own = placed.filter(function (p) { return p.id === String(id) && !p.isNew; })[0];
                 return own ? own.day : null;
             },
             order: placed.filter(function (p) { return !p.isNew; }).map(function (p) { return p.id; }) };
}

// ── A/B/D. НЕДОБРАННЫЙ ДЕНЬ ДОБИРАЕТСЯ РАБОТОЙ СЛЕДУЮЩЕГО ──────────────────────────────────
// День 0: 100 мин работы при потолке 410 (450 − обед). День 1: задание на 20 проходов = 200 мин.
// Часть проходов обязана спуститься в день 0 — там свободно больше трёхсот минут.
function halfEmptyDay() {
    return [
        cut('d0', { day: 0, min: 0, runs: 10 }),                 // 30 ножи + 100 = 130 мин
        cut('d1', { day: 1, min: 0, runs: 20, mat: 'MW308' })    // та же конфигурация — переналадки нет
    ];
}
var storedFloor = pack(halfEmptyDay());   // без предиката — пол «не раньше хранимого дня» (#4732)
assert(storedFloor.minutesIn(1) === 200 && storedFloor.minutesIn(0) === 100,
    'A. воспроизведение: пол «не раньше хранимого дня» держит работу в её дне — день 0 остаётся полупустым',
    'день 0: ' + storedFloor.minutesIn(0) + ' мин, день 1: ' + storedFloor.minutesIn(1));

var nothingWorked = pack(halfEmptyDay(), { workedDayForSlitter: function () { return function () { return false; }; } });
assert(nothingWorked.minutesIn(0) > 100,
    'B. пол «не ниже отработанного дня»: работа следующего дня спускается в недобранный',
    'день 0: ' + nothingWorked.minutesIn(0) + ' мин, день 1: ' + nothingWorked.minutesIn(1));
assert(nothingWorked.minutesIn(0) + nothingWorked.minutesIn(1) === 300,
    'B2. работа не теряется и не удваивается: сумма проходов та же',
    'итого: ' + (nothingWorked.minutesIn(0) + nothingWorked.minutesIn(1)) + ' мин');
assert(nothingWorked.order.join(',') === 'd0,d1',
    'D. порядок очереди не меняется — паровоз двигает, а не пересобирает',
    'получилось: ' + nothingWorked.order.join(','));

// ── C. В ОТРАБОТАННЫЙ ДЕНЬ НАЗАД НЕ СПУСКАЕМСЯ (регрессия #4732) ───────────────────────────
// День 0 станок ОТРАБОТАЛ (смена закрыта / день прошёл / он кончается сделанной работой).
var day0Worked = pack(halfEmptyDay(), {
    workedDayForSlitter: function () { return function (d) { return d === 0; }; }
});
assert(day0Worked.minutesIn(0) === 100 && day0Worked.dayOf('d1') === 1,
    'C. отработанный день назад не добираем — работа остаётся в своём дне (#4732 цел)',
    'день 0: ' + day0Worked.minutesIn(0) + ' мин, день d1 = ' + day0Worked.dayOf('d1'));

// Начатое/выполненное задание в хвосте дня — тот же случай, и его считает контроллер (#4740).
var startedTail = [
    cut('s0', { day: 0, min: 0, runs: 10, startDate: String(D0) }),
    cut('s1', { day: 1, min: 0, runs: 20 })
];
var startedSelf = Object.create(Controller.prototype);
startedSelf.cuts = startedTail;
startedSelf.nowMs = function () { return BASE + 9 * 3600000; };
startedSelf.shiftClosedSlittersToday = function () { return {}; };
var workedFn = startedSelf.dayIsWorkedOutFn(SID, BASE);
assert(workedFn(0) === true && workedFn(1) === false,
    'C2. «день кончается НАЧАТОЙ работой» — тот же предикат, что у мерки недобора (#4740)',
    'день 0: ' + workedFn(0) + ', день 1: ' + workedFn(1));

// ── E/F. ПРОВОДКА: ВЫРАВНИВАНИЕ ЗАПУСКАЕТСЯ И НА НЕДОБРАННОМ ДНЕ ───────────────────────────
var levelSeen = null;
var lvl = Object.create(Controller.prototype);
lvl.filter = { date: '2026-08-13' };
lvl.nowMs = function () { return BASE; };
lvl.cuts = [];
lvl.overfilledDaysOf = function () { return []; };            // переполнения НЕТ
lvl.plannerUnderfilledDays = function () {   // а недобор ЕСТЬ — вердиктом упаковщика (#4745)
    return [{ key: SID + '|0', slitterId: SID, day: 0, freeMin: 50, needMin: 6.8, donorCutId: 'd1' }];
};
lvl.autoSequenceQueueAfterMerge = function (strategy, preserveOrder, scope) {
    levelSeen = scope; return Promise.resolve(true);
};
lvl.warnOverfilledDays = function () {};
lvl.notify = function () {};
var lvlDone = lvl.levelDayLoad([SID], null);

var afterSeen = null;
var after = Object.create(Controller.prototype);
after.slitters = [{ id: SID }];
after.cuts = [];
after.overfilledDaysOf = function () { return []; };
after.plannerUnderfilledDays = function () {
    return [{ key: SID + '|0', slitterId: SID, day: 0, freeMin: 50, needMin: 6.8, donorCutId: 'd1' }];
};
after.levelDayLoad = function (ids) { afterSeen = ids; return Promise.resolve(true); };
var afterDone = after.levelOverfilledAfterWrite({ withinSlitterIds: [SID] }, true);

Promise.all([lvlDone, afterDone]).then(function () {
    assert(levelSeen && levelSeen.trainOnly === true,
        'E. выравнивание запускается на НЕДОБРАННОМ дне (переполнения нет) и остаётся паровозом',
        'scope: ' + JSON.stringify(levelSeen));
    assert(afterSeen && String(afterSeen) === String([SID]),
        'E2. общий хвост записи тоже видит недобор и зовёт выравнивание',
        'станки: ' + JSON.stringify(afterSeen));

    var src = require('fs').readFileSync(
        __dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    // #4749: у вердикта появился параметр — права текущего действия (`manualShift`): мерить надо
    // тем же планом, который это действие вправе записать. Источник по-прежнему ОДИН, поэтому
    // считаем вызовы, а не их пустые скобки.
    assert((src.match(/plannerUnderfilledDays\(/g) || []).length >= 3,
        'F. вход в выравнивание и предупреждение берут недобор у ОДНОГО источника — вердикта упаковщика (#4745)');

    console.log('\n' + passed + '/' + total + ' проверок пройдено');
}).catch(function (err) {
    console.error('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
