// #4768 — РУЧНОЙ ПЕРЕНОС НЕ ДЕРЖИТ ДЕНЬ: ВЫРАВНИВАНИЕ ТОЙ ЖЕ КНОПКИ СНИМАЕТ ЯКОРЬ.
//
// СИМПТОМ (боевое 14.08.2026, ateh, 14:10 МСК). Заказ 4752 (задание 695159, Станок 3) стоял в
// 18.08; оператор перенёс его в 17.08 — задание оказалось в 14.08, в текущем дне, из которого при
// этом уехали зафиксированные (🔒) соседи. «Журнал» (665850) показывает ДВЕ записи плана на одно
// нажатие:
//
//   14:10:41  applySplitPlan-1786705841   SESSION    updates 13, creates 1, deletes 2
//   14:10:44  applySplitPlan-1786705841   PLAN_MOVE  695159 — время старта в дне 17.08.2026 изменилось
//   14:10:49  reconcilePlanStarts-…849    DAY_OVER   1279 +2 мин; 1277 +10 мин      ← хвост первой записи
//   14:10:50  applySplitPlan-1786705850   SESSION    updates 13, creates 0, deletes 0
//   14:10:51  applySplitPlan-1786705850   PLAN_MOVE  695159 — день 17.08.2026 → 14.08.2026   ⛔
//
// Вторая запись — проход выравнивания (`levelOverfilledAfterWrite`), секунда после завершения
// первой, ноль созданий и удалений.
//
// ПРИЧИНА. В выравнивание уезжает ПРАВО ручного действия (`manualShift`, #4736 — снимать якорь дня
// с хвоста очереди) и остаётся его ЦЕЛЬ. Удерживает перенесённое задание в выбранном дне одна
// вещь — исключение «задание, которое действие несёт САМО» в `buildSequenceOps`; читает оно поля
// цели (`pinCutIds` / `weightPositionCutIds`), а `levelDayLoad` строит scope заново и этих полей
// не получал. Перенесённое попадало в собственный хвост, теряло якорь дня и уезжало на пол
// паровоза — первый день после последнего отработанного (#4743). 15–16.08 выходные, 14.08 к 14:10
// отработанным не считался, поэтому пол опустился от 17.08 сразу до 14.08.
//
// ЧТО ПРОВЕРЯЕМ:
//   A — ПУТЬ ЦЕЛИКОМ: ручной перенос в день с недобранным днём позади оставляет задание в
//       ВЫБРАННОМ дне (боевое воспроизведение);
//   B — проводка: `levelOverfilledAfterWrite` передаёт цель действия в `levelDayLoad`;
//   C — проводка: `levelDayLoad` доносит её до раскладки (`autoSequenceQueueAfterMerge`);
//   D — резерв «целиком» (#4488) в выравнивание по-прежнему НЕ едет: день рвёт перенесённое
//       задание по потолку и увозит остаток продолжением (#4693);
//   E — причина в движке: с якорем задание остаётся в своём дне, без якоря падает на пол паровоза;
//   F — автоматическое выравнивание цели не выдумывает: без ручного действия scope её не несёт.
//
// Run with: node experiments/atex-pp-4768-move-holds-day.test.js

process.env.TZ = 'Europe/Moscow';

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;
var planning = mod.planning;

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

// Смена станка как на бою: 08:00–16:30, уборка 20 (потолок резки 16:10), обед 12:20×40.
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1' };
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.8 };
var CEILING = 460;
var SID = '1282';                                          // Станок 3 из боевого
var BASE = new Date(2026, 7, 14, 0, 0, 0, 0).getTime();    // Пт 14.08.2026 = день 0 (день инцидента)
var DAY_START = 480, LUNCH_START = 740, LUNCH_DUR = 40;
var PACK = { dayStartMin: DAY_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR, blocked: [] };

function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function tsAt(dayOff, minute) { return Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60; }
function dayOffOf(tsSec) { return Math.floor(Math.round((Number(tsSec) * 1000 - BASE) / 60000) / 1440); }
function minOf(tsSec) { var m = Math.round((Number(tsSec) * 1000 - BASE) / 60000); return ((m % 1440) + 1440) % 1440; }

