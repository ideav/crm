// Tests for ideav/crm#4416 — «Окно пересчёта ничего на самом деле не пересчитывает».
//
// Симптом (issue): добавил задание кнопкой «Добавить вручную» → очередь тут же предлагает
// «↻ Пересчитать наладку», хотя тайминги выглядят правильно; пересчёт ничего заметного не меняет,
// а после F5 предложения нет.
//
// КОРЕНЬ: «ближайшее свободное окно» для нового задания считал LIVE-пересчёт всей очереди станка
// (freeSlotForQueue → buildSchedule): он паковал ВСЕ задания заново от дня 0, игнорируя сохранённые
// planStart. Реальный план растянут по дням (сроки, фиксация, разрывы), поэтому «конец очереди» по
// live-расчёту приходился НЕ туда, где очередь кончается по сохранённому плану, и созданное вручную
// задание вставало ВНУТРИ уже занятого дня — с дырой или нахлёстом. Детектор #4408 честно сообщал
// «день развалился» → кнопка; пересчёт двигал задание на минуты — «ничего не меняет».
//
// ФИКС: окно считается по СОХРАНЁННОМУ плану (#3846) — хвост очереди станка по её же записанным
// planStart + колонкам; правила дня (обед, потолок смены, «Отпуск») — как у упаковщика.
//
// Покрываем:
//   1) чистую freeSlotFromStoredQueue (встык, потолок дня, обед, простой, пустая очередь);
//   2) freeSlotForCut на РАСТЯНУТОМ плане — окно = конец сохранённой очереди, а не live-упаковка;
//   3) сквозной сценарий: создали задание в этом окне → день ЦЕЛ → кнопки «Пересчитать» нет;
//   4) #4416: день с заданием нулевой занятости (Σ=0) больше не блокирует пересборку целиком;
//   5) #4416: детектор насчитал расхождения, а писать нечего → ОШИБКА, а не «уже актуальна».
//
// Run with: node experiments/atex-4416-free-slot-stored.test.js

process.env.TZ = 'UTC';

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
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

var BASE = new Date(2026, 6, 24, 0, 0, 0, 0).getTime();          // день 0 = Пт 24.07.2026
var DAY_START = 8 * 60, CUT_END = 16 * 60 + 15, LUNCH_START = 12 * 60 + 20, LUNCH_DUR = 40;
var SLOT_OPTS = { dayStartMin: DAY_START, dayEndMin: CUT_END, lunchStartMin: LUNCH_START,
    lunchDurationMin: LUNCH_DUR, blocked: [], minStartMin: DAY_START };
function optsWith(over) {
    var o = {}; Object.keys(SLOT_OPTS).forEach(function(k) { o[k] = SLOT_OPTS[k]; });
    Object.keys(over || {}).forEach(function(k) { o[k] = over[k]; });
    return o;
}
function win(startMin, occMin) { return { windowStartMin: startMin, occMin: occMin }; }

// ── 1) Чистая freeSlotFromStoredQueue ───────────────────────────────────────
(function () {
    assertEqual(planning.freeSlotFromStoredQueue([], optsWith({ occMin: 60 })), DAY_START,
        'пустая очередь — окно с начала смены');

    assertEqual(planning.freeSlotFromStoredQueue([win(480, 87), win(567, 53)], optsWith({ occMin: 60 })), 620,
        'очередь кончается в 10:20 → новое задание встык, с 10:20');

    // Не влезает до потолка резки (16:15) → начало следующего дня.
    assertEqual(planning.freeSlotFromStoredQueue([win(480, 400)], optsWith({ occMin: 200 })), 1440 + DAY_START,
        'не влезает в смену → окно на начало следующего дня');

    // Обед: курсор дошёл до 12:20, а в сохранённом дне обеда ещё нет → вставляем один раз.
    assertEqual(planning.freeSlotFromStoredQueue([win(480, 270)], optsWith({ occMin: 60 })), 750 + LUNCH_DUR,
        'курсор после LUNCH_START, обеда в дне нет → окно сдвинуто на обед');

    // Обед уже зашит зазором в сохранённых стартах — второй раз не вставляем (#4132).
    assertEqual(planning.freeSlotFromStoredQueue([win(480, 260), win(780, 60)], optsWith({ occMin: 60 })), 840,
        'обед уже стоит зазором в дне → повторно не вставляем, встык к последнему заданию');

    // «Отпуск» станка перед хвостом очереди — окно за ним.
    assertEqual(planning.freeSlotFromStoredQueue([win(480, 60)], optsWith({ occMin: 60, blocked: [[540, 700]] })), 700,
        'окно простоя обходится — задание встаёт сразу после него');

    // Нерабочий день целиком заблокирован → следующий день.
    assertEqual(planning.freeSlotFromStoredQueue([], optsWith({ occMin: 60, blocked: [[0, 1440]] })), 1440 + DAY_START,
        'день 0 нерабочий → окно на дне 1');
})();

