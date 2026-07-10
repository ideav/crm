// Tests for ideav/crm#4144 — «плашка с нулевой длительностью, а на следующий день вне допуска на 9 минут»
// (+ комментарий issue: «Станок 4, 1 июля влезла бы смена сырья, почему её там нет?»).
//
// Хвост дня (setup-only сегмент, #3635 п.5) решают ДВА места, и они расходятся:
//
//   упаковщик  splitMachineQueue  — minOverlapTailSetupMinutes(parts, room, total) + гейт availFor('tune');
//   писатель   computeCutSetupUpdates → splitTailSetupAtCeiling(planStart, ножи, сырьё, cutEnd, нахлёст).
//
// Расхождение 1 (нулевая плашка). Писатель берёт старт хвоста из ХРАНИМОГО planStart (20-controller.js:
// `c.number`), а тот прошёл снап к целым минутам (snapWindowStartsWholeMinutes, #4061: занятость дня
// копится как round(наладка)+ceil(намотка)). На реальном плане из issue снап сдвигает старт хвоста
// 16:04 → 16:07: room до cutEnd падает 6 → 3, и под потолок настройки (room+10) перестаёт влезать даже
// минимальный компонент (сырьё 15) → писатель кладёт {0,0}. Оператор видит задание нулевой длительности,
// а 15 минут всплывают на продолжении следующего дня: карточка 08:00 растёт 43 → 58 мин и наезжает на
// соседнюю (старт 08:43) ровно на 15; сумма колонок дня 06.07 = 469 при допуске 450+10=460 → «9 минут».
//
// Расхождение 2 (Станок 4). Упаковщик ищет МИНИМАЛЬНОЕ подмножество наладки, дотягивающее до cutEnd, и
// если оно вылезло за потолок — не кладёт НИЧЕГО. При room 19 это ножи 30 (сырьё 15 до cutEnd не
// дотягивает) → 30 > 29 → хвоста нет вовсе. splitTailSetupAtCeiling в том же положении откатывается на
// НАИБОЛЬШЕЕ подмножество под потолком (#4116) — сырьё 15, которое кончается в 16:06, ДО конца окна.
// Правило хвоста должно быть одно; чинить надо упаковщик (там же — источник planStart).
//
// Фикстура — реальная очередь Станка 2 за 01–08.07 из вложения к issue (cut_planning): на каждую
// логическую резку (цепочки день-сплита склеены по «ID первой части») — проходы, «Намотка и лидер» на
// проход и факт смены ножей/сырья, снятые с хранимых колонок.
//
// Run with: node experiments/atex-production-planning-4144.test.js

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

// ── Окно рабочего дня ateh: 08:00–16:30, резка до 16:10 (TOTAL_INTERVALS 20), обед 12:20×40,
//    нахлёст резки 5 мин (до 16:15), нахлёст настройки 10 мин (до 16:20). Ёмкость дня = 450. ──
var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
var WIN = planning.resolveWorkingWindow({
    DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
    LUNCH_START: '12:20', LUNCH_DURATION: '40',
    MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10'
}, TIMES.CLEANUP_SHIFT);
var CAPACITY = WIN.cutEndMin - WIN.startMin - WIN.lunchDurationMin;   // 450
var TOLERANCE = CAPACITY + WIN.maxOverworkTuneMin;                    // 460

assertEqual([WIN.startMin, WIN.cutEndMin, WIN.endMin, CAPACITY, TOLERANCE], [480, 970, 990, 450, 460],
    'окно дня ateh: 08:00, резка до 16:10, смена до 16:30, ёмкость 450, допуск 460');