function cut(id, o) {
    o = o || {};
    return { id: id, orderId: 'O' + id, firstPartId: id,
        slitter: { id: SID, label: 'Станок 3' },
        materialId: o.mat, winding: 'OUT', batchId: 'B' + o.mat,
        knifeWidths: widths(o.knives || 15, o.width || 59), knifeCount: o.knives || 15,
        rollerWidth: 60, plannedRuns: o.runs, isFoil: false, length: 300, status: '',
        startDate: o.startDate || '', endDate: '', fixed: !!o.fixed,
        planDate: '', number: '', duration: String(Math.ceil(1.8 * o.runs)),
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}

function makeSelf(cuts) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { slitter: '', status: '', date: '2026-08-14', dateTo: '2026-08-21', query: '' };
    self.supplies = []; self.genPositions = []; self.positions = [];
    self.footageBySupply = {}; self.positionLengthById = {}; self.consumptionByCut = {};
    self.jumboWidthByMaterial = {}; self.nominalWidthByMaterial = {}; self.actualWidthIndex = null;
    self.genBatches = []; self.slitters = [{ id: SID, label: 'Станок 3' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {}; self.freezeByDay = {};
    self.prevSetupBySlitter = {};
    self.meta = { cut: { id: '1078', reqs: [
        { id: '96067', val: 'Наладка ножей, мин' },
        { id: '96069', val: 'Сырье/намотка, мин' },
        { id: '96778', val: 'Резка и Лидер' },
        { id: '81530', val: 'Зафиксировано' }
    ] }, calendar: { id: '1' }, freeze: null };
    self.nowMs = function () { return BASE + 14 * 3600000 + 10 * 60000; };   // 14.08, 14:10 — как на бою
    self.busy = false;
    self.writes = [];
    // Запись в БД подменена мутацией очереди в памяти: `_m_save` (главное значение = «Дата план»,
    // #4477 postCutStarts) и `_m_set` (флаг «Зафиксировано»). Без неё перенос не доезжает до
    // раскладки: якорь дня берётся из «Даты план» задания, и она осталась бы прежней.
    self.post = function (url, fields) {
        self.writes.push({ url: url, fields: fields });
        var byId = {};
        self.cuts.forEach(function (c) { byId[String(c.id)] = c; });
        var save = /^_m_save\/([^?]+)/.exec(String(url));
        if (save && fields && fields['t1078'] != null) {
            var c = byId[decodeURIComponent(save[1])];
            if (c) { c.planDate = String(fields['t1078']); c.number = c.planDate; }
        }
        var set = /^_m_set\/([^?]+)/.exec(String(url));
        if (set && fields && fields['t81530'] != null) {
            var f = byId[decodeURIComponent(set[1])];
            if (f) f.fixed = true;
        }
        return Promise.resolve({ obj: '1' });
    };
    self.reload = function () { return Promise.resolve(); };
    self.render = function () {}; self.renderLink = function () {};
    self.setBusy = function (v) { self.busy = !!v; };
    self.showProgress = function () {}; self.hideProgress = function () {}; self.updateProgress = function () {};
    self.notes = [];
    self.notify = function (m, k) { self.notes.push({ msg: m, kind: k }); };
    self.applied = [];
    self.applySplitPlan = function (ops) {
        self.applied.push(ops);
        applyOpsToCuts(self, ops);
        materializeStoredPlan(self);
        return Promise.resolve(true);
    };
    self.reconcileOrphanOrderSupplies = function () { return Promise.resolve(0); };
    return self;
}

function applyOpsToCuts(self, ops) {
    var byId = {}; self.cuts.forEach(function (c) { byId[String(c.id)] = c; });
    ((ops && ops.updates) || []).forEach(function (u) {
        var c = byId[String(u.cutId)];
        if (!c) return;
        c.planDate = String(u.planStartTs); c.number = String(u.planStartTs);
        if (u.plannedRuns != null) {
            c.plannedRuns = Number(u.plannedRuns);
            c.duration = String(Math.ceil(1.8 * Number(u.plannedRuns)));
        }
    });
    ((ops && ops.creates) || []).forEach(function (cr, i) {
        var parent = byId[String(cr.parentCutId)];
        if (!parent) return;
        var seg = JSON.parse(JSON.stringify(parent));
        seg.id = 'S' + self.cuts.length + '_' + (i + 1);
        seg.firstPartId = parent.firstPartId || String(parent.id);
        seg.fixed = false;                                   // продолжение рождается свободным
        seg.plannedRuns = Number(cr.plannedRuns);
        seg.duration = String(Math.ceil(1.8 * Number(cr.plannedRuns)));
        seg.planDate = String(cr.planStartTs); seg.number = String(cr.planStartTs);
        self.cuts.push(seg);
    });
    var dead = {}; ((ops && ops.deletes) || []).forEach(function (id) { dead[String(id)] = true; });
    self.cuts = self.cuts.filter(function (c) { return !dead[String(c.id)]; });
}

function materializeStoredPlan(self, dayOffByCut) {
    (self.computeCutSetupUpdates(null, { dryRun: true }).updates || []).forEach(function (u) {
        var c = self.cuts.filter(function (x) { return String(x.id) === String(u.cutId); })[0];
        if (!c) return;
        c.storedKnifeSetupMin = String(u.knife);
        c.storedMaterialWindingMin = String(u.material);
        c.storedCutAndLeaderMin = String(u.cutTime);
    });
    var byDay = {};
    self.cuts.forEach(function (c) {
        var d = dayOffByCut ? (dayOffByCut[String(c.id)] || 0) : dayOffOf(c.planDate);
        (byDay[d] = byDay[d] || []).push({ cutId: String(c.id), started: false,
            windowStartMin: (c.planDate === '' ? DAY_START : minOf(c.planDate)),
            occMin: Number(c.storedKnifeSetupMin) + Number(c.storedMaterialWindingMin) + Number(c.storedCutAndLeaderMin) });
    });
    Object.keys(byDay).forEach(function (d) {
        byDay[d].sort(function (a, b) { return a.windowStartMin - b.windowStartMin; });
        var starts = planning.repackDayWindowStarts(byDay[d], PACK);
        byDay[d].forEach(function (it) {
            var c = self.cuts.filter(function (x) { return String(x.id) === it.cutId; })[0];
            var ts = String(tsAt(Number(d), starts[it.cutId]));
            c.planDate = ts; c.number = ts;
        });
    });
}
function flush() {
    var p = Promise.resolve();
    for (var i = 0; i < 200; i++) p = p.then(function () {});
    return p;
}
function dayOfCut(self, id) {
    var c = self.cuts.filter(function (x) { return String(x.id) === String(id); })[0];
    return c ? dayOffOf(c.planDate) : null;
}

// ── БОЕВАЯ СЦЕНА ────────────────────────────────────────────────────────────────────────────
// День 0 = Пт 14.08 (сегодня, недобран — в нём одно короткое задание), дни 1–2 = выходные,
// день 3 = Пн 17.08, куда оператор отправляет задание X (заказ 4752). Всё 🔒, как в ateh.
function scene() {
    return [
        cut('a14', { mat: 'MW411', knives: 15, width: 59, runs: 12, fixed: true }),   // день 0
        cut('b17', { mat: 'MR194', knives: 10, width: 88, runs: 40, fixed: true }),   // день 3
        cut('x4752', { mat: 'MWR200', knives: 6, width: 147, runs: 20, fixed: true }) // день 4 — его двигают
    ];
}
function stagedSelf() {
    var self = makeSelf(scene());
    materializeStoredPlan(self, { a14: 0, b17: 3, x4752: 4 });
    self.dayIsWorking = function (ms) {
        var d = new Date(Number(ms)).getDay();
        return d !== 0 && d !== 6;                       // 15–16.08 — выходные
    };
    self.slitterOnVacationDay = function () { return false; };
    self.shiftClosedSlittersToday = function () { return {}; };
    return self;
}

var chain = Promise.resolve();

// ── A/D. ПУТЬ ЦЕЛИКОМ: ЗАДАНИЕ ОСТАЁТСЯ В ВЫБРАННОМ ДНЕ ─────────────────────────────────────
chain = chain.then(function () {
    var self = stagedSelf();
    assertEqual([dayOfCut(self, 'a14'), dayOfCut(self, 'b17'), dayOfCut(self, 'x4752')], [0, 3, 4],
        'фикстура: день 0 недобран, задание 4752 стои́т в дне 4 (как 18.08 на бою)');

    var moved = self.cuts.filter(function (c) { return String(c.id) === 'x4752'; })[0];
    return Controller.prototype.moveCutToDay.call(self, moved, '2026-08-17', 'end', true, SID, true)
        .then(flush).then(function () {
            assertEqual(dayOfCut(self, 'x4752'), 3,
                'A. #4768: перенесённое задание осталось в ВЫБРАННОМ дне (17.08), а не уехало на пол паровоза');
            var back = self.cuts.filter(function (c) {
                return /^x4752/.test(String(c.id)) && dayOffOf(c.planDate) < 3;
            });
            assertEqual(back.map(function (c) { return String(c.id); }), [],
                'A2. ни одна часть перенесённого задания не спустилась в дни раньше выбранного');
            var load = {};
            self.cuts.forEach(function (c) {
                var d = dayOffOf(c.planDate);
                load[d] = Math.round(((load[d] || 0) + Number(c.storedKnifeSetupMin)
                    + Number(c.storedMaterialWindingMin) + Number(c.storedCutAndLeaderMin)) * 100) / 100;
            });
            var over = Object.keys(load).filter(function (k) { return Number(load[k]) > CEILING + 1e-6; });
            assertEqual(over, [],
                'D. потолок дня при этом соблюдён — резерв «целиком» в выравнивание не уехал (' + JSON.stringify(load) + ')');
        });
});

// ── B. ПРОВОДКА: ЦЕЛЬ ДЕЙСТВИЯ УХОДИТ В ВЫРАВНИВАНИЕ ────────────────────────────────────────
chain = chain.then(function () {
    var seen = null;
    var self = Object.create(Controller.prototype);
    self.slitters = [{ id: SID }];
    self.cuts = [];
    self.overfilledDaysOf = function () { return [{ dayOffset: 3, overMin: 15 }]; };
    self.plannerUnderfilledDays = function () { return []; };
    self.levelDayLoad = function (sids, opts) { seen = opts; return Promise.resolve(false); };
    return Controller.prototype.levelOverfilledAfterWrite.call(self, {
        withinSlitterIds: [SID], manualShift: { fromBySlitter: {} },
        unfrozenDayKeys: ['20260817'], pinCutIds: ['x4752'], pinDayPosByCut: { x4752: 'end' }
    }, true).then(flush).then(function () {
        assertEqual(seen && seen.pinCutIds, ['x4752'],
            'B. #4768: выравнивание получает ЦЕЛЬ действия — задание, которому день выбрал оператор');
        assertEqual(seen && seen.pinDayPosByCut, { x4752: 'end' },
            'B2. и место в дне, которое оператор выбрал (#4464)');
        assert(seen && seen.manualShift, 'B3. право действия (#4736) при этом на месте');
    });
});

// ── C/F. ПРОВОДКА: levelDayLoad ДОНОСИТ ЦЕЛЬ ДО РАСКЛАДКИ ───────────────────────────────────
chain = chain.then(function () {
    function levelSelf() {
        var lvl = Object.create(Controller.prototype);
        lvl.filter = { date: '2026-08-14' };
        lvl.nowMs = function () { return BASE; };
        lvl.cuts = [];
        lvl.overfilledDaysOf = function () { return []; };
        lvl.plannerUnderfilledDays = function () {
            return [{ key: SID + '|0', slitterId: SID, day: 0, freeMin: 300, needMin: 20, donorCutId: 'x4752' }];
        };
        lvl.warnOverfilledDays = function () {};
        lvl.notify = function () {};
        return lvl;
    }
    var manualSeen = null, autoSeen = null;
    var manual = levelSelf();
    manual.autoSequenceQueueAfterMerge = function (s, p, scope) { manualSeen = scope; return Promise.resolve(true); };
    var auto = levelSelf();
    auto.autoSequenceQueueAfterMerge = function (s, p, scope) { autoSeen = scope; return Promise.resolve(true); };

    return manual.levelDayLoad([SID], { manual: true, manualShift: { fromBySlitter: {} },
        unfrozenDayKeys: ['20260817'], pinCutIds: ['x4752'], pinDayPosByCut: { x4752: 'end' } })
        .then(function () { return auto.levelDayLoad([SID], null); })
        .then(flush).then(function () {
            assertEqual(manualSeen && manualSeen.pinCutIds, ['x4752'],
                'C. #4768: раскладка выравнивания знает, какой день выбрал оператор');
            assertEqual(manualSeen && manualSeen.pinDayPosByCut, { x4752: 'end' },
                'C2. вместе с местом в дне');
            assert(manualSeen && !manualSeen.wholeDayCutIds,
                'D2. резерв «целиком» (#4488) в выравнивание не едет — день рвёт задание по потолку (#4693)');
            assert(autoSeen && !autoSeen.pinCutIds && !autoSeen.pinDayPosByCut,
                'F. автоматическое выравнивание цели не выдумывает: без ручного действия её нет');
        });
});

// ── E. ПРИЧИНА В ДВИЖКЕ: ЯКОРЬ ДНЯ И ПОЛ ПАРОВОЗА ───────────────────────────────────────────
// Тот же вход в раскладку с одним отличием — снят ли якорь с самого перенесённого задания.
chain = chain.then(function () {
    var D0 = Math.floor(BASE / 1000) + 8 * 3600, DAY = 86400;
    function engCut(id, o) {
        return { id: id, slitter: { id: SID }, materialId: 'MR192', winding: 'OUT', batchId: 'BMR192',
                 knifeWidths: widths(10, 59), knifeCount: 10, rollerWidth: 60, plannedRuns: o.runs,
                 isFoil: false, status: '', fixed: true, firstPartId: id, startDate: '', endDate: '',
                 planDate: String(D0 + o.day * DAY + (o.min || 0) * 60) };
    }
    function pack(shiftBy) {
        var cuts = [engCut('a14', { day: 0, runs: 6 }), engCut('x4752', { day: 3, runs: 2 }),
                    engCut('b17', { day: 3, min: 60, runs: 20 })];
        var pp = {}, anchor = {}, due = {};
        cuts.forEach(function (c) {
            pp[String(c.id)] = 10; due[String(c.id)] = 30;
            anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
        });
        var ops = planning.planCutOperations(cuts, {
            planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
            dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 930, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
            lunchStartMin: 740, lunchDurationMin: 40, gapFill: true, preserveOrder: true, trainOnly: true,
            slotPlacement: false, firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: true,
            perPassByCut: pp, slitterIds: [SID], dueDayByCut: due, dueKeyByCut: {}, dayAnchorByCut: anchor,
            workedDayForSlitter: function () { return function () { return false; }; },
            manualShiftByCut: shiftBy
        });
        var day = null;
        (ops.updates || []).forEach(function (u) {
            if (String(u.cutId) === 'x4752') day = Math.floor((Number(u.planStartTs) * 1000 - BASE) / 86400000);
        });
        return day;
    }
    // Хвост уступает ручному сдвигу — перенесённое из него ИСКЛЮЧЕНО (это и делает цель действия).
    assertEqual(pack({ a14: true, b17: true }), 3,
        'E. с якорем дня перенесённое задание остаётся в дне оператора');
    // Тот же вход, но якорь снят и с самого перенесённого — воспроизведение боевого 14.08.
    assertEqual(pack({ a14: true, b17: true, x4752: true }), 0,
        'E2. воспроизведение: без якоря оно падает на пол паровоза — первый день после отработанного (#4743)');
});

chain.then(function () {
    console.log('\n' + passed + '/' + total + ' проверок прошли');
    if (passed !== total) process.exitCode = 1;
}).catch(function (e) {
    console.error('ОШИБКА:', e && e.stack || e);
    process.exitCode = 1;
});
