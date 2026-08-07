// #4469 — ЖЁСТКОЕ ПРАВИЛО (ТЗ §15): день пакуется ДО ПОТОЛКА (ёмкость + нахлёст), а не стоит с дырой.
//
// Сценарий заказчика (ateh1, Ср 29.07.2026): после ручного переноса заданий и «Упорядочить» день
// держит 424 мин при потолке 455, а последнее задание разорвано по дням — 11 проходов сегодня,
// 24 назавтра. В остаток дня влезает ещё 13 проходов продолжения (2.33 мин каждый), но разбиение
// остаётся как есть: «Разбитое на 2 части задание не затягивает максимально возможную часть внутрь
// предыдущего дня».
//
// КОРЕНЬ — тот же, что у #4413 («Отпуск» перед «Упорядочить»): упаковщик день бьёт правильно, но
// РЕШЕНИЕ применять план принимается по объективу «задания в Отпуске → опоздания → переналадка».
// Перетащить проходы завтрашнего задания в хвост сегодняшнего дня не меняет ни того, ни другого →
// objB == before → «ни один кандидат не лучше» → план выброшен, дыра остаётся навсегда.
//
// ФИКС: недоупакованный день — НАРУШЕНИЕ (ТЗ §15, реестр PP_INVARIANTS → DAY_FILL, зеркало
// DAY_CAPACITY #4467) и член объектива «Упорядочить» ниже срока, но выше переналадки.
//
// Run with: node experiments/atex-pp-4469-day-fill.test.js

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

// ── 1. Чистая underfilledLayoutDays: какой день недоупакован ─────────────────────────────
// segs — сегменты ОДНОГО станка; freeMinFor(day) — минуты до потолка резки (availFor(day,'cuts')).
(function () {
    function seg(cutId, day, start, runs, setup, dur, over) {
        var s = { cutId: cutId, dayOffset: day, windowStartMin: day * 1440 + start, runs: runs,
                  setupMin: setup, durationMin: dur };
        for (var k in (over || {})) s[k] = over[k];
        return s;
    }
    // День 0 занят на 424 из 455, день 1 начинает продолжение: 24 прохода по 2.33, наладки нет.
    var layout = [seg('T1', 0, 0, 100, 30, 353), seg('T8', 0, 383, 11, 15, 26),
                  seg('T8', 1, 0, 24, 0, 56, { isContinuation: true, parentCutId: 'T8' })];
    var free = { 0: 31, 1: 399 };
    function freeMinFor(d) { return free[d] != null ? free[d] : 0; }

    var bad = P.underfilledLayoutDays(layout, { freeMinFor: freeMinFor });
    assertEqual(bad.map(function (u) { return u.day; }), [0],
        'день 0 недоупакован: в остаток 31 мин влезает проход продолжения (2.33)');
    assert(bad[0] && String(bad[0].donorCutId) === 'T8', 'назван донор — первое задание следующего дня');
    assert(bad[0] && Math.abs(bad[0].needMin - 56 / 24) < 1e-3, 'нужно ровно один проход донора (наладки у продолжения нет)',
        '(' + (bad[0] && bad[0].needMin) + ')');

    // Остаток меньше одного прохода — дыры нет (проход атомарен, #4149).
    assertEqual(P.underfilledLayoutDays(layout, { freeMinFor: function (d) { return d === 0 ? 2 : 399; } }), [],
        'остаток 2 мин при проходе 2.33 — не нарушение');

    // Донору нужна ещё и наладка: 30 (ножи) + 2.33 не влезают в 31 — не нарушение.
    var withSetup = [seg('T1', 0, 0, 100, 30, 394), seg('N1', 1, 0, 24, 30, 56)];
    assertEqual(P.underfilledLayoutDays(withSetup, { freeMinFor: freeMinFor }), [],
        'наладка донора считается: 30 + 2.33 в 31 мин не влезают');

    // 🔒 замок дня абсолютен (#4434): зафиксированное задание проходов вчерашнему дню не отдаёт.
    var fixedDonor = [seg('T1', 0, 0, 100, 30, 353), seg('T8', 0, 383, 11, 15, 26),
                      seg('F9', 1, 0, 24, 0, 56, { fixedDayLock: true })];
    assertEqual(P.underfilledLayoutDays(fixedDonor, { freeMinFor: freeMinFor }), [],
        '🔒 следующего дня — не донор (замок дня абсолютен, #4434)');

    // Замороженный день автоматика не трогает (#4436) — ни как приёмник, ни как источник.
    assertEqual(P.underfilledLayoutDays(layout, { freeMinFor: freeMinFor, isFrozenDay: function (d) { return d === 0; } }), [],
        'замороженный день ничего не добирает');
    assertEqual(P.underfilledLayoutDays(layout, { freeMinFor: freeMinFor, isFrozenDay: function (d) { return d === 1; } }), [],
        'из замороженного дня ничего не забираем');

    // Последний день отдавать некому.
    assertEqual(P.underfilledLayoutDays([seg('T1', 0, 0, 10, 30, 100)], { freeMinFor: freeMinFor }), [],
        'следующего дня с работой нет — не нарушение');

    // Донор без проходов (setup-only хвост дня, #3635 п.5) отдавать нечего.
    var tailOnly = [seg('T1', 0, 0, 100, 30, 353), seg('S1', 1, 0, 0, 30, 0, { setupOnly: true })];
    assertEqual(P.underfilledLayoutDays(tailOnly, { freeMinFor: freeMinFor }), [],
        'донор без проходов (наладочный хвост) — не нарушение');
})();

