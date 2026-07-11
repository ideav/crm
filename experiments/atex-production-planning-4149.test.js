// Tests for ideav/crm#4149 — «Станок 1 Пт 03.07.2026 (461 мин)? Максимум захлёст — 10 минут».
//
// Бейдж дня Ганта (#4131) складывает ЦЕЛЫЕ минуты карточек (round(наладка)+ceil(«Резка и Лидер»)
// на сегмент — ровно то, что снапит snapWindowStartsWholeMinutes, #4061). Упаковщик же решал, что
// влезает в день, ДРОБНОЙ намоткой и гейтил потолок нахлёста (availFor) по дробному clock: день с
// суммой ≤460 в дробных минутах хранился/рисовался в ЦЕЛЫХ, а накопленный по резкам дня ceil выносил
// последнюю карточку/наладочный хвост за потолок нахлёста настройки (16:20). Бейдж показывал 461/462
// при допуске 460 — спец до #4149 описывал это как ожидаемое «447 + 15 = 462» округление.
//
// Фикс #4149: availFor считает занятость дня в ЦЕЛЫХ минутах (dayWholeOccupied — та же раскладка, что
// уходит в колонки/бейдж). Упаковщик роняет лишний ceil на следующий день сам, и хранимая раскладка
// (= бейдж) больше не вылезает за потолок. Проходы атомарны — лишнее уносится ЦЕЛЫМ проходом.
//
// Инвариант (сильнее «потолок абсолютный», #3821/#3847): сумма ХРАНИМЫХ (целых) минут любого дня
// станка ≤ ёмкость + нахлёст настройки; ни одна карточка не кончается позже cutEnd + MAX_OVERWORK_TUNE.
//
// Run with: node experiments/atex-production-planning-4149.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { failed++; console.log('  ожидалось:', JSON.stringify(expected)); console.log('  получено: ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// ── Окно рабочего дня ateh: 08:00–16:30, резка до 16:10, обед 12:20×40, нахлёст резки 5 / настройки 10.
//    Ёмкость 450, допуск (потолок нахлёста настройки) 460. ──
var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var WIN = planning.resolveWorkingWindow({
    DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
    LUNCH_START: '12:20', LUNCH_DURATION: '40',
    MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10'
}, TIMES.CLEANUP_SHIFT);
var CAPACITY = WIN.cutEndMin - WIN.startMin - WIN.lunchDurationMin;   // 450
var TOLERANCE = CAPACITY + WIN.maxOverworkTuneMin;                    // 460
assertEqual([CAPACITY, TOLERANCE, WIN.cutEndMin, WIN.maxOverworkTuneMin], [450, 460, 970, 10],
    'окно ateh: ёмкость 450, допуск 460, cutEnd 16:10, нахлёст настройки 10');

// Целая занятость сегмента = ровно то, что снапит snapWindowStartsWholeMinutes / суммирует бейдж:
// round(наладка) + ceil(«Резка и Лидер»).
function occWhole(s) { return Math.round((Number(s.setupMin) || 0)) + Math.ceil((Number(s.durationMin) || 0)); }
function dayOf(s) { return Math.floor(s.windowStartMin / 1440); }

// ── 1) РЕАЛЬНАЯ очередь Станка 2 (вложение к #4144/#4149): каждый день ≤ допуска в ЦЕЛЫХ минутах ──
// [id, проходов, «Намотка и лидер»/проход, смена ножей, смена сырья] — дробные проходы копят ceil.
var QUEUE_2 = [
    ['469390', 16, 3.8, 1, 0], ['468397', 6, 3.8, 1, 0], ['470267', 5, 3.8, 0, 1], ['468272', 2, 2.296, 0, 1],
    ['469969', 7, 3.2, 0, 0], ['470398', 10, 3.2, 1, 0], ['468540', 1, 3.2, 0, 1], ['468564', 1, 3.2, 0, 0],
    ['468671', 3, 3.2, 0, 0], ['469202', 2, 3.2, 0, 0], ['468293', 2, 6, 0, 0], ['468292', 3, 6, 0, 0],
    ['468830', 5, 3.2, 0, 1], ['469238', 3, 3.2, 0, 1], ['469920', 15, 3.8, 1, 0], ['469960', 6, 3.8, 0, 0],
    ['468793', 4, 3.2, 1, 1], ['469240', 6, 3.2, 0, 1], ['468926', 100, 3.2, 0, 1], ['470418', 34, 3.2, 0, 0],
    ['470068', 3, 3.8, 0, 1], ['470985', 4, 3.8, 0, 0], ['470547', 4, 3.2, 0, 1], ['470303', 4, 3.2, 0, 0],
    ['470351', 2, 3.2, 0, 0], ['470184', 3, 6, 0, 1], ['470216', 5, 6, 1, 0], ['468877', 4, 3.2, 1, 1],
    ['468090', 26, 2.296, 1, 1], ['468110', 57, 2.296, 0, 0], ['469865', 32, 3.8, 1, 0], ['470996', 87, 3.8, 0, 1]
];
function buildQueue(rows) {
    var knifeGrp = 0, batchGrp = 0;
    return rows.map(function (r, i) {
        if (i > 0 && r[3]) knifeGrp++;
        if (i > 0 && r[4]) batchGrp++;
        return { id: r[0], plannedRuns: r[1], perPassEff: r[2],
            knifeWidths: [100 + knifeGrp], knifeCount: 1, rollerWidth: 0,
            materialId: 'M', winding: 'OUT', batchId: 'B' + batchGrp, isFoil: false };
    });
}
function packOpts(queue, blocked, gapFill) {
    var perPassByCut = {}, runsByCut = {};
    queue.forEach(function (c) { perPassByCut[c.id] = c.perPassEff - TIMES.BETWEEN_CUTS; runsByCut[c.id] = c.plannedRuns; });
    return {
        dayStartMin: WIN.startMin, dayEndMin: WIN.cutEndMin, dayEndHourMin: WIN.endMin,
        maxOverworkCutsMin: WIN.maxOverworkCutsMin, maxOverworkTuneMin: WIN.maxOverworkTuneMin,
        times: TIMES, perPassByCut: perPassByCut, runsByCut: runsByCut,
        lunchStartMin: WIN.lunchStartMin, lunchDurationMin: WIN.lunchDurationMin,
        firstCutSetup: true, blockedRanges: blocked,
        gapFill: !!gapFill, orderAuthoritative: !!gapFill };
}
var BLOCKED_2 = [{ start: 1 * 1440 + 480, end: 1 * 1440 + 600 }];   // «Отпуск» 02.07 08:00–10:00
var q2 = buildQueue(QUEUE_2);
var segs2 = planning.splitMachineQueue(q2, packOpts(q2, BLOCKED_2, true));

