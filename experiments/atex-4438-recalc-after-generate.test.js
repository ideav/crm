// Tests for ideav/crm#4438 — «Почему после Сгенерировать сразу требуется Пересчитать наладку?»
// (дыра в полчаса между первым и вторым заданием дня).
//
// «Сгенерировать»/«Упорядочить» пишут в базу ДВА расчёта разными путями: «Дату план» считает
// упаковщик (splitMachineQueue → applySplitPlan), а три колонки тайминга — computeCutSetupUpdates
// по очереди станка. Обычно они сходятся; любое расхождение выходит на экран ДЫРОЙ (или нахлёстом)
// между карточками, и человек сразу видит красную «↻ Пересчитать наладку» — сразу после генерации,
// ничего не трогая.
//
// Проверено на боевом стенде ateh1 (Станок 2, 28.07.2026): 643930 08:00–10:17 (137 мин), следующая
// 644574 стои́т в 10:47 — ровно на 30 минут (KNIFE) позже конца предыдущей, хотя её хранимая наладка
// ножей = 0 (набор ножей тот же, 15×59, ролик 60). Детектор кнопки хотел сдвинуть 5 заданий на −30.
//
// Фикс: по итогам записи плана `applySplitPlan` прогоняет ту же сверку, что делает кнопка
// (`reconcilePlanStarts` → `recalcStartUpdates`): старты пересобираются ВСТЫК внутри дня по хранимым
// колонкам — день и порядок не меняются, за пределы дня ничего не выносится, замороженные дни не
// трогаются (#4436). Расхождение не замалчиваем: пишем в консоль, что именно разъехалось.
//
// Run with: node experiments/atex-4438-recalc-after-generate.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

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

var BASE = new Date(2026, 6, 28, 0, 0, 0, 0).getTime();   // Вт 28.07.2026
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.2 };
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1' };

function ts(dayOff, minute) { return String(Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60); }
function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function dayKeyOf(dayOff) {
    var d = new Date(BASE + dayOff * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}
// Задание со СВОИМ хранимым таймингом (k/m/cut) и стартом — как строка отчёта cut_planning.
function cut(id, dayOff, minute, o) {
    o = o || {};
    return { id: id, orderId: 'O' + id, firstPartId: id,
        slitter: { id: '1279', label: 'Станок 2' },
        materialId: o.mat || 'MW308', winding: 'OUT', batchId: '',
        knifeWidths: widths(o.knives || 15, o.width || 59), knifeCount: o.knives || 15,
        rollerWidth: o.roller || 60, plannedRuns: o.runs || 10, isFoil: false, length: 300, status: '',
        startDate: '', endDate: '', fixed: false,
        planDate: ts(dayOff, minute), number: ts(dayOff, minute),
        duration: String(o.cut || 32),
        storedKnifeSetupMin: String(o.k == null ? 0 : o.k),
        storedMaterialWindingMin: String(o.m == null ? 15 : o.m),
        storedCutAndLeaderMin: String(o.cut == null ? 32 : o.cut) };
}
function makeSelf(cuts, freezeDays) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { date: '2026-07-28', dateTo: '2026-08-09' };
    self.supplies = []; self.genPositions = []; self.footageBySupply = {}; self.positionLengthById = {};
    self.slitters = [{ id: '1279', label: 'Станок 2' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {};
    self.freezeByDay = {};
    (freezeDays || []).forEach(function (d) { self.freezeByDay[dayKeyOf(d)] = { id: 'f' + d, notes: '' }; });
    self.meta = { cut: { id: '1078', reqs: [] }, calendar: { id: '1' },
        freeze: (freezeDays && freezeDays.length) ? { id: '2' } : null };
    self.nowMs = function () { return BASE; };
    self.prevSetupBySlitter = {};
    self.writes = [];
    self.post = function (url, fields) { self.writes.push({ url: url, fields: fields }); return Promise.resolve({}); };
    self.reload = function () { return Promise.resolve(); };
    return self;
}
function minOf(tsSec) { return Math.round((Number(tsSec) * 1000 - BASE) / 60000) % 1440; }

// ── 1) Дыра в полчаса: план и хранимые колонки разошлись → сверка её убирает ────────────────────
// Данные стенда: 643930 08:00 (occ 137: k=0 m=15 cut=122), 644574 стои́т в 10:47 при конце
// предыдущей 10:17 — лишние 30 минут, которых нет ни в одной колонке.
(function () {
    var cuts = [
        cut('643930', 0, 480, { k: 0, m: 15, cut: 122, runs: 32, mat: 'MW411' }),
        cut('644574', 0, 480 + 167, { k: 0, m: 15, cut: 32, runs: 10, mat: 'MR194' }),   // 10:47 — на 30 мин позже
        cut('644936', 0, 480 + 214, { k: 0, m: 15, cut: 64, runs: 20, mat: 'MWR200' })
    ];
    var self = makeSelf(cuts, null);
    var before = cuts.map(function (c) { return minOf(c.planDate); });
    assertEqual(before, [480, 647, 694], 'исходная раскладка с дырой: 08:00 / 10:47 / 11:34');

    return Controller.prototype.reconcilePlanStarts.call(self).then(function (n) {
        assertEqual(n, 2, '#4438: сверка нашла и исправила 2 задания (всё, что после дыры)');
        var byId = {};
        self.writes.forEach(function (w) { byId[decodeURIComponent(w.url.split('/')[1].split('?')[0])] = Number(w.fields.t1078); });
        assertEqual(minOf(byId['644574']), 480 + 137, '#4438: 644574 встала ВСТЫК за первой (10:17), дыра убрана');
        assertEqual(minOf(byId['644936']), 480 + 137 + 47, '#4438: 644936 подтянулась следом (11:04)');
        assert(byId['643930'] == null, '#4438: первое задание дня не трогаем — оно и так на месте');
    });
})();

// ── 2) План уже согласован — сверка молчит и ничего не пишет ───────────────────────────────────
(function () {
    var cuts = [
        cut('A', 0, 480, { k: 0, m: 15, cut: 122, runs: 32, mat: 'MW411' }),
        cut('B', 0, 480 + 137, { k: 0, m: 15, cut: 32, runs: 10, mat: 'MR194' }),
        cut('C', 0, 480 + 137 + 47, { k: 0, m: 15, cut: 64, runs: 20, mat: 'MWR200' })
    ];
    var self = makeSelf(cuts, null);
    return Controller.prototype.reconcilePlanStarts.call(self).then(function (n) {
        assertEqual(n, 0, '#4438: согласованный план сверка не трогает');
        assertEqual(self.writes.length, 0, '#4438: ни одной лишней записи');
    });
})();

// ── 3) Замороженный день сверка не трогает (#4436) ─────────────────────────────────────────────
(function () {
    var cuts = [
        cut('F1', 0, 480, { k: 0, m: 15, cut: 122, runs: 32, mat: 'MW411' }),
        cut('F2', 0, 480 + 167, { k: 0, m: 15, cut: 32, runs: 10, mat: 'MR194' })   // та же дыра, но день заморожен
    ];
    var self = makeSelf(cuts, [0]);
    return Controller.prototype.reconcilePlanStarts.call(self).then(function (n) {
        assertEqual(n, 0, '#4438: в замороженном дне сверка стартов не работает — замок дня старше');
        assertEqual(self.writes.length, 0, '#4438: в замороженный день ни одной записи');
    });
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
