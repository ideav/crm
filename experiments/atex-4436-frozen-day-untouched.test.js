// Tests for ideav/crm#4436 — «Зачем залез в замороженный день что-то менять?» (кнопка «Сгенерировать»)
// и «Да ещё поставил 2 задания на 8 утра».
//
// «Заморозка» дня (#4326) обещает: «планирование его не трогает». Выполнялось это ЧАСТИЧНО:
// задания замороженного дня оставались во входе планировщика, пришпиленные к своему дню (временный
// `c.fixed` + `dayAnchorByCut`), и упаковщик каждый раз раскладывал день ЗАНОВО встык — «Дата план»
// менялась (проба: 08:00/09:00/11:40 → 08:00/09:11/13:15) и уходила в базу. Тем же путём
// переписывался хранимый тайминг: `applySplitPlan` завершается `persistCutSetupColumns()` по ВСЕЙ
// очереди.
//
// Планировщик замороженный день по-прежнему СЧИТАЕТ (иначе первая резка следующего дня меряет
// переналадку не от того предшественника и в плане появляется фантомная «дыра в полчаса» — #4438,
// та же природа, что #4300/#4312/#4315), но НЕ МЕНЯЕТ: обновления «Даты план», удаления и новые
// сегменты по заданиям замороженных дней отсекаются из набора записи, а хранимый тайминг таких
// заданий не трогает `computeCutSetupUpdates`. Кнопка «↻ Пересчитать наладку» их тоже не касается.
//
// Run with: node experiments/atex-4436-frozen-day-untouched.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
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

// База «С» = Пн 27.07.2026 (как на стенде issue). Дни: 0 Пн, 1 Вт, 2 Ср, 3 Чт, 4 Пт, 5–6 выходные.
var BASE = new Date(2026, 6, 27, 0, 0, 0, 0).getTime();
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.2 };
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1', DEADLINE_COST_MN: '200', EXACT_DEADLINE_COST_MN: '9',
    ORDER_DIFF_PENALTY_MN: '12', MAX_SLOTS_DISTANCE_HR: '24', MAX_DISTANCE_COST_MN: '10' };