// Целая сумма (= бейдж) КАЖДОГО дня ≤ допуска. До #4149 день 2 (03.07) копил 462 (последняя карточка
// до 16:22 — «на 2 сверх 460»), из-за чего Станок 1 в отчёте показал 461 (тот же механизм, дрейф +1).
var byDay2 = {};
segs2.forEach(function (s) { var d = dayOf(s); byDay2[d] = (byDay2[d] || 0) + occWhole(s); });
Object.keys(byDay2).map(Number).forEach(function (d) {
    assert(byDay2[d] <= TOLERANCE,
        'Станок 2 день ' + d + ': ЦЕЛАЯ сумма (бейдж) ' + byDay2[d] + ' ≤ допуск ' + TOLERANCE);
});
assert(byDay2[2] != null && byDay2[2] <= TOLERANCE,
    'день 03.07 (был 462 до #4149) теперь ≤ 460: ' + byDay2[2]);

// Ни одна карточка не кончается позже потолка нахлёста настройки (cutEnd + MAX_OVERWORK_TUNE = 16:20).
// Конец берём по ХРАНИМОМУ (снапнутому) старту + целая занятость — ровно как рисует Гант.
Object.keys(byDay2).map(Number).forEach(function (d) {
    var day = segs2.filter(function (s) { return dayOf(s) === d; });
    var snapped = planning.snapWindowStartsWholeMinutes(day.map(function (s) {
        return { ws: s.windowStartMin, setup: s.setupMin, cutLeader: s.durationMin };
    }));
    var lastEnd = 0;
    day.forEach(function (s, i) { var e = snapped[i] - d * 1440 + occWhole(s); if (e > lastEnd) lastEnd = e; });
    assert(lastEnd <= WIN.cutEndMin + WIN.maxOverworkTuneMin,
        'Станок 2 день ' + d + ': последняя карточка кончается ' + lastEnd + ' ≤ потолок 16:20 (' + (WIN.cutEndMin + WIN.maxOverworkTuneMin) + ')');
});

// ── 2) Изолированный механизм: дробные проходы, чей ДРОБНЫЙ хвост влезает, а ЦЕЛЫЙ (ceil) — нет ──
// Окно 08:00–?; cutEnd = 08:00+100 = 100 мин от старта, ёмкость 100, нахлёст 5 → потолок 105. Обеда нет.
// 10 одинаковых резок по 1 проходу, проход 10.4 мин (одна конфигурация → переналадки 0). Дробно 10
// проходов = 104 ≤105, но ЦЕЛЫХ = 10×ceil(10.4)=110 > 105. Упаковщик обязан оставить в дне столько,
// чтобы ЦЕЛАЯ сумма ≤105 (9 проходов = 99), а 10-й унести на следующий день.
var W2 = { dayStartMin: 0, dayEndMin: 100, dayEndHourMin: 120,
    maxOverworkCutsMin: 5, maxOverworkTuneMin: 5,
    times: { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
    lunchStartMin: null, lunchDurationMin: 0, gapFill: false };
var qDrift = [], ppBy = {}, runsBy = {};
for (var i = 0; i < 10; i++) {
    var id = 'D' + i;
    qDrift.push({ id: id, plannedRuns: 1, knifeWidths: [10], knifeCount: 1, rollerWidth: 0, materialId: 'M', winding: 'OUT', batchId: 'B', isFoil: false });
    ppBy[id] = 10.4; runsBy[id] = 1;
}
var optsDrift = Object.assign({}, W2, { perPassByCut: ppBy, runsByCut: runsBy });
var segsDrift = planning.splitMachineQueue(qDrift, optsDrift);
var day0 = segsDrift.filter(function (s) { return dayOf(s) === 0; });
var day0whole = day0.reduce(function (a, s) { return a + occWhole(s); }, 0);
var day0frac = day0.reduce(function (a, s) { return a + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); }, 0);
assert(day0whole <= 105, 'дрейф: ЦЕЛАЯ сумма дня 0 (' + day0whole + ') ≤ потолок 105 — без #4149 было бы 110');
assertEqual(day0.length, 9, 'дрейф: в дне 0 остаётся 9 проходов (10-й унесён), ЦЕЛАЯ 99 ≤ 105 при дробной ' + day0frac.toFixed(1));
assert(segsDrift.some(function (s) { return dayOf(s) === 1; }), 'дрейф: 10-й проход перенесён на день 1');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
