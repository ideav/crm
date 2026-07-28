// Tests for ideav/crm#4459 — «всё равно задание вклинивается в начало дня в разрыв».
//
// ТРАССА С БОЕВОЙ (ateh1, issue #4459, уже с кодом #4457):
//   [pp-opt] ВЫБОР: C — перестановка внутри дней (дни и станки те же)
//   [pp-opt]   644294: 28.07 14:50 → 28.07 08:00 (станок тот же: Станок 2)
// 644294 — то самое MW308 на 18 ножей: единственная такая комбинация в дне. «Упорядочить» подняло
// его на 08:00, в НАЧАЛО дня, и день на экране вырос 425 → 455 мин (ровно смена ножей, 30).
//
// ПРИЧИНА. Кандидат C (`intraDayImprovementOps`, #4440) выбрасывает из входа замороженные,
// начатые и завершённые задания, а заправку станка берёт `prevSetupBeforeWindow` — строго ДО
// начала окна. Замороженный день СТОИТ ВНУТРИ окна, поэтому его хвост (вечер 27.07: MW411,
// 15 ножей) предшественником не становится: `entry` = null. В `resequenceWithinDays` вход в
// первый день тогда бесплатен для ЛЮБОГО кандидата — DP ставит первым что угодно, а двойная
// приёмка (реальные минуты не выросли) меряет тем же слепым стыком и багу не мешает.
//
// Run with: node experiments/atex-4459-intraday-entry.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var BASE = new Date(2026, 6, 27, 0, 0, 0, 0).getTime();   // Пн 27.07.2026 — первый день окна
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.2 };
// Веса — с боевой ateh1 (блок ПЕРЕМЕННЫЕ из трассы #4459).
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1',
    KNIVES_INCREASE_COST_MN: '35', ORDER_DIFF_PENALTY_MN: '12',
    BREAK_KNIVES_COST_MN: '50', BREAK_MATERIAL_COST_MN: '40' };

