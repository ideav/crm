// #4559 — «Пересчет опять вылез за лимит дня 460 минут»
//
// СИМПТОМ (боевое, ateh, 01.08.2026, трасса ideav.ru-1785581269276.log). Оператор нажал
// «⏩ Пересчитать отсюда и до конца» (#4555, `recalcFromCut`). Станок 1, Пн 03.08.2026:
//   № 1  08:00 – 08:27 ·  27 мин  MW411  (🔒)
//   № 2  08:27 – 16:55 · 448 мин  MW308  (🔒, разорвано по дням)
// Итого 475 мин работы при ёмкости смены ~465 (08:00–16:30 минус обед). В шапке дня — «(475 мин)»
// БЕЗ пометки перебора, предупреждения нет, `levelDayLoad` не сработал: в трассе после трёх
// записей `[recalcFromCut]` нет ни строки `⚖️ #4473: день длиннее смены`.
//
// ПРИЧИНА. `overfilledDaysFromCuts` меряет конец дня как «сохранённый planStart + минуты РАБОТЫ»
// (`storedKnifeSetupMin + storedMaterialWindingMin + storedCutAndLeaderMin`) и держится за
// комментарий «обед уже сидит в хранимых стартах». В стартах обед лежит ЗАЗОРОМ — но только МЕЖДУ
// заданиями. Задание, которое началось ДО обеда и идёт СКВОЗЬ него, станок паузит В ХОДЕ намотки
// (#3816, `splitMachineQueue.lunchGap`): минуты работы не растут, а КОНЕЦ окна уезжает на весь
// обед. Мерка насчитала 08:27 + 448 = 15:55 при потолке 16:15/16:30 — «помещается», хотя реальный
// конец 16:40. Молчат все, кто на неё опирается: бейдж шапки дня (#4531), предупреждение (#4497)
// и `levelDayLoad` (#4473/#4555), который выходит первой же строкой `if (!over.length)`.
//
//   A — РЕПРО: день, чьё последнее задание идёт СКВОЗЬ обед, признан переполненным;
//   B — РЕПРО сверху: `levelDayLoad` такой день ВИДИТ и зовёт пересборку (а не выходит молча);
//   C — ДВАЖДЫ НЕ СЧИТАЕМ: обед, стоящий в стартах ЗАЗОРОМ (после «сквозного» задания есть ещё
//       одно), к концу дня не добавляется;
//   D — перерывы 10:00/15:00 (ТЗ §5) в мерку НЕ входят: упаковщик их не резервирует;
//   E — регресс: день, целиком помещающийся в смену, переполненным не становится;
//   F — разгрузка доходит до конца: упаковщик РВЁТ 🔒 по потолку (голова на своём дне, остаток
//       продолжением) — мерка была единственным, что стояло между боевым днём и этим разрывом.
//
// Run with: node experiments/atex-pp-4559-lunch-inside-cut-day-cap.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Смена 08:00–16:30, обед 12:20×45, буфер уборки 15 мин → потолок резки (cutEndMin) 16:15.
var DAY_START = 8 * 60, CUT_END = 16 * 60 + 15, LUNCH_START = 12 * 60 + 20, LUNCH_DUR = 45;
var BASE = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();          // 03.08.2026, полночь
function tsAt(hh, mm, dayShift) {
    return Math.floor((BASE + ((dayShift || 0) * 1440 + hh * 60 + mm) * 60000) / 1000);
}
// задание: окно начинается в hh:mm, занятость станка occ минут РАБОТЫ (как в хранимых колонках)
function cut(id, hh, mm, occ, dayShift) {
    var ts = tsAt(hh, mm, dayShift);
    return { id: id, number: String(ts), planDate: String(ts),
        slitter: { id: '1277' }, materialName: 'MW308', winding: 'OUT',
        storedKnifeSetupMin: '0', storedMaterialWindingMin: '0', storedCutAndLeaderMin: String(occ) };
}
function measure(cuts, opts) {
    var o = opts || {};
    return planning.overfilledDaysFromCuts(cuts, {
        baseMidnightMs: BASE, cutEndMin: CUT_END, maxOverworkCutsMin: 0,
        dayStartMin: DAY_START,
        lunchStartMin: o.noLunch ? null : LUNCH_START,
        lunchDurationMin: o.noLunch ? 0 : LUNCH_DUR
    });
}