// ── 2. Упаковщик день ДОБИВАЕТ: продолжение отдаёт проходы в хвост предыдущего дня ───────
// Регрессия по построению: splitMachineQueue кладёт столько проходов, сколько влезает до потолка.
(function () {
    var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
    var DAY_START = 480, CAP = 450, OVER_CUTS = 5, OVER_TUNE = 10;
    function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
    function cut(id, mat, knives, runs, perPass) {
        return { id: id, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
                 knifeWidths: W(knives[0], knives[1]), knifeCount: knives[1], rollerWidth: 0,
                 plannedRuns: runs, isFoil: false, fixed: false, firstPartId: id, _perPass: perPass };
    }
    function pack(cuts) {
        var perPass = {}, runs = {};
        cuts.forEach(function (c) { perPass[String(c.id)] = c._perPass; runs[String(c.id)] = c.plannedRuns; });
        return P.splitMachineQueue(cuts, {
            dayStartMin: DAY_START, dayEndMin: DAY_START + CAP, dayEndHourMin: DAY_START + CAP,
            maxOverworkCutsMin: OVER_CUTS, maxOverworkTuneMin: OVER_TUNE,
            times: TIMES, perPassByCut: perPass, runsByCut: runs,
            gapFill: true, orderAuthoritative: true, firstCutSetup: true
        });
    }
    // A: 398 мин (наладка ножей 30 + сырьё 15 + 353), затем B — 35 проходов по 2.333 со сменой сырья 15.
    var segs = pack([cut('A', 'MA', [30, 29], 1, 353), cut('B', 'MB', [30, 29], 35, 7 / 3)]);
    var day0 = segs.filter(function (s) { return s.dayOffset === 0; });
    var load0 = day0.reduce(function (sum, s) { return sum + s.setupMin + s.durationMin; }, 0);
    assert(load0 > 450, 'день 0 набит до потолка с нахлёстом, а не брошен с дырой',
        '(' + Math.round(load0 * 100) / 100 + ' при ёмкости 450 и потолке 455)');
    assert(load0 <= 455 + 1e-6, 'потолок нахлёста при этом не пробит (#4467)', '(' + Math.round(load0 * 100) / 100 + ')');
    assert(455 - load0 < 7 / 3, 'ещё один проход B в остаток дня уже не влезает — это и есть «до потолка»',
        '(свободно ' + Math.round((455 - load0) * 100) / 100 + ' при проходе 2.33)');
    var runs0 = day0.filter(function (s) { return String(s.cutId) === 'B'; })
        .reduce(function (sum, s) { return sum + s.runs; }, 0);
    assert(runs0 === 18, 'в день 0 ушло 18 проходов B (398 + 15 наладки + 18×2.333 = 455), остальное — завтра',
        '(' + runs0 + ')');
    // Упаковщик считает недоупаковку своим же гейтом потолка — на своей раскладке нарушений нет.
    assertEqual(segs.underfilled, [], 'сам упаковщик правило не нарушает (#4469)');
})();

// ── 3. Контроллер: planUnderfilledDays видит дыру в ХРАНИМОМ плане и её отсутствие у кандидата ──
var BASE = new Date(2026, 6, 29, 0, 0, 0, 0).getTime();          // «С» = Ср 29.07.2026 (день 0)
function tsAt(dayOffset, minutes) { return Math.floor(BASE / 1000) + dayOffset * 86400 + minutes * 60; }
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '20', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
//  ёмкость дня = (16:30 − 20) − 8:00 − 40 = 450 мин; потолок резки = 455.

