// #4312 — «дыра в полчаса» после первого задания дня ВЕРНУЛАСЬ после фикса #4300.
//
// Реальные данные ateh (22.07.2026, Станок 3): № 1 стоит 08:00–09:06 (66 мин, хранимая наладка 0),
// № 2 — только с 09:36. Между ними пустые 30 минут: упаковщик зарядил первой резке окна переналадку
// от prev_cut_setup (ножи — 30 мин), а хранимые колонки посчитали её near-zero (вчера станок резал ту
// же конфигурацию) → planStart следующего задания уехал на 30 мин вперёд относительно нарисованного
// конца первого. Механика та же, что в #4300; не сработало ВОССТАНОВЛЕНИЕ заправки.
//
// Корень: #4300 искал заправку только среди резок, вырезанных из planInput механизмом #4294
// (prevSetupFromExcludedCuts = planInput ∩ keepIds). Мимо проходят два живых случая:
//   • вчерашняя резка «Завершён» — она ЕСТЬ в keepIds (cutsBeforeWindowToKeep смотрит все резки),
//     но её НЕТ в planInput (фильтр по статусу применяется раньше) → заправка не найдена;
//   • вчерашняя резка в ЗАФИКСИРОВАННОЙ (🔒) цепочке — cutsBeforeWindowToKeep её намеренно не
//     возвращает (день такой цепочки держит движок) → keepIds пуст, переопределения нет вовсе.
// В обоих случаях prevSetupBySlitter остаётся из prev_cut_setup — и дыра возвращается.
//
// Фикс: prevSetupBeforeWindow(cuts, base) берёт заправку из ПОСЛЕДНЕГО задания станка раньше «С» по
// ВСЕЙ его очереди (groupBySlitter: день → planStart — тот же порядок, в котором считает колонки
// computeCutSetupUpdates), независимо от статуса и замка.
//
// Run with: node experiments/atex-production-planning-4312.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 };
function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
var BASE = midnight(2026, 7, 22);                       // «С» = 22.07 (день 0)
var D20 = midnight(2026, 7, 20), D21 = midnight(2026, 7, 21), D22 = midnight(2026, 7, 22);

// Заправка из отчёта prev_cut_setup — СТАРАЯ конфигурация (последняя физически начатая резка):
// то же сырьё, но другие ножи → changeover(STALE, первая резка) = 30 мин, ровно «полчаса» из issue.
var STALE = { materialId: 'MWR113L', winding: 'OUT', knifeWidths: [80], knifeCount: 1 };
var K8 = [110, 110, 110, 110, 110, 110, 110, 110];

function cut(id, dayMs, mat, kw, runs, o) {
    o = o || {};
    return { id: id, firstPartId: o.fp != null ? o.fp : id, slitter: { id: o.m || 'm3' },
        materialId: mat, winding: 'OUT', batchId: '', knifeWidths: kw, knifeCount: kw.length,
        rollerWidth: 0, plannedRuns: runs, isFoil: false, length: 100, orderId: 'O_' + id,
        planDate: String(Math.floor((dayMs + 8 * 3600000 + (o.minute || 0) * 60000) / 1000)),
        duration: String(runs * 22), status: o.status || '', fixed: !!o.fixed };
}

// ── 1) prevSetupBeforeWindow: заправка = последнее задание станка РАНЬШЕ «С» ─────────────────────
(function () {
    var Y = cut('Y', D21, 'MWR113L', K8, 3);
    var T1 = cut('T1', D22, 'MW308', [95], 3);
    eqo(planning.prevSetupBeforeWindow([Y, T1], BASE).m3,
        // #4314: dayOffset — день, который заправка описывает (правило сброса наладки после отпуска).
        { materialId: 'MWR113L', winding: 'OUT', knifeWidths: K8, knifeCount: 8, dayOffset: -1 },
        '#4312: заправка станка = конфигурация вчерашнего задания (MWR113L, ножи 110×8)');

    // Несколько прошлых дней — берём ПОСЛЕДНЕЕ по очереди станка (день → planStart).
    var Old = cut('Old', D20, 'MR300', [70], 1);
    eqo(planning.prevSetupBeforeWindow([Old, Y, T1], BASE).m3.materialId, 'MWR113L',
        '#4312: при нескольких прошлых днях берём позднейшее задание (21.07 MWR113L, не 20.07 MR300)');

    // Статус и замок на заправку не влияют — ножи и сырьё физически остаются на станке.
    eqo(planning.prevSetupBeforeWindow([cut('Yz', D21, 'MWR113L', K8, 3, { status: 'Завершён' }), T1], BASE).m3.materialId,
        'MWR113L', '#4312: вчерашняя резка «Завершён» тоже даёт заправку');
    eqo(planning.prevSetupBeforeWindow([cut('Yf', D21, 'MWR113L', K8, 3, { fixed: true }), T1], BASE).m3.materialId,
        'MWR113L', '#4312: вчерашняя ЗАФИКСИРОВАННАЯ 🔒 резка тоже даёт заправку');

    // Нет заданий раньше «С» → станка в ответе нет (остаётся prev_cut_setup).
    eqo(planning.prevSetupBeforeWindow([T1], BASE), {}, '#4312: нет заданий раньше «С» → {} (заправку не трогаем)');
    eqo(planning.prevSetupBeforeWindow([], BASE), {}, '#4312: пустой список → {}');
    eqo(planning.prevSetupBeforeWindow(null, BASE), {}, '#4312: null-список → {}');
    eqo(planning.prevSetupBeforeWindow([Y, T1], NaN), {}, '#4312: нечисловая база → {} (день не определить)');
    // Задание без «Даты план» (новое) прошлым днём не считается.
    var NoDate = { id: 'N', firstPartId: 'N', slitter: { id: 'm3' }, materialId: 'MR999', winding: 'OUT',
        knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, planDate: '', duration: '10', status: '' };
    eqo(planning.prevSetupBeforeWindow([NoDate, T1], BASE), {}, '#4312: пустая «Дата план» → не заправка');
})();