// ── Очередь Станка 2 (порядок = planStart). [id, проходов, «Намотка и лидер»/проход, смена ножей, смена сырья] ──
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
// Смена ножей ⇔ сменился набор ширин; смена сырья/намотки ⇔ сменилась партия (changeoverParts).
// Материал и намотку держим константой, сигнал несёт batchId — иначе MATERIAL_WINDING сработает дважды.
function buildQueue(rows) {
    var knifeGrp = 0, batchGrp = 0;
    return rows.map(function (r, i) {
        if (i > 0 && r[3]) knifeGrp++;
        if (i > 0 && r[4]) batchGrp++;
        return {
            id: r[0], plannedRuns: r[1], perPassEff: r[2],
            knifeWidths: [100 + knifeGrp], knifeCount: 1, rollerWidth: 0,
            materialId: 'M', winding: 'OUT', batchId: 'B' + batchGrp, isFoil: false
        };
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
        gapFill: !!gapFill, orderAuthoritative: !!gapFill
    };
}
// «Отпуск» Станка 2: 02.07 с 08:00 до 10:00 (первая карточка того дня в базе — 10:00).
// Упаковщик считает РАБОЧИЕ дни: день 0 = 01.07, 1 = 02.07, 2 = 03.07, 3 = 06.07 (выходные
// 04–05.07 пропускает календарь раскладки, не он).
var BLOCKED_2 = [{ start: 1 * 1440 + 480, end: 1 * 1440 + 600 }];
var DAY_0607 = 3;

var q2 = buildQueue(QUEUE_2);
var segs2 = planning.splitMachineQueue(q2, packOpts(q2, BLOCKED_2, true));
function dayOf(s) { return Math.floor(s.windowStartMin / 1440); }
function minOfDay(s) { return s.windowStartMin - dayOf(s) * 1440; }
function occ(s) { return (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); }

// ── 1) Упаковщик кладёт в хвост 03.07 (день 2) смену намотки 15 мин — ровно до потолка 16:19 ≤ 16:20 ──
var tails = segs2.filter(function (s) { return s.setupOnly; });
assertEqual(tails.length, 1, 'упаковщик создал ровно один setup-only хвост на очереди Станка 2');
var tail = tails[0];
assertEqual([tail.cutId, dayOf(tail), minOfDay(tail), tail.setupMin, tail.runs], ['468877', 2, 964, 15, 0],
    'хвост: резка 468877, день 03.07, старт 16:04, наладка 15 мин (сырьё), 0 проходов');
assert(minOfDay(tail) + tail.setupMin <= WIN.cutEndMin + WIN.maxOverworkTuneMin,
    'хвост кончается не позже потолка нахлёста настройки (16:20)');

// Продолжение уносит ОСТАТОК наладки (ножи 30), а не всю (45): следующая карточка дня стартует в 08:43.
var cont = segs2.filter(function (s) { return s.cutId === '468877' && s.runs > 0; })[0];
assertEqual([dayOf(cont), minOfDay(cont), cont.setupMin], [DAY_0607, 480, 30],
    'продолжение 468877 на 06.07 в 08:00 несёт остаток наладки 30 мин (ножи), не 45');
// В базу пишется снапнутый старт — сверяем с ним (упаковщик считает намотку дробной).
var day3 = segs2.filter(function (s) { return dayOf(s) === DAY_0607; });
var snapped3 = planning.snapWindowStartsWholeMinutes(day3.map(function (s) {
    return { ws: s.windowStartMin, setup: s.setupMin, cutLeader: s.durationMin };
}));
var iNext = day3.map(function (s) { return s.cutId; }).indexOf('468090');
assertEqual(snapped3[iNext] - DAY_0607 * 1440, 480 + 43,
    'следующая резка 468090 стартует в 08:43 — ровно как записано в базе');

// ── 2) День 06.07 у упаковщика укладывается в допуск (в базе — 469 мин, на 9 сверх) ──
var day0607 = day3.reduce(function (a, s) { return a + occ(s); }, 0);
assert(day0607 > 0 && day0607 <= TOLERANCE,
    'упакованный день 06.07 (' + Math.ceil(day0607) + ' мин) не превышает допуск ' + TOLERANCE);

// ── 3) РАСХОЖДЕНИЕ 1: писатель колонок получает СНАПНУТЫЙ старт хвоста и меняет решение ──
// Хранимый planStart считает snapWindowStartsWholeMinutes — тот же код, что пишет главное значение резки.
var day2 = segs2.filter(function (s) { return dayOf(s) === 2; });
var snapped = planning.snapWindowStartsWholeMinutes(day2.map(function (s) {
    return { ws: s.windowStartMin, setup: s.setupMin, cutLeader: s.durationMin };
}));
var tailStored = snapped[day2.indexOf(tail)] - 2 * 1440;
assertEqual([minOfDay(tail), tailStored], [964, 967],
    'снап (#4061) сдвигает старт хвоста 16:04 → 16:07: room до cutEnd падает 6 → 3');

// Полная наладка хвоста = ножи 30 + сырьё 15 (её и делит писатель).
var keepRaw = planning.splitTailSetupAtCeiling(minOfDay(tail), 30, 15, WIN.cutEndMin, WIN.maxOverworkTuneMin);
var keepStored = planning.splitTailSetupAtCeiling(tailStored, 30, 15, WIN.cutEndMin, WIN.maxOverworkTuneMin);
assertEqual(keepRaw.keepKnife + keepRaw.keepMaterial, tail.setupMin,
    'от старта УПАКОВЩИКА (16:04) писатель оставляет в дне те же 15 мин');
assertEqual(keepStored.keepKnife + keepStored.keepMaterial, tail.setupMin,
    'от ХРАНИМОГО старта (16:07) писатель обязан оставить те же 15 мин, а не обнулить плашку');

// ── 4) РАСХОЖДЕНИЕ 2 (Станок 4, 01.07): в хвост влезает смена сырья, а упаковщик не кладёт ничего ──
// Минимальный воспроизводящий стенд: день заполнен до room = 19 мин, следующей резке нужны ножи 30 +
// сырьё 15. Сырьё кончится в 16:06 — ДО конца окна резки, потолок настройки (16:20) не тронут.
var TIMES4 = { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 2, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
var qA = [
    { id: 'A', plannedRuns: 1, knifeWidths: [10], knifeCount: 1, rollerWidth: 0, materialId: 'M1', winding: 'OUT', batchId: 'B1' },
    { id: 'B', plannedRuns: 1, knifeWidths: [20], knifeCount: 1, rollerWidth: 0, materialId: 'M2', winding: 'OUT', batchId: 'B2' }
];
var ROOM = 19;
var segs4 = planning.splitMachineQueue(qA, {
    dayStartMin: WIN.startMin, dayEndMin: WIN.cutEndMin, dayEndHourMin: WIN.endMin,
    maxOverworkCutsMin: WIN.maxOverworkCutsMin, maxOverworkTuneMin: WIN.maxOverworkTuneMin,
    times: TIMES4, lunchStartMin: null, lunchDurationMin: 0,
    perPassByCut: { A: (WIN.cutEndMin - WIN.startMin) - ROOM, B: 30 },
    runsByCut: { A: 1, B: 1 }
});
var tail4 = segs4.filter(function (s) { return s.setupOnly; })[0];
assertEqual(tail4 ? tail4.setupMin : 0, 15,
    'room 19: в хвост дня кладётся сырьё 15 (наибольшее подмножество под потолком), а не «ничего»');
// Писатель в том же положении держит сырьё — с ним упаковщик и обязан совпасть (#4116).
var keep4 = planning.splitTailSetupAtCeiling(WIN.cutEndMin - ROOM, 30, 15, WIN.cutEndMin, WIN.maxOverworkTuneMin);
assertEqual([keep4.keepKnife, keep4.keepMaterial], [0, 15],
    'splitTailSetupAtCeiling при room 19 оставляет сырьё 15 — правило хвоста должно быть одно');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