// Боевой день: 27 мин + 448 мин встык. Работы 475, конец по работе 15:55 — «влезает»;
// реально задание № 2 паузит на обед и кончается 16:40, то есть за потолком 16:15 на 25 мин.
function prodDay() { return [cut('mw411', 8, 0, 27), cut('mw308', 8, 27, 448)]; }

// ── A) РЕПРО: «сквозное» задание уносит день за потолок ─────────────────────────────────────────
(function () {
    var days = measure(prodDay());
    assert(days.length === 1, 'A1 день признан переполненным', '(дней ' + days.length + ')');
    var d = days[0] || {};
    assert(Math.round(d.endMin) === 16 * 60 + 40,
        'A2 конец дня — 16:40 (08:27 + 448 мин работы + 45 мин обеда сквозь намотку)',
        '(' + Math.round(d.endMin) + ' мин от полуночи)');
    assert(Math.round(d.overMin) === 25 && String(d.cutId) === 'mw308' && d.seq === 2,
        'A3 перебор +25 мин, виновник — задание № 2 дня',
        '(+' + Math.round(d.overMin) + ', ' + d.cutId + ', № ' + d.seq + ')');
    // Контроль: без обеда в настройках арифметика прежняя — день «помещается».
    assert(measure(prodDay(), { noLunch: true }).length === 0,
        'A4 без обеда (настройка пуста) мерка прежняя — переполнения нет');
})();

// ── B) РЕПРО сверху: levelDayLoad такой день ВИДИТ ─────────────────────────────────────────────
// `levelDayLoad` (#4473) — вход в пересборку и у «↻ Пересчитать наладку», и у «⏩ Пересчитать
// отсюда» (#4555). Первой строкой он выходит, если `overfilledDaysOf` пуст: именно поэтому в
// боевой трассе после `[recalcFromCut]` нет строки «⚖️ #4473: день длиннее смены».
(function () {
    var called = null;
    var stub = {
        cuts: prodDay(),
        recalcScopeCutIds: function () { return ['mw411', 'mw308']; },
        workingWindow: function () {
            return { startMin: DAY_START, cutEndMin: CUT_END, maxOverworkCutsMin: 0,
                     lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR };
        },
        filter: { date: '2026-08-03' },
        overfilledDaysOf: Controller.prototype.overfilledDaysOf,
        levelDayLoad: Controller.prototype.levelDayLoad,
        autoSequenceQueueAfterMerge: function (strategy, preserve, scope) {
            called = { strategy: strategy, preserve: preserve, scope: scope };
            return Promise.resolve(true);
        },
        notify: function () {},
        warnOverfilledDays: function () { return []; }
    };
    var over = stub.overfilledDaysOf.call(stub, '1277');
    assert(over.length === 1, 'B1 overfilledDaysOf станка видит переполненный день', '(дней ' + over.length + ')');
    stub.levelDayLoad.call(stub, '1277', { fromCutId: 'mw308' });
    assert(called && called.preserve === true && called.scope && called.scope.keepBeforeCutId === 'mw308',
        'B2 levelDayLoad зовёт пересборку «отсюда и до конца» (порядок сохраняя)',
        '(' + JSON.stringify(called && called.scope) + ')');
})();

// ── C) ДВАЖДЫ НЕ СЧИТАЕМ: обед-зазор уже в стартах ─────────────────────────────────────────────
// После «сквозного» задания есть ещё одно — упаковщик оставил обед ЗАЗОРОМ перед ним, и в старте
// второго задания пауза уже учтена. Добавлять её повторно нельзя.
(function () {
    // 08:00 + 260 → 12:20 (ровно к обеду), затем зазор 45 мин и второе задание 13:05 + 180 → 16:05.
    var cuts = [cut('a', 8, 0, 260), cut('b', 13, 5, 180)];
    assert(measure(cuts).length === 0,
        'C1 обед лежит зазором — день кончается 16:05 и в смену помещается',
        '(' + JSON.stringify(measure(cuts).map(function (x) { return Math.round(x.endMin); })) + ')');
    // Тот же день, но второе задание длиннее: конец 16:20 — уже за потолком, ровно на 5 мин
    // (и НЕ на 50: обед посчитан ОДИН раз).
    var cuts2 = [cut('a', 8, 0, 260), cut('b', 13, 5, 195)];
    var d2 = measure(cuts2)[0] || {};
    assert(measure(cuts2).length === 1 && Math.round(d2.overMin) === 5,
        'C2 перебор считается от честного конца, обед не удваивается',
        '(+' + Math.round(d2.overMin) + ')');
})();

