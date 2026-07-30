// Tests for ideav/crm#4519 — день, распухший после РУЧНОГО ПЕРЕНОСА, выравнивается САМ.
//
// ПРАВИЛО (ТЗ §15): когда оператор переносит задание в день и последнее задание помещается не
// целиком — его надо разбить по потолку и остаток перенести на следующий день. Не «нажмите
// Упорядочить», а сразу.
//
// СИМПТОМ (боевое, Пн 03.08.2026): после переноса день показывает 757 мин при потолке 460 —
// последним стои́т задание на 200 проходов (685 мин), оно не разбито. Разрыв умеет `levelDayLoad`
// (#4473), но звался он только из «↻ Пересчитать наладку»; путь переноса 🗓 заканчивался молча.
//
// ШЛЮЗ: `autoSequenceQueueAfterMerge` — общая точка ВСЕХ путей («Сгенерировать», «Упорядочить»,
// «Пересчитать наладку», перенос 🗓, ↑↓, перетаскивание). Оба её выхода (план записан / писать
// нечего) обязаны оставить день в пределах смены. Рекурсии нет: выравнивание пишет тем же путём,
// на время его работы стои́т флаг.
//
// Run with: node experiments/atex-pp-4519-level-after-move.test.js

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

// Смена как на стенде: 08:00–16:30, буфер уборки 20 (потолок резки 16:10), обед 12:20×40 →
// ёмкость 450 мин, нахлёст настройки 10 → ПОТОЛОК ДНЯ 460 (ровно то число из заголовка задачи).
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10',
    SLOT_PLACEMENT: '1' };
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 1.8 };            // проход 300 м = намотка 1.8 + лидер 2.0 = 3.8 мин
var PER_PASS = 3.8;
var CAPACITY = 450, CEILING = CAPACITY + 10;   // ёмкость и потолок дня (нахлёст настройки)
var SID = '1279';
var BASE = new Date(2026, 6, 28, 0, 0, 0, 0).getTime();   // Вт 28.07.2026 — день из журнала
var DAY_START = 480, LUNCH_START = 740, LUNCH_DUR = 40;
var PACK = { dayStartMin: DAY_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR, blocked: [] };

function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function tsAt(dayOff, minute) { return Math.floor(BASE / 1000) + dayOff * 86400 + minute * 60; }
function dayOffOf(tsSec) { return Math.floor(Math.round((Number(tsSec) * 1000 - BASE) / 60000) / 1440); }
function minOf(tsSec) { var m = Math.round((Number(tsSec) * 1000 - BASE) / 60000); return ((m % 1440) + 1440) % 1440; }

// Задание: своя конфигурация (сырьё + ножи) → между соседями и ножи (30), и смена сырья (15).
function cut(id, o) {
    o = o || {};
    return { id: id, orderId: 'O' + id, firstPartId: id,
        slitter: { id: SID, label: 'Станок 2' },
        materialId: o.mat, winding: 'OUT', batchId: 'B' + o.mat,
        knifeWidths: widths(o.knives || 15, o.width || 59), knifeCount: o.knives || 15,
        rollerWidth: 60, plannedRuns: o.runs, isFoil: false, length: 300, status: '',
        startDate: '', endDate: '', fixed: !!o.fixed,
        // «Длительность, минут» — намотка задания (целая, #3635 п.4): 1.8 мин × проходов.
        planDate: '', number: '', duration: String(Math.ceil(1.8 * o.runs)),
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}

function makeSelf(cuts) {
    var self = Object.create(Controller.prototype);
    self.cuts = cuts;
    self.changeTimes = TIMES; self.opTimes = OP_TIMES; self.daySettings = DAY_SETTINGS;
    self.filter = { slitter: '', status: '', date: '2026-07-28', dateTo: '2026-08-09', query: '' };
    self.supplies = []; self.genPositions = []; self.positions = [];
    self.footageBySupply = {}; self.positionLengthById = {}; self.consumptionByCut = {};
    self.jumboWidthByMaterial = {}; self.nominalWidthByMaterial = {}; self.actualWidthIndex = null;
    self.genBatches = []; self.slitters = [{ id: SID, label: 'Станок 2' }];
    self.downtimesBySlitter = {}; self.calendarByDay = {}; self.freezeByDay = {};
    self.prevSetupBySlitter = {};
    self.meta = { cut: { id: '1078', reqs: [
        { id: '96067', val: 'Наладка ножей, мин' },
        { id: '96069', val: 'Сырье/намотка, мин' },
        { id: '96778', val: 'Резка и Лидер' }
    ] }, calendar: { id: '1' }, freeze: null };
    self.nowMs = function () { return BASE; };
    self.busy = false;
    self.writes = [];
    self.post = function (url, fields) { self.writes.push({ url: url, fields: fields }); return Promise.resolve({ obj: '1' }); };
    self.reload = function () { return Promise.resolve(); };
    self.render = function () {}; self.renderLink = function () {};
    self.setBusy = function (v) { self.busy = !!v; };
    self.showProgress = function () {}; self.hideProgress = function () {}; self.updateProgress = function () {};
    self.notes = [];
    self.notify = function (m, k) { self.notes.push({ msg: m, kind: k }); };
    // Писать план в тесте нечем (нет метаданных «Партии ГП»/«Обеспечения»), поэтому applySplitPlan
    // ПОДМЕНЁН симуляцией: операции применяются к очереди в памяти, затем колонки тайминга и старты
    // пересобираются — ровно то, что делает настоящая запись (persistCutSetupColumns +
    // reconcilePlanStarts + reload). Так проверяем не «что решили записать», а ЧТО ПОЛУЧИЛОСЬ.
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

// Симуляция записи плана: updates → «Дата план»/проходы/длительность сегмента, creates → запись-
// продолжение (та же конфигурация, «ID первой части» головы, #3892), deletes → снос записи.
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
        seg.id = 'S' + (i + 1);
        seg.firstPartId = parent.firstPartId || String(parent.id);
        seg.plannedRuns = Number(cr.plannedRuns);
        seg.duration = String(Math.ceil(1.8 * Number(cr.plannedRuns)));
        seg.planDate = String(cr.planStartTs); seg.number = String(cr.planStartTs);
        self.cuts.push(seg);
    });
    var dead = {}; ((ops && ops.deletes) || []).forEach(function (id) { dead[String(id)] = true; });
    self.cuts = self.cuts.filter(function (c) { return !dead[String(c.id)]; });
}