function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function dayKeyOf(dayOff) {
    var d = new Date(BASE + dayOff * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function cut(id, dayOff, minute, o) {
    o = o || {};
    var runs = o.runs || 10;
    var mins = Math.ceil(runs * 1.2) + 2 * runs;
    return { id: id, orderId: 'O' + id, firstPartId: id,
        slitter: { id: '1279', label: 'Станок 2' },
        materialId: o.mat || 'MW308', winding: 'OUT', batchId: '',
        knifeWidths: widths(o.knives, o.width || (900 / o.knives)), knifeCount: o.knives,
        rollerWidth: 60, plannedRuns: runs, isFoil: false, length: 300, status: o.status || '',
        startDate: o.startDate || '', endDate: '', fixed: false,
        planDate: ts(dayOff, minute), number: ts(dayOff, minute),
        duration: String(Math.ceil(runs * 1.2)),
        storedKnifeSetupMin: String(o.k == null ? 30 : o.k),
        storedMaterialWindingMin: String(o.m == null ? 15 : o.m),
        storedCutAndLeaderMin: String(mins) };
}
function makeSelf(cuts, freezeDays) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { date: '2026-07-27', dateTo: '2026-08-09' };
    self.supplies = []; self.genPositions = []; self.footageBySupply = {}; self.positionLengthById = {};
    self.slitters = [{ id: '1279', label: 'Станок 2' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {};
    self.freezeByDay = {};
    (freezeDays || []).forEach(function (d) { self.freezeByDay[dayKeyOf(d)] = { id: 'f' + d, notes: '' }; });
    self.meta = { cut: { id: '1078', reqs: [] }, calendar: { id: '1' },
        freeze: (freezeDays && freezeDays.length) ? { id: '2' } : null };
    self.nowMs = function () { return BASE; };
    self.prevSetupBySlitter = {};
    return self;
}
function dayOf(tsSec) { return Math.floor((Number(tsSec) * 1000 - BASE) / 86400000); }
// Реальные минуты переналадки цепочки — как их заплатит цех, СЧИТАЯ стык с хвостом слева.
function chainCost(list, prev) {
    var t = 0, p = prev || null;
    list.forEach(function (c) { if (p) t += P.changeoverCost(p, c, TIMES); p = c; });
    return t;
}
function orderAfter(self, res, dayOff) {
    var w = {};
    res.updates.forEach(function (u) { w[String(u.cutId)] = Number(u.planStartTs); });
    return self.cuts.filter(function (c) { return dayOf(c.planDate) === dayOff; })
        .slice().sort(function (a, b) {
            return (w[String(a.id)] || Number(a.planDate)) - (w[String(b.id)] || Number(b.planDate));
        });
}
function knives(list) { return list.map(function (c) { return c.knifeCount; }).join('→'); }

// Боевой расклад Станка 2. День 0 (27.07) — его хвост оставляет станок на 15 ножах MW411;
// день 1 (28.07) — шесть заданий, единственное 18-ножевое стоит последним (425 мин).
function fixture(tailOpts) {
    return [
        cut('t27', 0, 720, Object.assign({ knives: 15, mat: 'MW411', runs: 4, k: 0 }, tailOpts || {})),
        cut('h28', 1, 480, { knives: 15, mat: 'MW411', runs: 32 }),
        cut('mr1', 1, 612, { knives: 15, mat: 'MR194', runs: 10, k: 0 }),
        cut('mwr', 1, 659, { knives: 15, mat: 'MWR200', runs: 20, k: 0 }),
        cut('m411b', 1, 738, { knives: 8, mat: 'MW411', runs: 13 }),
        cut('mr2', 1, 825, { knives: 8, mat: 'MR194', runs: 6, k: 0 }),
        cut('mw308', 1, 860, { knives: 18, mat: 'MW308', runs: 3 })
    ];
}

// ── 1) Замороженный хвост слева: 18 ножей НЕ поднимается в 08:00 ──────────────────────────────
(function () {
    var cuts = fixture();
    var self = makeSelf(cuts, [0]);                    // 27.07 заморожен (#4436)
    var res = Controller.prototype.intraDayImprovementOps.call(self);
    var before = cuts.filter(function (c) { return dayOf(c.planDate) === 1; });
    var after = orderAfter(self, res, 1);
    var tail = cuts[0];

    assert(String(after[0].id) !== 'mw308',
        '#4459: уникальные 18 ножей НЕ встают первыми в дне (слева хвост на 15 ножах)',
        '(' + knives(after) + ')');

    var was = chainCost(before, tail), now = chainCost(after, tail);
    assert(now <= was,
        '#4459: реальная переналадка дня со стыком слева НЕ выросла: ' + was + ' → ' + now + ' мин');
})();

// ── 2) Тот же хвост, но день не заморожен, а НАЧАТ (#4381) и ЗАВЕРШЁН — вход теряется так же ───
[['начат', { startDate: ts(0, 720) }], ['завершён', { status: 'Завершён' }]].forEach(function (kind) {
    (function () {
        var cuts = fixture(kind[1]);
        var self = makeSelf(cuts, null);
        var res = Controller.prototype.intraDayImprovementOps.call(self);
        var after = orderAfter(self, res, 1);
        assert(String(after[0].id) !== 'mw308',
            '#4459: хвост слева ' + kind[0] + ' — он всё равно предшественник, 18 ножей не первые',
            '(' + knives(after) + ')');
    })();
});

// ── 3) Выигрыш gainMin честен: он меряет ту же цепочку, что и цех ─────────────────────────────
(function () {
    var cuts = fixture();
    var self = makeSelf(cuts, [0]);
    var res = Controller.prototype.intraDayImprovementOps.call(self);
    var was = chainCost(cuts.filter(function (c) { return dayOf(c.planDate) === 1; }), cuts[0]);
    var now = chainCost(orderAfter(self, res, 1), cuts[0]);
    assert(Math.abs(res.gainMin - (was - now)) < 1e-6,
        '#4459: gainMin = реальная экономия со стыком слева',
        '(gainMin ' + res.gainMin + ' vs ' + (was - now) + ')');
})();

// ── 4) Контроль: пустой станок (слева ничего нет) — перестановка по-прежнему работает ─────────
(function () {
    var cuts = [
        cut('c1', 0, 480, { knives: 15, mat: 'MW411', k: 0 }),
        cut('c2', 0, 620, { knives: 8, mat: 'MR194' }),
        cut('c3', 0, 700, { knives: 15, mat: 'MWR200' })
    ];
    var self = makeSelf(cuts, null);
    var res = Controller.prototype.intraDayImprovementOps.call(self);
    assert(res.updates.length > 0, '#4440 не сломан: на пустом станке блоки ножей по-прежнему собираются');
    assertEqual(knives(orderAfter(self, res, 0)), '15→15→8',
        '#4440 не сломан: 15→8→15 стало 15→15→8');
})();

// ── 5) Контроль: хвост слева НА 18 ножах — тогда 18 первыми это правильно ─────────────────────
(function () {
    var cuts = fixture({ knives: 18, mat: 'MW308' });
    var self = makeSelf(cuts, [0]);
    var res = Controller.prototype.intraDayImprovementOps.call(self);
    var after = orderAfter(self, res, 1);
    assertEqual(String(after[0].id), 'mw308',
        '#4459: станок с вечера на 18 ножах → 18-ножевое утром первое (переналадки ноль)');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