// ── 2) Инвариант «нет дыры» на полном пути: planCutOperations vs хранимые колонки ────────────────
// Повторяем то, что делают buildSequenceOps (упаковщик) и computeCutSetupUpdates (колонки), и меряем
// зазор между нарисованными окнами: [planStart; planStart + колонки + намотка] — как рисует очередь
// (scheduleFromStored) и Гант.
function gapAfterFirstTask(yesterdayOpts, useFix) {
    var Y = cut('Y', D21, 'MWR113L', K8, 3, yesterdayOpts);            // вчера: та же конфигурация, что T1
    var T1 = cut('T1', D22, 'MWR113L', K8, 3, { minute: 0 });          // первое задание окна: наладки нет
    var T2 = cut('T2', D22, 'MW308', [95, 95, 95, 95], 4, { minute: 100 });
    var all = [Y, T1, T2];

    // — как buildSequenceOps —
    var planInput = all.filter(function (c) { return String(c.status || '').trim() !== 'Завершён'; });
    var prevSetupBySlitter = { m3: STALE };                            // #3853: заправка из prev_cut_setup
    if (useFix) {                                                       // #4312
        var carry = planning.prevSetupBeforeWindow(all, BASE);
        Object.keys(carry).forEach(function (sid) { prevSetupBySlitter[sid] = carry[sid]; });
    }
    var keepIds = planning.cutsBeforeWindowToKeep(all, BASE);           // #4294
    var keepSet = {}; keepIds.forEach(function (id) { keepSet[String(id)] = true; });
    planInput = planInput.filter(function (c) { return !keepSet[String(c.id)]; });

    var perPass = {}, dueDay = {}, dueKey = {}, anchor = {};
    all.forEach(function (c) {
        perPass[c.id] = 22; dueDay[c.id] = 9; dueKey[c.id] = 20260731;
        if (c.fixed) anchor[c.id] = Math.round((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var ops = planning.planCutOperations(planInput, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 990, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: false, firstCutSetup: true,
        prevSetupBySlitter: prevSetupBySlitter, intraDayResequence: false, slotPlacement: false,
        perPassByCut: perPass, slitterIds: ['m3'], dueDayByCut: dueDay, dueKeyByCut: dueKey, dayAnchorByCut: anchor
    });

    // — как computeCutSetupUpdates: колонки по ВСЕЙ группе станка (self.cuts), заправка — prev_cut_setup —
    var arr = planning.groupBySlitter(all)[0].cuts;
    var cols = planning.setupActivityColumns(arr, TIMES, planning.carryOverPrevCut(STALE, arr[0]));

    var startById = {};
    (ops.updates || []).forEach(function (u) { startById[String(u.cutId)] = u.planStartTs; });
    function windowOf(c) {
        var ts = startById[String(c.id)];
        if (ts == null) return null;
        var start = (ts * 1000 - BASE) / 60000;
        var col = cols[String(c.id)] || {};
        return { start: start, end: start + (col.knifeMin || 0) + (col.materialWindingMin || 0) + Number(c.duration) };
    }
    var w1 = windowOf(T1), w2 = windowOf(T2);
    return (w1 && w2) ? Math.round(w2.start - w1.end) : NaN;
}

// (a) Демонстрация бага — вчерашняя резка «Завершён»: keepIds её содержит, planInput — нет.
assert(gapAfterFirstTask({ status: 'Завершён' }, false) === 30,
    '#4312 (демонстрация): вчерашняя резка «Завершён» → заправка не восстановлена → дыра 30 мин (полчаса)');
assert(gapAfterFirstTask({ status: 'Завершён' }, true) === 0,
    '#4312 (фикс): вчерашняя резка «Завершён» → заправка из очереди станка → дыры нет');

// (b) Демонстрация бага — вчерашняя резка ЗАФИКСИРОВАНА: cutsBeforeWindowToKeep её не возвращает.
assert(gapAfterFirstTask({ fixed: true }, false) === 30,
    '#4312 (демонстрация): вчерашняя резка 🔒 → keepIds пуст, заправка не восстановлена → дыра 30 мин');
assert(gapAfterFirstTask({ fixed: true }, true) === 0,
    '#4312 (фикс): вчерашняя резка 🔒 → заправка из очереди станка → дыры нет');

// (c) Случай #4300 (вчерашняя резка открыта и не зафиксирована) новым источником не сломан.
assert(gapAfterFirstTask({}, true) === 0,
    '#4312: случай #4300 (открытая незафиксированная вчерашняя резка) — дыры по-прежнему нет');

console.log('\n' + passed + '/' + total + ' passed');