// Хранимые колонки тайминга = расчёт по очереди (как после «Пересчитать наладку»), старты —
// встык тем же repackDayWindowStarts, которым их пересобирает контроллер (#4408). То есть на
// вход правилу подаётся СОГЛАСОВАННЫЙ день: единственная его беда — он длиннее смены.
// dayOffByCut не задан → день берём из уже проставленной «Даты план».
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
// Занятость станко-дня по ХРАНИМЫМ колонкам — ровно то число, что стои́т в бейдже «(N мин)».
function storedLoadByDay(self) {
    var out = {};
    self.cuts.forEach(function (c) {
        var d = dayOffOf(c.planDate);
        out[d] = Math.round(((out[d] || 0) + Number(c.storedKnifeSetupMin) + Number(c.storedMaterialWindingMin)
            + Number(c.storedCutAndLeaderMin)) * 100) / 100;
    });
    return out;
}
function flush() {
    var p = Promise.resolve();
    for (var i = 0; i < 60; i++) p = p.then(function () {});
    return p;
}

// Три задания разной конфигурации по 32 прохода: 3 × (32 × 3.8) + 30 (ножи первого) + 2 × 45
// (ножи + смена сырья) = 484.8 мин при потолке 460 — день из журнала («484 мин»).
function overfilledFixture() {
    return [cut('A', { mat: 'MW411', knives: 15, width: 59, runs: 32 }),
            cut('B', { mat: 'MR194', knives: 10, width: 88, runs: 32 }),
            cut('C', { mat: 'MWR200', knives: 6, width: 147, runs: 32 })];
}


// День со скриншота: короткое задание + среднее + длинное последнее (200 проходов ≈ 685 мин).
// Вместе — далеко за потолком: ровно то, что оператор увидел как «757 мин».
// Три задания разной конфигурации по 32 прохода: хранимый день = 501 мин при потолке 460, и
// это ровно тот случай, где упаковщику «менять нечего» (его собственная раскладка совпала с
// хранимой) — путь переноса заканчивался молча, а день оставался распухшим.
function movedFixture() {
    return [cut('A', { mat: 'MW411', knives: 15, width: 59, runs: 32 }),
            cut('B', { mat: 'MR194', knives: 10, width: 88, runs: 32 }),
            cut('C', { mat: 'MWR200', knives: 6, width: 147, runs: 32, fixed: true })];
}
// Сценарий ручного переноса 🗓: перенесённое задание приколото в день ЦЕЛИКОМ (#4488).
var MOVE_SCOPE = { withinSlitterIds: [SID], wholeDayCutIds: ['C'], pinCutIds: ['C'] };

var chain = Promise.resolve();