function cutOf(id, dayOffset, startMin, runs, setup, work, over) {
    var c = { id: id, orderId: 'ORD' + id, firstPartId: id, slitter: { id: '101', label: 'Станок 2' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: [80, 80], knifeCount: 2, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, status: '', fixed: false,
        planDate: String(tsAt(dayOffset, startMin)), number: String(tsAt(dayOffset, startMin)),
        duration: String(work), storedKnifeSetupMin: '0', storedMaterialWindingMin: String(setup),
        storedCutAndLeaderMin: String(work) };
    for (var k in (over || {})) c[k] = over[k];
    return c;
}
// План со скриншота: день 0 — 383 + 41 = 424 мин, день 1 — продолжение на 24 прохода (56 мин).
function screenshotCuts() {
    return [cutOf('T1', 0, 8 * 60, 100, 30, 353),
            cutOf('T8', 0, 8 * 60 + 383, 11, 15, 26),
            cutOf('T8C', 1, 8 * 60, 24, 0, 56, { firstPartId: 'T8' })];
}
function ctrlSelf(cuts) {
    var self = Object.create(Controller.prototype);
    self.busy = false;
    self.meta = {};
    self.cuts = cuts;
    self.filter = { date: '2026-07-29', dateTo: '2026-07-30' };
    self.slitters = [{ id: '101', label: 'Станок 2' }];
    self.daySettings = DAY_SETTINGS;
    self.changeTimes = { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30, KNIFE: 30, MATERIAL_WINDING: 15 };
    self.supplies = []; self.genPositions = [];
    self.freezeByDay = {}; self.calendarByDay = {}; self.downtimesBySlitter = {};
    self.nowMs = function () { return BASE; };
    return self;
}

(function () {
    var cuts = screenshotCuts();
    var c = ctrlSelf(cuts);
    assertEqual(c.planUnderfilledDays(cuts, null), ['101|20260729'],
        'хранимый план: день 29.07 недоупакован (424 при потолке 455, назавтра продолжение)');

    // Кандидат: 13 проходов продолжения затянуты в день 0 (голова 24, продолжение 11) — дыры нет.
    var ops = { updates: [{ cutId: 'T8', planStartTs: tsAt(0, 8 * 60 + 383), plannedRuns: 24 },
                          { cutId: 'T8C', planStartTs: tsAt(1, 8 * 60), plannedRuns: 11 }],
                creates: [], deletes: [] };
    assertEqual(c.planUnderfilledDays(cuts, ops), [],
        'кандидат добил день до потолка — нарушения нет');

    // 🔒 на ЧУЖОМ завтрашнем задании: замок дня абсолютен (#4434), дыра — не нарушение.
    var fixedCuts = screenshotCuts();
    fixedCuts[2].fixed = true;
    fixedCuts[2].firstPartId = 'T8C';        // отдельное задание, а не продолжение T8
    assertEqual(ctrlSelf(fixedCuts).planUnderfilledDays(fixedCuts, null), [],
        'ЧУЖОЕ завтрашнее задание зафиксировано 🔒 — проходов вчера не отдаёт');

    // #4638: 🔒 на ПРОДОЛЖЕНИИ ТОЙ ЖЕ цепочки (firstPartId = T8, а T8 закрывает день 0) дыру НЕ
    // оправдывает: между днями ничего не переезжает, двигается только точка разбиения. Замок дня
    // (#4434) цел — обе записи остаются на своих датах.
    var fixedCont = screenshotCuts();
    fixedCont[2].fixed = true;
    assertEqual(ctrlSelf(fixedCont).planUnderfilledDays(fixedCont, null), ['101|20260729'],
        '#4638 🔒 на продолжении СВОЕЙ цепочки — день всё равно недоупакован');

    // Единственный день — отдавать нечего.
    var oneDay = [cutOf('T1', 0, 8 * 60, 100, 30, 353)];
    assertEqual(ctrlSelf(oneDay).planUnderfilledDays(oneDay, null), [],
        'следующего дня с работой нет — не нарушение');
})();

// ── 4. runOptimizeQueue: план, добивающий день, ПРИМЕНЯЕТСЯ (до фикса выбрасывался) ──────
function optimizeScenario(cfg) {
    var cuts = cfg.cuts || screenshotCuts();
    var self = ctrlSelf(cuts);
    var notes = [];
    self.setBusy = function () {};
    self.notify = function (msg, kind) { notes.push({ msg: msg, kind: kind }); };
    self.render = function () {};
    self.planChangeoverMin = function () { return 45; };                 // одинаково до и после
    self.planLatenessDays = function () { return 0; };
    self.planDowntimeConflicts = function () { return []; };
    self.computeReassignmentPlan = function () { return { changed: false, slitterByRecordId: {}, slitterReqId: '9' }; };
    self.intraDayImprovementOps = function () { return { updates: [], gainMin: 0 }; };
    self.buildSequenceOps = function () {
        var byId = {}; cuts.forEach(function (c) { byId[String(c.id)] = c; });
        return { ops: cfg.ops, cutsById: byId };
    };
    self.optimizeWindowLabel = function () { return '29.07.2026 – 30.07.2026'; };
    self.fillOptimizeMovesTrace = function () {};
    var preview = null;
    self.startPlanPreview = function (payload) { preview = payload; return true; };
    self.runOptimizeQueue();
    return { preview: preview, notes: notes };
}
var OPS_PACKED = { updates: [{ cutId: 'T8', planStartTs: tsAt(0, 8 * 60 + 383), plannedRuns: 24 },
                             { cutId: 'T8C', planStartTs: tsAt(1, 8 * 60), plannedRuns: 11 }],
                   creates: [], deletes: [] };
var OPS_SAME = { updates: [{ cutId: 'T8', planStartTs: tsAt(0, 8 * 60 + 383), plannedRuns: 11 },
                           { cutId: 'T8C', planStartTs: tsAt(1, 8 * 60), plannedRuns: 24 }],
                 creates: [], deletes: [] };

(function () {
    var r = optimizeScenario({ ops: OPS_PACKED });
    assert(!!r.preview, '#4469: план, добивающий день до потолка, ПОКАЗАН (раньше выбрасывался)');
    assertEqual([r.preview && r.preview.underfilledBefore, r.preview && r.preview.underfilledAfter], [1, 0],
        'в предпросмотре видно, ради чего пересобрали: недоупакованных дней 1 → 0');
    assertEqual([r.preview && r.preview.lateBefore, r.preview && r.preview.lateAfter], [0, 0],
        'опоздания при этом не изменились — решение приняла именно упаковка дня');

    // Контроль: тот же план без дыр — «Упорядочить» по-прежнему ничего не трогает (#4047 цело).
    var oneDay = [cutOf('T1', 0, 8 * 60, 100, 30, 353)];
    var same = optimizeScenario({ cuts: oneDay,
        ops: { updates: [{ cutId: 'T1', planStartTs: tsAt(0, 8 * 60), plannedRuns: 100 }], creates: [], deletes: [] } });
    assert(!same.preview, 'без дыры равные опоздания и переналадка план НЕ двигают');
    assert(same.notes.filter(function (n) { return /оптимальна/.test(n.msg); }).length === 1,
        'и тогда честно сообщаем «очередь уже оптимальна»');
})();

// ── 5. Дыру не удалось закрыть — говорим ПРО УПАКОВКУ ДНЯ, а не «очередь оптимальна» ─────
(function () {
    var r = optimizeScenario({ ops: OPS_SAME });
    assert(!r.preview, 'кандидат оставил день недоупакованным → план не трогаем');
    var warn = r.notes.filter(function (n) { return n.kind === 'warning' && /недоупакован/i.test(n.msg); });
    assert(warn.length === 1, 'предупреждаем именно про недоупакованный день');
    assert(r.notes.filter(function (n) { return /оптимальна/.test(n.msg); }).length === 0,
        '«очередь оптимальна» при дыре в дне не рапортуем');
})();

// ── 6. Инвариант DAY_FILL в общем ШЛЮЗЕ записи (реестр ТЗ §15), а не в обработчике ───────
(function () {
    var ids = P.invariants.map(function (i) { return i.id; });
    assert(ids.indexOf('DAY_FILL') >= 0, 'правило DAY_FILL стоит в реестре PP_INVARIANTS (ТЗ §15)',
        '(' + ids.join(', ') + ')');

    var ops = { updates: [{ cutId: 'T8', planStartTs: tsAt(0, 8 * 60), plannedRuns: 11 }], creates: [], deletes: [] };
    var ctx = { underfilledDays: function () {
        return [{ key: '101|20260729', freeMin: 31, needMin: 2.33, donorCutId: 'T8C' }]; } };
    var viol = P.checkPlanInvariants(ops, ctx, 'auto').filter(function (v) { return v.rule === 'DAY_FILL'; });
    assert(viol.length === 1, 'шлюз ловит недоупакованный день на ЛЮБОМ пути записи');
    assert(viol.length === 1 && /29/.test(viol[0].msg) && /31/.test(viol[0].msg),
        'в сообщении — день и сколько минут пропало', '(' + (viol[0] && viol[0].msg) + ')');

    assertEqual(P.checkPlanInvariants(ops, {}, 'auto').filter(function (v) { return v.rule === 'DAY_FILL'; }), [],
        'нет предиката — правило не срабатывает (конвенция реестра)');
    assertEqual(P.checkPlanInvariants(ops, ctx, 'human').filter(function (v) { return v.rule === 'DAY_FILL'; }), [],
        'ручное действие оператора правилом не ограничено (actor: auto)');
})();

// ── 7. Движок отдаёт данные шлюзу: planCutOperations → ops.dayFill ───────────────────────
(function () {
    var ops = P.planCutOperations([
        { id: 'A', slitter: { id: '101' }, materialId: 'MA', winding: 'OUT', batchId: 'BA',
          knifeWidths: [30, 30], knifeCount: 2, plannedRuns: 1, isFoil: false, firstPartId: 'A' }
    ], {
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 930,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
        times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        perPassByCut: { A: 100 }, planBaseMidnightMs: BASE, gapFill: true
    });
    assert(ops && ops.dayFill != null, 'planCutOperations отдаёт dayFill — как ops.dayLoad для DAY_CAPACITY (#4467)');
    assertEqual(ops && ops.dayFill, [], 'одна резка в одном дне — недоупакованных дней нет');
})();

// ── 8. Сквозной путь: пересборка ПЕРЕРАЗБИВАЕТ задание и добивает день ───────────────────
// Ровно жалоба заказчика: задание уже разорвано по дням (голова 3 прохода сегодня, продолжение 32
// завтра), в остаток дня влезает ещё 7 проходов. buildSequenceOps обязан склеить цепочку
// (mergeContinuationChains) и разрезать её заново по потолку — «сдвигая и всё, что позже».
(function () {
    var WIND = { WIND_300: 3.95 };                                   // 300 м → 3.95 мин на проход
    function pcut(id, dayOffset, startMin, mat, runs, over) {
        var c = { id: id, orderId: 'ORD' + id, firstPartId: id, slitter: { id: '101', label: 'Станок 2' },
            materialId: mat, winding: 'OUT', batchId: 'B' + mat, knifeWidths: [80, 80], knifeCount: 2,
            rollerWidth: 0, plannedRuns: runs, isFoil: false, length: 300, status: '', fixed: false,
            planDate: String(tsAt(dayOffset, startMin)), number: String(tsAt(dayOffset, startMin)) };
        for (var k in (over || {})) c[k] = over[k];
        return c;
    }
    var cuts = [pcut('A', 0, 8 * 60, 'MA', 90),
                pcut('B', 0, 8 * 60 + 401, 'MB', 3),
                pcut('BC', 1, 8 * 60, 'MB', 32, { firstPartId: 'B' })];
    var planSelf = {
        cuts: cuts, changeTimes: { BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30, KNIFE: 30, MATERIAL_WINDING: 15 },
        daySettings: DAY_SETTINGS, opTimes: WIND,
        filter: { date: '2026-07-29', dateTo: '2026-07-30' },
        supplies: [], footageBySupply: {}, genPositions: [],
        slitters: [{ id: '101', label: 'Станок 2' }],
        nowMs: function () { return BASE; },
        workingWindow: Controller.prototype.workingWindow,
        slotPlacementOn: Controller.prototype.slotPlacementOn,
        dayIsWorking: function (ms) { var d = new Date(Number(ms)).getDay(); return d !== 0 && d !== 6; },
        slitterOnVacationDay: function () { return false; },
        planningPrevSetupBySlitter: function () { return {}; },
        blockedRangesBySlitter: function () { return {}; }
    };
    var ops = Controller.prototype.buildSequenceOps.call(planSelf, cuts, 'SETUP', false, null).ops;
    // Сколько проходов ПЛАН ставит в день 0 (обновления + новые сегменты) — было 90 + 3 = 93.
    function runsOnDay(day) {
        var sum = 0;
        (ops.updates || []).concat(ops.creates || []).forEach(function (o) {
            if (Math.floor((Number(o.planStartTs) - tsAt(0, 0)) / 86400) === day) sum += Number(o.plannedRuns) || 0;
        });
        return sum;
    }
    assert(runsOnDay(0) > 93, 'день 0 забрал проходы у завтрашнего задания: было 93, стало больше',
        '(' + runsOnDay(0) + ')');
    assertEqual(runsOnDay(0) + runsOnDay(1), 125, 'проходы целы: 90 + 35 разложены по двум дням');
    assertEqual(ops.dayFill, [], 'после пересборки недоупакованных дней нет (шлюзу нечего ловить)');
})();

console.log('\n' + passed + '/' + total + ' passed');
