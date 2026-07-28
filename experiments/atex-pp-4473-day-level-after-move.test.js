// Tests for ideav/crm#4473 — «День не должен превышать 450 минут + нахлест (460 минут максимум)».
//
// ПРАВИЛО (ТЗ §15, DAY_CAPACITY, #4467): станко-день ≤ ёмкость смены + нахлёст. Новое здесь —
// путь РУЧНОГО ПЕРЕМЕЩЕНИЯ обязан это правило соблюсти: после ↑↓/drag (и по кнопке «↻ Пересчитать
// наладку») день ВЫРАВНИВАЕТСЯ — задание в конце дня рвётся по потолку, остаток уезжает
// продолжением на следующий день.
//
// ДО ПРАВКИ: авто-пересчёт после перестановки (#4434 п.3 → recalcSetupTiming) только пересобирал
// старты ВНУТРИ дня (#4408: «за пределы дня не выносим») и ПРЕДУПРЕЖДАЛ: «Не помещается в смену…
// перенесите лишнее вручную». Журнал задачи (ideav.ru-1785266889853.log):
//
//   AtexProductionPlanning.reorderCutInDay → recalcSetupTiming → warnOverfilledDays
//   [pp] #4408: день переполнен после пересборки стартов {slitterId: '1279', days: Array(2)}
//
// — и оператор видел «Вт, 28.07.2026 (484 мин)» при потолке 460.
//
// Run with: node experiments/atex-pp-4473-day-level-after-move.test.js

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

var chain = Promise.resolve();