function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function dayKeyOf(dayOff) {
    var d = new Date(BASE + dayOff * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
function cut(id, dayOff, minute, runs, o) {
    o = o || {};
    var mins = Math.ceil(runs * 1.2) + 2 * runs;
    return { id: id, orderId: 'O' + id, firstPartId: o.firstPartId || id,
        slitter: { id: '1279', label: 'Станок 2' },
        materialId: o.mat || 'MW308', winding: o.winding || 'OUT', batchId: '',
        knifeWidths: widths(o.knives || 11, o.width || 80), knifeCount: o.knives || 11, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '',
        startDate: '', endDate: '', fixed: !!o.fixed,
        planDate: ts(dayOff, minute), number: ts(dayOff, minute),
        duration: String(Math.ceil(runs * 1.2)),
        storedKnifeSetupMin: o.k == null ? '30' : String(o.k),
        storedMaterialWindingMin: o.m == null ? '15' : String(o.m),
        storedCutAndLeaderMin: String(mins) };
}
function planSelf(cuts, dues, freezeDays) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { date: '2026-07-27', dateTo: '2026-08-09' };
    self.supplies = Object.keys(dues).map(function (id) {
        return { id: 's' + id, cutId: id, positionId: 'p' + id, rolls: 1, dueKey: dayKeyOf(dues[id]), orderNo: 'ord' + id };
    });
    self.genPositions = Object.keys(dues).map(function (id) {
        return { id: 'p' + id, materialId: 'MW308', width: 80, qty: 1, length: 300, dueKey: dayKeyOf(dues[id]), approved: true };
    });
    self.footageBySupply = {}; self.positionLengthById = {};
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
// → { written: { id: {day,min} }, ops }
function place(cuts, dues, freezeDays) {
    var self = planSelf(cuts, dues, freezeDays);
    var ops = Controller.prototype.buildSequenceOps.call(self, cuts, 'SETUP', false, null).ops;
    var written = {};
    (ops.updates || []).forEach(function (u) {
        var t = Number(u.planStartTs) * 1000;
        written[String(u.cutId)] = { day: Math.floor((t - BASE) / 86400000), min: Math.round((t - BASE) / 60000) % 1440 };
    });
    return { written: written, ops: ops };
}

// Замороженный день 0: два 🔒 и одно обычное задание; плюс свободные задания на будущее.
function frozenScene() {
    var cuts = [
        cut('F1', 0, 480, 8, { knives: 11, width: 80, mat: 'MW411', k: 0, m: 0, fixed: true }),
        cut('F2', 0, 540, 59, { knives: 11, width: 80, mat: 'MW308', fixed: true }),
        cut('F3', 0, 700, 4, { knives: 15, width: 59, mat: 'MW411' }),   // БЕЗ 🔒 — держит только заморозка
        cut('A', 1, 480, 20, { knives: 11, width: 80 }),
        cut('B', 1, 600, 30, { knives: 22, width: 40, mat: 'MW411' }),
        cut('C', 2, 480, 15, { knives: 11, width: 80 })
    ];
    var dues = { F1: 1, F2: 1, F3: 0, A: 3, B: 3, C: 4 };
    return { cuts: cuts, dues: dues };
}

// ── 1) Замороженный день не переписывается ВООБЩЕ ───────────────────────────────────────────────
(function () {
    var sc = frozenScene();
    var res = place(sc.cuts, sc.dues, [0]);
    ['F1', 'F2', 'F3'].forEach(function (id) {
        assert(res.written[id] == null,
            '#4436: заданию ' + id + ' замороженного дня «Дата план» НЕ переписана');
    });
    assert(Object.keys(res.written).length > 0, '#4436: остальные задания планировщик по-прежнему раскладывает');
})();

// ── 2) Контроль: без заморозки те же задания планировщик перекладывает ──────────────────────────
(function () {
    var sc = frozenScene();
    var res = place(sc.cuts, sc.dues, null);
    assert(res.written['F2'] != null || res.written['F3'] != null,
        '#4436 контроль: без заморозки день 0 действительно пересобирается (иначе проба ничего не доказывает)');
})();

// ── 3) Ничего не встаёт ПОВЕРХ замороженного дня и два задания не стартуют в одну минуту ───────
(function () {
    var sc = frozenScene();
    var res = place(sc.cuts, sc.dues, [0]);
    // Итоговая раскладка станка: записанное планировщиком + хранимое у нетронутых.
    var starts = {};
    var dup = null;
    sc.cuts.forEach(function (c) {
        var w = res.written[String(c.id)];
        var day, min;
        if (w) { day = w.day; min = w.min; }
        else {
            var t = Number(c.planDate) * 1000;
            day = Math.floor((t - BASE) / 86400000); min = Math.round((t - BASE) / 60000) % 1440;
        }
        var key = day + '@' + min;
        if (starts[key]) dup = key + ' (' + starts[key] + ' и ' + c.id + ')';
        starts[key] = c.id;
    });
    assert(dup == null, '#4436: ни одна пара заданий станка не стартует в одну минуту' + (dup ? ' — ' + dup : ''));
    var intoFrozen = Object.keys(res.written).filter(function (id) { return res.written[id].day === 0; });
    assertEqual(intoFrozen, [], '#4436: в замороженный день планировщик не поставил НИ ОДНОГО задания');
})();

// ── 4) Хранимый тайминг замороженного дня не переписывается ─────────────────────────────────────
(function () {
    var sc = frozenScene();
    var self = planSelf(sc.cuts, sc.dues, [0]);
    self.meta.cut.reqs = [
        { id: 'r1', name: 'Наладка ножей, мин' },
        { id: 'r2', name: 'Сырье/намотка, мин' },
        { id: 'r3', name: 'Резка и Лидер' }
    ];
    // Портим хранимое у задания замороженного дня — пересчёт «захотел бы» его исправить.
    sc.cuts[1].storedKnifeSetupMin = '999';
    var upd = Controller.prototype.computeCutSetupUpdates.call(self, null, { dryRun: true }).updates || [];
    var ids = upd.map(function (u) { return String(u.cutId); });
    assert(ids.indexOf('F2') < 0, '#4436: тайминг задания замороженного дня в набор записи НЕ попадает');
    assertEqual(sc.cuts[1].storedKnifeSetupMin, '999', '#4436: хранимое значение осталось нетронутым');
})();

// ── 5) Цепочка дробления со звеном в замороженном дне не переписывается ни одним звеном ───────
(function () {
    var cuts = [
        cut('H', 1, 480, 10),                              // голова — Ср (день 1, НЕ заморожен)
        cut('T', 2, 480, 6, { firstPartId: 'H' }),         // продолжение — Чт (день 2, ЗАМОРОЖЕН)
        cut('X', 1, 700, 8, { knives: 22, width: 40 })     // обычное задание — планировщик его двигает
    ];
    var res = place(cuts, { H: 5, T: 5, X: 5 }, [2]);
    assert(res.written['T'] == null, '#4436: звено цепочки в замороженном дне не переписано');
    assert(Object.keys(res.written).length > 0, '#4436: остальная очередь планируется');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
