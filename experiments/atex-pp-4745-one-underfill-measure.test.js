// #4745 — «ДЕНЬ ТАК И НЕ НАБИТ, В ЧЁМ ПРОБЛЕМА?»: ДВА РАСЧЁТА НА ОДИН ВОПРОС.
//
// СИМПТОМ (боевое 13.08.2026, ateh1, бандл .147 — уже с #4743): Станок 1, Чт 13.08 держит 405 минут
// при потолке 455, и РМ говорит «День не набит до конца — нажмите „Упорядочить“». Но набивать
// нечем: свободные 50 минут съедены переналадкой последнего задания и округлением занятости до
// целых минут (#4149) — упаковщик считает этот день ПОЛНЫМ и в его `ops.dayFill` дня нет.
//
// ПРИЧИНА — КЛАСС «ОДНА АРИФМЕТИКА» (#4499/#4529/#4518). Про недобор дня спрашивали ДВОИХ:
//   • упаковщик (`ops.dayFill`) — свободные минуты меряет тем же гейтом потолка, которым паковал
//     (`availFor`: целая занятость, обед, простои, резервы), нужду донора — РЕАЛЬНОЙ переналадкой
//     от фактического предшественника;
//   • контроллер (`planUnderfilledDays`) — «потолок − Σ хранимых минут», наладка донора из колонок.
// Второй оптимистичнее, поэтому объявлял недобранными дни, которые первый считает полными: оператор
// получал совет нажать кнопку на дне, где кнопка ничего не изменит.
//
// РЕШЕНИЕ: оператору отвечает УПАКОВЩИК. Второй расчёт остаётся объективу «Упорядочить» — там
// сравнивают планы между собой одной меркой, и это законно.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — воспроизведение: на боевой раскладке две мерки расходятся;
//   B — предупреждение оператору идёт от вердикта упаковщика (пусто → молчим);
//   C — в сообщении названы день, донор и ОБЕ меры (ТЗ §14: число разворачивается в объекты);
//   D — вход в выравнивание берёт недобор оттуда же (чиним ровно то, о чём говорим).
//
// Run with: node experiments/atex-pp-4745-one-underfill-measure.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 7, 13, 0, 0, 0, 0).getTime();   // Чт 13.08.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600, DAY = 86400, SID = '1279';

// Боевая раскладка дня из #4745 по ХРАНИМЫМ минутам карточек: 35 + 31 + 75 + 264 = 405 при 455.
// Хвост цепочки (3 прохода, 18 мин) стои́т первым заданием следующего дня.
function cut(id, o) {
    return { id: id, slitter: { id: SID }, status: '', plannedRuns: o.runs, fixed: !!o.fixed,
             firstPartId: o.chain || id, startDate: '', endDate: '',
             planDate: String(D0 + o.day * DAY + (o.min || 0) * 60),
             storedKnifeSetupMin: 0, storedMaterialWindingMin: 0, storedCutAndLeaderMin: o.work };
}
function liveDay() {
    return [
        cut('c1', { day: 0, min: 0,   runs: 9,  work: 35 }),
        cut('c2', { day: 0, min: 35,  runs: 4,  work: 31 }),
        cut('c3', { day: 0, min: 66,  runs: 4,  work: 75 }),
        cut('c4', { day: 0, min: 151, runs: 39, work: 264, fixed: true, chain: 'c4' }),
        cut('c5', { day: 1, min: 0,   runs: 3,  work: 18,               chain: 'c4' })
    ];
}
function ctrl(cuts) {
    var self = Object.create(Controller.prototype);
    self.filter = { date: '2026-08-13' };
    self.nowMs = function () { return BASE + 9 * 3600000; };
    self.meta = {}; self.supplies = []; self.cuts = cuts;
    self.slitters = [{ id: SID, label: 'Станок 1' }];
    self.shiftClosedSlittersToday = function () { return {}; };
    self.blockedRangesBySlitter = function () { return {}; };   // ни отпусков, ни простоев
    self.workingWindow = function () {
        return { startMin: 480, cutEndMin: 970, endMin: 990,
                 maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40 };
    };
    return self;
}

// ── A. ДВЕ МЕРКИ РАСХОДЯТСЯ ────────────────────────────────────────────────────────────────
var a = ctrl(liveDay());
var byController = a.planUnderfilledDays(a.cuts, null);
assert(byController.length === 1 && byController[0] === SID + '|20260813',
    'A. второй расчёт объявляет боевой день недобранным — ровно то, что видел оператор',
    'мерка контроллера: ' + JSON.stringify(byController));

// ── B/C. ОПЕРАТОРУ ОТВЕЧАЕТ УПАКОВЩИК ──────────────────────────────────────────────────────
var quiet = ctrl(liveDay());
var quietSaid = [];
quiet.notify = function (m) { quietSaid.push(m); };
quiet.plannerUnderfilledDays = function () { return []; };   // вердикт упаковщика: день полон
assert(quiet.warnUnderfilledAfterSettle() === 0 && quietSaid.length === 0,
    'B. упаковщик считает день полным — оператору не говорим ничего (совет нажать кнопку был ложным)');

var loud = ctrl(liveDay());
var loudSaid = [];
loud.notify = function (msg, kind) { loudSaid.push({ msg: msg, kind: kind }); };
loud.plannerUnderfilledDays = function () {
    return [{ key: SID + '|0', slitterId: SID, day: 0, freeMin: 47, needMin: 6.8, donorCutId: 'c5' }];
};
var n = loud.warnUnderfilledAfterSettle();
assert(n === 1 && loudSaid.length === 1 && loudSaid[0].kind === 'warning',
    'B2. упаковщик оставил дыру — говорим (молчать о недоборе по-прежнему нельзя, #4638)',
    'сообщений: ' + loudSaid.length);
assert(/Станок 1/.test(loudSaid[0].msg) && /свободно 47 мин/.test(loudSaid[0].msg)
        && /c5/.test(loudSaid[0].msg) && /6\.8 мин/.test(loudSaid[0].msg),
    'C. названы день, донор и ОБЕ меры — число разворачивается в объекты (ТЗ §14)',
    '(' + loudSaid[0].msg + ')');

// ── D. ЧИНИМ ТО, О ЧЁМ ГОВОРИМ ─────────────────────────────────────────────────────────────
var seen = null;
var lvl = Object.create(Controller.prototype);
lvl.slitters = [{ id: SID }];
lvl.cuts = [];
lvl.overfilledDaysOf = function () { return []; };
lvl.plannerUnderfilledDays = function () {
    return [{ key: SID + '|0', slitterId: SID, day: 0, freeMin: 47, needMin: 6.8, donorCutId: 'c5' }];
};
lvl.levelDayLoad = function (ids) { seen = ids; return Promise.resolve(true); };
lvl.levelOverfilledAfterWrite({ withinSlitterIds: [SID] }, true).then(function () {
    assert(seen && String(seen) === String([SID]),
        'D. вход в выравнивание берёт недобор у того же вердикта — чиним ровно то, о чём говорим',
        'станки: ' + JSON.stringify(seen));

    var src = require('fs').readFileSync(
        __dirname + '/../download/atex/js/production-planning/20-controller.js', 'utf8');
    assert(/ops\.dayFill/.test(src) && /plannerUnderfilledDays = function/.test(src),
        'D2. вердикт читается из `ops.dayFill` — числа самого упаковщика, а не второй расчёт');

    console.log('\n' + passed + '/' + total + ' проверок пройдено');
}).catch(function (err) {
    console.error('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