// ── 1) ПРАВИЛО: упаковщик, которому отдали ручной порядок, кладёт день под потолок ───────────
chain = chain.then(function () {
    var self = makeSelf(overfilledFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    assertEqual(storedLoadByDay(self), { 0: 501 },
        'фикстура повторяет журнал: хранимый день 0 длиннее смены (501 мин при потолке ' + CEILING + ')');

    var built = self.buildSequenceOps(self.cuts, 'setup', true, { withinSlitterIds: [SID] });
    var load = (built.ops && built.ops.dayLoad) || {};
    var over = Object.keys(load).filter(function (k) { return Number(load[k]) > CEILING + 1e-6; });
    assertEqual(over, [], 'ни один станко-день кандидата не превышает потолок (' + JSON.stringify(load) + ')');
    assert((built.ops.creates || []).length === 1, 'хвост дня разорван по потолку — ровно одно продолжение',
        '(' + (built.ops.creates || []).length + ')');
});

// ── 2) ПУТЬ: ручное перемещение выравнивает день, а не предупреждает о нём ────────────────────
chain = chain.then(function () {
    var self = makeSelf(overfilledFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    return self.recalcSetupTiming(SID, { auto: true }).then(flush).then(function () {
        assert(self.applied.length === 1, '#4473: день выровнен упаковщиком (план разбиения записан)',
            '(вызовов applySplitPlan: ' + self.applied.length + ')');
        var ops = self.applied[0] || { updates: [], creates: [] };
        var runsById = {};
        (ops.updates || []).forEach(function (u) { runsById[String(u.cutId)] = Number(u.plannedRuns); });
        var created = (ops.creates || [])[0] || null;
        assert(!!created, 'остаток проходов уехал ПРОДОЛЖЕНИЕМ на следующий день, а не пропал');
        if (created) {
            assertEqual(String(created.parentCutId), 'C', 'разорвано последнее задание дня (C), а не чужое');
            assertEqual(Number(runsById['C']) + Number(created.plannedRuns), 32,
                'проходы не потеряны: голова + продолжение = исходные 32');
            assert(dayOffOf(created.planStartTs) === 1, 'продолжение стои́т на следующем дне',
                '(день ' + dayOffOf(created.planStartTs) + ')');
        }
        // Порядок оператора выравнивание не переставляет; продолжение (S1) идёт сразу за своей головой.
        var tsById = {};
        self.cuts.forEach(function (c) { tsById[String(c.id)] = Number(c.planDate); });
        assertEqual(Object.keys(tsById).sort(function (a, b) { return tsById[a] - tsById[b]; }),
            ['A', 'B', 'C', 'S1'], 'порядок заданий (preserveOrder) сохранён: A → B → C → продолжение C');
        // Итог — то, что увидит оператор в бейдже «(N мин)»: день влезает в смену.
        var after = storedLoadByDay(self);
        Object.keys(after).forEach(function (d) {
            assert(after[d] <= CEILING, 'после выравнивания день ' + d + ' ≤ потолка',
                '(' + after[d] + ' при потолке ' + CEILING + ')');
        });
        assert(self.notes.filter(function (n) { return /перенесите лишнее вручную/.test(n.msg); }).length === 0,
            'оператору больше не предлагают разгружать день руками');
        assert(self.notes.filter(function (n) { return /выровнен/.test(n.msg); }).length === 1,
            'о выравнивании дня сказано вслух');
    });
});

// ── 3) ИДЕМПОТЕНТНОСТЬ: день в норме → ручное перемещение ничего не пересобирает ──────────────
chain = chain.then(function () {
    var self = makeSelf([cut('A', { mat: 'MW411', knives: 15, width: 59, runs: 20 }),
                         cut('B', { mat: 'MR194', knives: 10, width: 88, runs: 20 })]);
    materializeStoredPlan(self, { A: 0, B: 0 });
    var load = storedLoadByDay(self);
    assert(load[0] < CEILING, 'фикстура: день в норме (' + load[0] + ' мин)');
    return self.recalcSetupTiming(SID, { auto: true }).then(flush).then(function () {
        assertEqual(self.applied.length, 0, '#4473: согласованный день упаковщиком не пересобирается');
        assertEqual(self.writes.length, 0, 'ни одной записи в БД');
    });
});

// ── 4) ГРАНИЦА: у переполненного дня выравнивание идёт, даже когда тайминг и старты СОШЛИСЬ ───
// (перестановка соседей одинаковой длины расхождений не даёт — прежний код в этом случае
//  отвечал «наладка уже актуальна» и уходил, оставляя день на 484 минуты).
chain = chain.then(function () {
    var self = makeSelf(overfilledFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    var stale = self.computeCutSetupUpdates(null, { dryRun: true }).updates || [];
    var starts = self.recalcStartUpdates(SID);
    assertEqual([stale.length, starts.length], [0, 0], 'фикстура: пересчитывать в колонках и стартах нечего');
    return self.recalcSetupTiming(SID, { auto: true }).then(flush).then(function () {
        assert(self.applied.length === 1, '#4473: день всё равно выровнен — потолок важнее «нечего пересчитывать»');
        assert(self.notes.filter(function (n) { return /уже актуальна/.test(n.msg); }).length === 0,
            'ответ «наладка уже актуальна» переполненному дню больше не даётся');
    });
});

// ── 5) ЗАМОРОЖЕННЫЙ ДЕНЬ (#4436) старше выравнивания: переполнен — но не наш ──────────────────
// «Заморозка» значит «этот день не меняем»: ни пересчёт наладки, ни выравнивание в него не лезут.
// Разгружает такой день оператор — сняв замок (🔓) и пересчитав.
chain = chain.then(function () {
    var self = makeSelf(overfilledFixture());
    materializeStoredPlan(self, { A: 0, B: 0, C: 0 });
    self.meta.freeze = { id: '2' };
    var d = new Date(BASE);
    self.freezeByDay[d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()] = { id: 'f0', notes: '' };
    assertEqual(self.overfilledDaysOf(SID), [], 'замороженный день в набор выравнивания не входит');
    return self.recalcSetupTiming(SID, { auto: true }).then(flush).then(function () {
        assertEqual(self.applied.length, 0, '#4436: в замороженный день выравнивание не лезет');
        assertEqual(self.writes.length, 0, 'ни одной записи в замороженный день');
    });
});

chain.then(function () {
    console.log('\n' + passed + '/' + total + ' passed');
}).catch(function (e) {
    console.error('FAIL — исключение:', e && e.stack || e);
    process.exitCode = 1;
});
