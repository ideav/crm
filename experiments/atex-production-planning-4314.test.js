// #4314 — после ДЛИННОГО отпуска станка наладка должна считаться С НУЛЯ (продолжение #4312).
//
// #3898/#3876 уже говорят: отпуск длиннее DOWNTIME_KEEP_SETUP_MAX_DAYS (2 дня) заправку станка не
// сохраняет — ножи снимают, сырьё убирают, первая резка после простоя настраивается с нуля. Но
// обнуление жило ТОЛЬКО в заправке на день базы (planningPrevSetupBySlitter), а она достаётся ПЕРВОМУ
// заданию очереди станка. Поэтому:
//   • отпуск В СЕРЕДИНЕ горизонта не сбрасывал наладку вообще — задание после него считалось
//     переналадкой от задания ДО отпуска (та же конфигурация → 0);
//   • при отпуске на день базы полная настройка доставалась ПЕРВОМУ заданию очереди, а им могло быть
//     задание ПРОШЛОГО дня (ДО отпуска) — настройка вставала не туда, а резка после отпуска шла с 0.
//
// Фикс: правило сброса живёт на ПАРЕ соседних заданий очереди (setupResetCutIds по итоговым «Датам
// план») и применяется в ОБОИХ расчётах — в хранимых колонках (computeCutSetupUpdates) и в упаковщике
// (splitMachineQueue, longVacationRanges). Считать по-разному нельзя: окно плана разъедется с
// нарисованным ровно так же, как в #4300/#4312.
//
// Run with: node experiments/atex-production-planning-4314.test.js

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
var FULL_SETUP = { knifeMin: 30, materialWindingMin: 15 };   // настройка с нуля (ножи + сырьё)
var NO_SETUP = { knifeMin: 0, materialWindingMin: 0 };
function mid(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
function sec(ms) { return Math.floor(ms / 1000); }
var BASE = mid(2026, 7, 22);                       // «С» = 22.07 = день 0
var K8 = [110, 110, 110, 110, 110, 110, 110, 110];

function cut(id, dayMs, mat, kw, runs) {
    return { id: id, firstPartId: id, slitter: { id: 'm1' }, materialId: mat, winding: 'OUT', batchId: '',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs == null ? 3 : runs,
        isFoil: false, length: 100, orderId: 'O_' + id,
        planDate: String(sec(dayMs + 8 * 3600000)), duration: String((runs == null ? 3 : runs) * 60), status: '' };
}
// Окна «Отпуска» станка: [начало; окончание) в unix-секундах, как this.downtimesBySlitter.
function vac(fromMs, toExclusiveMs) { return { start: sec(fromMs), end: sec(toExclusiveMs) }; }

// ── 1) longVacationDayRanges: только ДЛИННЫЕ окна, в днях от «С» ────────────────────────────────
(function () {
    eqo(planning.longVacationDayRanges([vac(mid(2026, 7, 23), mid(2026, 7, 28))], BASE), [{ fromDay: 1, toDay: 5 }],
        '#4314: отпуск 23–27.07 (5 дней) → дни 1..5 от «С»');
    eqo(planning.longVacationDayRanges([vac(mid(2026, 7, 24), mid(2026, 7, 26))], BASE), [],
        '#4314: 2-дневный отпуск — НЕ длинный (порог DOWNTIME_KEEP_SETUP_MAX_DAYS=2), заправка держится');
    eqo(planning.longVacationDayRanges([{ start: sec(mid(2026, 7, 24)), end: '' }], BASE), [],
        '#4314: окно без «Окончания» не учитываем');
    eqo(planning.longVacationDayRanges([vac(mid(2026, 7, 10), mid(2026, 7, 20))], BASE), [{ fromDay: -12, toDay: -3 }],
        '#4314: отпуск раньше «С» — дни отрицательные (пара «прошлое задание → окно» его увидит)');
    eqo(planning.longVacationDayRanges(null, BASE), [], '#4314: нет окон → []');
    eqo(planning.longVacationDayRanges([vac(mid(2026, 7, 23), mid(2026, 7, 28))], NaN), [], '#4314: нечисловая база → []');
})();

// ── 2) setupResetByVacation: полуинтервал (prevDay; curDay] ─────────────────────────────────────
(function () {
    var R = [{ fromDay: 1, toDay: 5 }];
    assert(planning.setupResetByVacation(0, 6, R) === true, '#4314: отпуск между днями 0 и 6 → настройка с нуля');
    assert(planning.setupResetByVacation(0, 1, R) === true, '#4314: день 1 накрыт отпуском → резка идёт уже после простоя');
    assert(planning.setupResetByVacation(6, 7, R) === false, '#4314: оба дня после отпуска → наладка обычная');
    assert(planning.setupResetByVacation(0, 0, R) === false, '#4314: один и тот же день → сброса нет');
    assert(planning.setupResetByVacation(5, 6, R) === false,
        '#4314: предыдущая резка в последний день отпуска (сдвинута сюда же) → сброса нет');
    assert(planning.setupResetByVacation(0, 6, []) === false, '#4314: нет длинных отпусков → сброса нет');
})();

// ── 3) Колонки: задание ПОСЛЕ длинного отпуска считает настройку с нуля ──────────────────────────
(function () {
    // Отпуск 24–28.07 (дни 2..6) в середине горизонта; задания 22.07 и 29.07 одной конфигурации.
    var T22 = cut('T22', mid(2026, 7, 22), 'MWR113L', K8), T29 = cut('T29', mid(2026, 7, 29), 'MWR113L', K8);
    var ranges = planning.longVacationDayRanges([vac(mid(2026, 7, 24), mid(2026, 7, 29))], BASE);
    var reset = planning.setupResetCutIds([T22, T29], ranges, BASE, 0);
    eqo(reset, { T29: true }, '#4314: сброс помечен на задании ПОСЛЕ отпуска (29.07), а не до него');
    var cols = planning.setupActivityColumns([T22, T29], TIMES,
        planning.carryOverPrevCut({ materialId: 'MWR113L', winding: 'OUT', knifeWidths: K8 }, T22), reset);
    eqo(cols.T22, NO_SETUP, '#4314: задание ДО отпуска — наладка от заправки станка (та же конфигурация) = 0');
    eqo(cols.T29, FULL_SETUP, '#4314: задание ПОСЛЕ отпуска — настройка С НУЛЯ (ножи 30 + сырьё 15)');

    // Контроль #3898: короткий отпуск (2 дня) наладку сохраняет.
    var shortRanges = planning.longVacationDayRanges([vac(mid(2026, 7, 24), mid(2026, 7, 26))], BASE);
    var colsShort = planning.setupActivityColumns([T22, T29], TIMES, null,
        planning.setupResetCutIds([T22, T29], shortRanges, BASE, 0));
    eqo(colsShort.T29, NO_SETUP, '#4314 (контроль #3898): после КОРОТКОГО отпуска наладка наследуется (0)');

    // Выходные/праздники наладку не снимают — их в longVacationDayRanges нет по построению.
    eqo(planning.setupResetCutIds([T22, T29], [], BASE, 0), {},
        '#4314 (контроль): без окон «Отпуска» (выходные — не отпуск) сброса нет');
})();

// ── 4) Первое задание очереди: отпуск между заправкой станка и им ───────────────────────────────
(function () {
    // Вчерашняя резка 21.07 (день −1), длинный отпуск 22–26.07 (дни 0..4), задание 27.07 (день 5).
    var Y21 = cut('Y21', mid(2026, 7, 21), 'MWR113L', K8), T27 = cut('T27', mid(2026, 7, 27), 'MWR113L', K8);
    var ranges = planning.longVacationDayRanges([vac(mid(2026, 7, 22), mid(2026, 7, 27))], BASE);
    var carryDay = planning.prevSetupBeforeWindow([Y21, T27], BASE).m1.dayOffset;   // #4312: день заправки
    assert(carryDay === -1, '#4314: заправку окна описывает день последнего задания раньше «С» (−1)');
    var reset = planning.setupResetCutIds([Y21, T27], ranges, BASE, carryDay);
    eqo(reset, { T27: true }, '#4314: полная настройка достаётся резке ПОСЛЕ отпуска (27.07), а не вчерашней (21.07)');
    var cols = planning.setupActivityColumns([Y21, T27], TIMES,
        planning.carryOverPrevCut({ materialId: 'MWR113L', winding: 'OUT', knifeWidths: K8 }, Y21), reset);
    eqo(cols.Y21, NO_SETUP, '#4314: вчерашняя резка ДО отпуска настройку с нуля НЕ получает');
    eqo(cols.T27, FULL_SETUP, '#4314: первая резка ПОСЛЕ отпуска — настройка с нуля');
})();

// ── 5) Инвариант: упаковщик и хранимые колонки считают ОДИНАКОВО (иначе дыра/нахлёст) ────────────
// Полный путь: planCutOperations (planStart) + колонки по итоговым дням; окно карточки =
// [planStart; planStart + колонки + намотка]. Зазор между соседними окнами обязан быть 0.
function windowsWithVacation(vacFromMs, vacToMs) {
    // 6 заданий по ОДНОМУ проходу 100 мин, одна конфигурация. В окно дня (450 мин) влезают 4; остальные
    // упаковщик уносит на следующий день — а он внутри отпуска, поэтому applyDowntime вынесет их на
    // первый день ПОСЛЕ простоя. Один проход на задание — дробления цепочек нет (ops.creates пуст),
    // раскладка читается один-в-один по ops.updates. Шестое задание идёт СРАЗУ за первым послеотпускным:
    // если бы упаковщик не зарезервировал его настройку с нуля, окна наехали бы друг на друга.
    var cuts = ['A', 'B', 'C', 'D', 'E', 'F'].map(function (id) { return cut(id, BASE, 'MWR113L', K8, 1); });
    cuts.forEach(function (c) { c.duration = '100'; });
    var downtimes = [vac(vacFromMs, vacToMs)];
    var ranges = planning.longVacationDayRanges(downtimes, BASE);
    var blocked = planning.downtimeBlockedRanges(downtimes, BASE);
    var perPass = {}, dueDay = {}, dueKey = {};
    cuts.forEach(function (c) { perPass[c.id] = 100; dueDay[c.id] = 20; dueKey[c.id] = 20260831; });
    var carry = { materialId: 'MWR113L', winding: 'OUT', knifeWidths: K8, knifeCount: 8 };
    var ops = planning.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: TIMES,
        dayStartMin: 480, dayEndMin: 930, dayEndHourMin: 990, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: false, firstCutSetup: true,
        prevSetupBySlitter: { m1: carry }, intraDayResequence: false, slotPlacement: false,
        perPassByCut: perPass, slitterIds: ['m1'], dueDayByCut: dueDay, dueKeyByCut: dueKey, dayAnchorByCut: {},
        blockedRangesBySlitter: { m1: blocked }, longVacationRangesBySlitter: { m1: ranges }
    });
    // Хранимые «Даты план» → та же очередь, что увидит computeCutSetupUpdates.
    var byId = {}; cuts.forEach(function (c) { byId[c.id] = c; });
    (ops.updates || []).forEach(function (u) { byId[String(u.cutId)].planDate = String(u.planStartTs); });
    var arr = planning.groupBySlitter(cuts)[0].cuts;
    var cols = planning.setupActivityColumns(arr, TIMES, planning.carryOverPrevCut(carry, arr[0]),
        planning.setupResetCutIds(arr, ranges, BASE, 0));
    return arr.map(function (c) {
        var start = (Number(c.planDate) * 1000 - BASE) / 60000;
        var setup = cols[c.id].knifeMin + cols[c.id].materialWindingMin;
        return { id: c.id, day: Math.floor(start / 1440), start: start, setup: setup, end: start + setup + Number(c.duration) };
    });
}
(function () {
    var w = windowsWithVacation(mid(2026, 7, 23), mid(2026, 7, 28));   // отпуск 23–27.07 = дни 1..5
    var after = w.filter(function (x) { return x.day > 5; });
    assert(after.length > 0 && after[0].setup === 45,
        '#4314: первое задание ПОСЛЕ отпуска в общем пути получает настройку с нуля (45 мин)'
        + '\n  раскладка: ' + JSON.stringify(w));
    // Зазоры внутри дня: окно следующей карточки начинается ровно там, где кончилась предыдущая.
    // Ключевая пара — послеотпускное задание и следующее за ним: 45 мин настройки должен зарезервировать
    // и упаковщик (planStart следующего), и колонки (окно первого), иначе тут вылезет −45 (нахлёст).
    var gaps = [];
    for (var i = 1; i < w.length; i++) if (w[i].day === w[i - 1].day) gaps.push(Math.round(w[i].start - w[i - 1].end));
    assert(after.length >= 2, '#4314: за первым послеотпускным заданием в дне есть следующее (проверяем стык)'
        + '\n  раскладка: ' + JSON.stringify(w));
    eqo(gaps.filter(function (g) { return g !== 0; }), [],
        '#4314: упаковщик и колонки сходятся — ни дыр, ни нахлёстов внутри дня (#4300/#4312)');
})();

console.log('\n' + passed + '/' + total + ' passed');