// ── Общий стенд контроллера ─────────────────────────────────────────────────
var K8 = [110, 110, 110, 110, 110, 110, 110, 110];
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var OP_TIMES = { WIND_300: 3.238 };
var DAY_SETTINGS = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
var CUT_TABLE = '1078';

function cutOf(id, dayOff, startMin, runs, knife, material, cutTime, over) {
    var c = { id: id, orderId: 'O' + id, firstPartId: id, slitter: { id: '101', label: 'Станок 3' },
        materialId: 'MW308', winding: 'OUT', knifeWidths: K8, knifeCount: 8, rollerWidth: 0,
        plannedRuns: runs, isFoil: false, length: 300, status: '', fixed: false, startDate: '', endDate: '',
        planDate: String(Math.floor(BASE / 1000) + dayOff * 86400 + startMin * 60),
        number: String(Math.floor(BASE / 1000) + dayOff * 86400 + startMin * 60),
        duration: String(Math.ceil(runs * OP_TIMES.WIND_300)),
        storedKnifeSetupMin: String(knife), storedMaterialWindingMin: String(material),
        storedCutAndLeaderMin: String(cutTime) };
    Object.keys(over || {}).forEach(function(k) { c[k] = over[k]; });
    return c;
}
function makeController(cuts) {
    var c = Object.create(Controller.prototype);
    c.busy = false;
    c.cuts = cuts;
    c.meta = { cut: { id: CUT_TABLE, reqs: [
        { id: '96067', val: 'Наладка ножей, мин' },
        { id: '96069', val: 'Сырье/намотка, мин' },
        { id: '96778', val: 'Резка и Лидер' }
    ] } };
    c.filter = { slitter: '', status: '', date: '2026-07-24', dateTo: '2026-08-06', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 3' }];
    c.activeSlitter = '101';
    c.opTimes = OP_TIMES; c.changeTimes = TIMES; c.daySettings = DAY_SETTINGS;
    c.supplies = []; c.genPositions = []; c.positionLengthById = {};
    c.footageBySupply = {}; c.consumptionByCut = {}; c.jumboWidthByMaterial = {};
    c.downtimesBySlitter = {}; c.calendarByDay = {}; c.freezeByDay = {};
    c.prevSetupBySlitter = {}; c.plannedTailSetup = {};
    c.nowMs = function () { return BASE + 11 * 3600000; };
    c.notes = [];
    c.notify = function (m, k) { c.notes.push({ msg: m, kind: k }); };
    c.render = function () {}; c.renderLink = function () {}; c.setBusy = function () {};
    c.showProgress = function () {}; c.hideProgress = function () {};
    c.posts = [];
    c.post = function (path, fields) { c.posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.reload = function () { return Promise.resolve(); };
    return c;
}
function minutesOf(ts) { return (Number(ts) * 1000 - BASE) / 60000; }
// Растянутый по дням план — как в реальной очереди (по 2 задания в день на 3 дня).
function spreadPlan() {
    return [
        cutOf('A', 0, 480, 8, 30, 15, 42), cutOf('B', 0, 567, 10, 0, 0, 53),
        cutOf('C', 1, 480, 8, 0, 15, 42),  cutOf('D', 1, 537, 10, 0, 0, 53),
        cutOf('E', 2, 480, 8, 0, 15, 42),  cutOf('F', 2, 537, 10, 0, 0, 53)
    ];
}
var PROSPECT = { id: '__new__', plannedRuns: 5, materialId: 'MW308', winding: 'OUT',
    knifeWidths: K8, runLength: 300 };

// ── 2) freeSlotForCut: окно = конец СОХРАНЁННОЙ очереди ─────────────────────
(function () {
    var cuts = spreadPlan();
    var c = makeController(cuts);
    var slot = c.freeSlotForCut('101', PROSPECT);
    assert(!!slot, 'окно рассчитано');
    // Сохранённая очередь кончается в день 2 в 09:50 (537 + 53).
    assertEqual([slot.day, slot.windowStartMin], [2, 2 * 1440 + 590],
        '#4416: окно — встык к концу СОХРАНЁННОЙ очереди (день 2, 09:50), а не в середину занятого дня');
    assertEqual(minutesOf(slot.startTs), slot.windowStartMin, 'startTs соответствует минуте окна');

    // Пустой станок — окно с начала смены дня 0 (прежнее поведение).
    assertEqual(makeController([]).freeSlotForCut('101', PROSPECT).windowStartMin, DAY_START,
        'пустой станок — окно с 08:00 дня 0');
})();

// ── 3) Сквозняк: созданное в этом окне задание НЕ ломает день ───────────────
(function () {
    var cuts = spreadPlan();
    var c = makeController(cuts);
    var slot = c.freeSlotForCut('101', PROSPECT);

    // createCutForPosition пишет главным значением именно slot.startTs.
    var created = cutOf('NEW', 0, 0, PROSPECT.plannedRuns, slot.setupMin,
        0, slot.durationMin, { planDate: String(slot.startTs), number: String(slot.startTs) });
    created.storedKnifeSetupMin = String(slot.setupMin);
    created.storedMaterialWindingMin = '0';
    created.storedCutAndLeaderMin = String(slot.durationMin);
    var withNew = cuts.concat([created]);
    var c2 = makeController(withNew);
    assertEqual(c2.recalcStartUpdates('101', { updates: [] }), [],
        '#4416: после ручного добавления день ЦЕЛ — пересобирать старты нечего');

    // Контроль: то же задание, поставленное «как раньше» (в середину занятого дня 0), день ломает.
    var wrong = cutOf('NEW', 0, 850, PROSPECT.plannedRuns, slot.setupMin, 0, slot.durationMin);
    var c3 = makeController(cuts.concat([wrong]));
    assert(c3.recalcStartUpdates('101', { updates: [] }).length > 0,
        'контроль: задание в середине занятого дня — день разваливается (детектор сработал бы)');
})();

// ── 4) Задание нулевой занятости больше не блокирует пересборку дня ─────────
(function () {
    // День 0: A (87 мин) + осиротевший setup-сегмент Σ=0 + задание с наездом.
    var zero = cutOf('Z', 0, 567, 0, 0, 0, 0, { plannedRuns: 0, duration: '0' });
    var overlap = cutOf('X', 0, 500, 10, 0, 0, 53);   // наезд на A (A занимает 08:00–09:27)
    var c = makeController([cutOf('A', 0, 480, 8, 30, 15, 42), zero, overlap]);
    var ops = c.recalcStartUpdates('101', { updates: [] });
    assert(ops.length > 0, '#4416: Σ=0 в дне больше не отменяет пересборку (раньше день пропускался целиком)');
    assert(ops.filter(function (o) { return o.cutId === 'X'; }).length === 1, 'наехавшее задание переставлено');

    // А вот когда занятости нет НИ У КОГО (колонок тайминга в таблице нет) — день не трогаем.
    var noCols = makeController([cutOf('P', 0, 480, 8, 0, 0, 0), cutOf('Q', 0, 480, 8, 0, 0, 0)]);
    noCols.cuts.forEach(function (x) { x.duration = ''; x.storedCutAndLeaderMin = ''; });
    var warns = [], origWarn = console.warn;
    console.warn = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
    var none = noCols.recalcStartUpdates('101', { updates: [] });
    console.warn = origWarn;
    assertEqual(none, [], 'мерить нечем → день не трогаем');
    assert(warns.filter(function (w) { return w.indexOf('#4416') !== -1; }).length === 1, 'и говорим об этом в консоли');
})();

// ── 5) Детектор показал расхождения, а писать нечего → ОШИБКА, не «актуальна» ──
// Очередь приводим в полный порядок (колонки = расчёту, старты — встык): писать нечего.
function syncQueue(c) {
    c.computeCutSetupUpdates(null);   // колонки — к расчёту (в памяти)
    c.recalcStartUpdates('101', { updates: [] }).forEach(function (o) {
        var cut = c.cuts.filter(function (x) { return String(x.id) === o.cutId; })[0];
        if (cut) { cut.planDate = String(o.ts); cut.number = String(o.ts); }
    });
}
(function () {
    var c = makeController(spreadPlan());
    syncQueue(c);
    assertEqual(c.computeCutSetupUpdates(c.recalcScopeCutIds('101'), { dryRun: true }).updates, [],
        'стенд: колонки актуальны');
    assertEqual(c.recalcStartUpdates('101', { updates: [] }), [], 'стенд: старты актуальны');
    c.recalcMismatchIds = function () { return ['A', 'B']; };   // кнопка на экране показывает 2
    var errs = [], origErr = console.error;
    console.error = function () { errs.push(Array.prototype.slice.call(arguments).join(' ')); };
    c.recalcSetupTiming('101');
    console.error = origErr;
    var msgs = c.notes.map(function (n) { return n.kind + ': ' + n.msg; }).join(' | ');
    assert(/error: Пересчитывать нечего, хотя расхождений насчитано 2/.test(msgs),
        '#4416: противоречие «кнопка есть, писать нечего» показываем ошибкой');
    assert(!/уже актуальна/.test(msgs), '«наладка уже актуальна» в этом случае не говорим');
    assert(errs.filter(function (e) { return e.indexOf('#4416') !== -1; }).length === 1,
        'детали противоречия — в консоли');
    assertEqual(c.posts.length, 0, 'в БД при этом ничего не пишем');

    // Контроль: расхождений нет и детектор молчит → обычное «уже актуальна».
    var ok = makeController(spreadPlan());
    syncQueue(ok);
    ok.recalcMismatchIds = function () { return []; };
    ok.recalcSetupTiming('101');
    assert(ok.notes.filter(function (n) { return /уже актуальна/.test(n.msg); }).length === 1,
        'когда расхождений нет — прежний спокойный ответ');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