// ── D) ТЗ §5: перерывы 10:00/15:00 в мерку не входят ───────────────────────────────────────────
// Перерывы для планирования ПРОЗРАЧНЫ (упаковщик их не резервирует, из ёмкости не вычитает) —
// они только рисуются на карточке (#4075) и Ганте (#4007). Требовать под них запас = объявить
// переполненным каждый полный день.
(function () {
    // 08:00 + 240 → 12:00 (до обеда), 13:05 + 180 → 16:05. Внутри — оба перерыва 10:00 и 15:00.
    var cuts = [cut('a', 8, 0, 240), cut('b', 13, 5, 180)];
    assert(measure(cuts).length === 0,
        'D1 два перерыва внутри дня переполнения не создают', '(дней ' + measure(cuts).length + ')');
})();

// ── E) РЕГРЕСС: нормальный день переполненным не становится ────────────────────────────────────
(function () {
    // Одно задание 08:00 + 300 → работа до 13:00, со «сквозным» обедом конец 13:45 ≤ 16:15.
    assert(measure([cut('solo', 8, 0, 300)]).length === 0, 'E1 короткий день в смену помещается');
    // Дни считаются независимо: переполнен только 03.08.
    var mixed = prodDay().concat([cut('next', 8, 0, 120, 1)]);
    var res = measure(mixed);
    assert(res.length === 1 && res[0].dayOffset === 0,
        'E2 переполнен ровно день 03.08, следующий день чист',
        '(' + JSON.stringify(res.map(function (x) { return x.dayOffset; })) + ')');
})();

// ── F) РАЗГРУЗКА ДОХОДИТ ДО КОНЦА: 🔒 РВЁТСЯ ПО ПОТОЛКУ ────────────────────────────────────────
// Замок запрещает ВЫТЕСНЕНИЕ задания из его дня (#4512), но не разрыв: голова с влезающими
// проходами остаётся на зафиксированном дне, остаток уезжает продолжением (#4304/#4467). Мерка
// была единственным, что стояло между боевым днём и этим разрывом. Гоняем упаковщик на боевых
// числах: 🔒 27 мин + 🔒 448 мин (106 проходов) в смене 08:00–16:15 с обедом 12:20×45.
(function () {
    var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };
    function pc(id, runs) {
        return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
                 knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: runs, fixed: true };
    }
    var segs = planning.splitMachineQueue([pc('mw411', 27), pc('mw308', 106)], {
        dayStartMin: DAY_START, dayEndMin: CUT_END, times: ZERO,
        lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR,
        perPassByCut: { mw411: 1, mw308: 448 / 106 }, runsByCut: { mw411: 27, mw308: 106 },
        dayAnchorByCut: { mw411: 0, mw308: 0 }, gapFill: true
    });
    var byDay = {};
    segs.forEach(function (s) {
        byDay[s.dayOffset] = (byDay[s.dayOffset] || 0) + Number(s.setupMin) + Number(s.durationMin);
    });
    var cap = CUT_END - DAY_START - LUNCH_DUR;   // 450 мин — ёмкость смены за вычетом обеда
    assert(segs.filter(function (s) { return String(s.cutId) === 'mw308'; }).length === 2,
        'F1 🔒 разорвана по дням — голова на своём дне, остаток продолжением',
        '(сегментов ' + segs.length + ')');
    assert(Math.round(byDay[0]) <= cap,
        'F2 зафиксированный день влезает в смену (' + Math.round(byDay[0]) + ' ≤ ' + cap + ' мин)',
        '(' + JSON.stringify(Object.keys(byDay).map(function (d) { return d + ':' + Math.round(byDay[d]); })) + ')');
    var head = segs.filter(function (s) { return String(s.cutId) === 'mw308' && !s.isContinuation; })[0];
    assert(head && head.dayOffset === 0 && head.fixedDayLock === true,
        'F3 голова осталась на ЗАФИКСИРОВАННОМ дне — вытеснения нет (#4512)',
        '(день ' + (head && head.dayOffset) + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
if (passed !== total) process.exit(1);