// ── 1) Фикстура повторяет журнал: хранимый день длиннее смены ────────────────────────────────
chain = chain.then(function () {
    var self = makeSelf(movedFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    var load = storedLoadByDay(self);
    assert((load[0] || 0) > CEILING, 'фикстура: день 0 распух после переноса',
        '(' + Math.round(load[0] || 0) + ' мин при потолке ' + CEILING + ')');
});

// ── 2) ПРАВИЛО: после переноса день выравнивается САМ ────────────────────────────────────────
chain = chain.then(function () {
    var self = makeSelf(movedFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    return self.autoSequenceQueueAfterMerge('setup', true, MOVE_SCOPE).then(flush).then(function () {
        var after = storedLoadByDay(self);
        Object.keys(after).forEach(function (d) {
            assert(after[d] <= CEILING, 'после выравнивания день ' + d + ' ≤ потолка',
                '(' + Math.round(after[d]) + ')');
        });
        // Что именно уехало — решает упаковщик (перенесённое C приколото целиком, #4488), поэтому
        // проверяем СВОЙСТВО: день в потолке, работа не потеряна, часть уехала на следующий день.
        var runsTotal = self.cuts.reduce(function (s, c) { return s + Number(c.plannedRuns); }, 0);
        assertEqual(runsTotal, 96, 'проходы не потеряны: 3 × 32 = 96 на всех днях');
        assert(dayOffOf(self.cuts.filter(function (c) { return String(c.id) === 'C'; })[0].planDate) === 0,
            'перенесённое задание осталось в дне переноса (#4488)');
        var used = Object.keys(storedLoadByDay(self)).map(Number).sort(function (a, b) { return a - b; });
        assert(used.length > 1 && used[used.length - 1] > 0, 'часть работы уехала на следующий день',
            '(занятые дни: ' + used.join(',') + ')');
    });
});

// ── 3) ШЛЮЗ: путь переноса зовёт выравнивание, когда ХРАНИМЫЙ день сверх потолка ────────────
// Упаковщик мерит СВОИМИ числами и часто чинит день сам; дыра была в другом — когда паковать
// нечего (его раскладка совпала с хранимой) или перенесённое приколото целиком, путь заканчивался
// молча. Проверяем именно проводку: детектор переполнения → выравнивание, с тем же станком.
chain = chain.then(function () {
    var self = makeSelf(movedFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    var leveled = [];
    self.overfilledDaysOf = function (sid) { return leveled.length ? [] : [{ dayOffset: 0, overMin: 41 }]; };
    self.levelDayLoad = function (sid) { leveled.push(String(sid)); return Promise.resolve(true); };
    return self.autoSequenceQueueAfterMerge('setup', true, MOVE_SCOPE).then(flush).then(function () {
        assertEqual(leveled, [SID], 'после записи плана выравнивание вызвано для затронутого станка');
    });
});

// ── 4) Тот же шлюз на ВТОРОМ выходе: писать нечего, а день распух ────────────────────────────
chain = chain.then(function () {
    var self = makeSelf([cut('A', { mat: 'MW411', knives: 15, width: 59, runs: 20 })]);
    materializeStoredPlan(self, { A: 0 });
    var leveled = [];
    self.buildSequenceOps = function () { return { ops: { updates: [], creates: [], deletes: [] }, cutsById: {} }; };
    self.overfilledDaysOf = function () { return leveled.length ? [] : [{ dayOffset: 0, overMin: 297 }]; };
    self.levelDayLoad = function (sid) { leveled.push(String(sid)); return Promise.resolve(true); };
    return self.autoSequenceQueueAfterMerge('setup', true, MOVE_SCOPE).then(flush).then(function () {
        assertEqual(leveled, [SID], '«переставлять нечего» — день всё равно выравнивается');
        assertEqual(self.applied.length, 0, 'при этом лишней записи плана не делаем');
    });
});

// ── 5) Рекурсии нет: выравнивание пишет план тем же путём ────────────────────────────────────
chain = chain.then(function () {
    var self = makeSelf(movedFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    var calls = 0;
    self.overfilledDaysOf = function () { return [{ dayOffset: 0, overMin: 41 }]; };   // ВСЕГДА переполнен
    self.levelDayLoad = function (sid) {
        calls++;
        // как настоящий levelDayLoad — пишет план тем же путём
        return self.autoSequenceQueueAfterMerge('setup', true, { withinSlitterIds: [String(sid)] });
    };
    return self.autoSequenceQueueAfterMerge('setup', true, MOVE_SCOPE).then(flush).then(function () {
        assertEqual(calls, 1, 'выравнивание запускается ОДИН раз — второго круга нет даже при вечном переполнении');
        assert(!self._levelingDays, 'флаг выравнивания снят');
    });
});

// ── 6) День в норме — выравнивание не запускается ────────────────────────────────────────────
chain = chain.then(function () {
    var self = makeSelf([cut('A', { mat: 'MW411', knives: 15, width: 59, runs: 20 }),
                         cut('B', { mat: 'MR194', knives: 10, width: 88, runs: 20 })]);
    materializeStoredPlan(self, { A: 0, B: 0 });
    var before = storedLoadByDay(self);
    assert((before[0] || 0) <= CEILING, 'фикстура: день в норме', '(' + Math.round(before[0] || 0) + ' мин)');
    var leveled = 0;
    self.levelDayLoad = function () { leveled++; return Promise.resolve(true); };
    return self.autoSequenceQueueAfterMerge('setup', true, { withinSlitterIds: [SID] }).then(flush).then(function () {
        assertEqual(leveled, 0, 'выравнивание не звалось — выравнивать нечего');
    });
});

chain.then(function () {
    console.log('\n' + passed + '/' + total + ' passed');
    if (passed !== total) process.exitCode = 1;
});
