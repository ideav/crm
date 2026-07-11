// Tests for ideav/crm#4144 — «плашка с нулевой длительностью, а на следующий день вне допуска на 9 минут»
// (+ комментарий issue: «Станок 4, 1 июля влезла бы смена сырья, почему её там нет?»).
//
// Хвост дня (setup-only сегмент, #3635 п.5) решают ДВА места, и они расходились:
//
//   упаковщик  splitMachineQueue  — chooseTailSetupSubset(parts, availFor('tune'));
//   писатель   computeCutSetupUpdates → splitTailSetupAtCeiling(planStart, ножи, сырьё, cutEnd, нахлёст).
//
// Расхождение 1 (нулевая плашка). Писатель брал старт хвоста из ХРАНИМОГО planStart, а тот прошёл снап
// к целым минутам (snapWindowStartsWholeMinutes, #4061: занятость дня копится как round(наладка)+
// ceil(намотка)) и лежит ПОЗЖЕ упаковочного на накопленный ceil. От снапнутого старта потолок настройки
// схлопывал хвост в {0,0}, и 15 минут всплывали на продолжении следующего дня, наезжая на соседнюю
// карточку. Фикс #4144: колонки хвоста рождает УПАКОВЩИК (plannedTailSetup «станок+плановый старт»),
// писатель их берёт готовыми, а не пересчитывает от снапнутого planStart.
//
// Расхождение 2 (Станок 4). Упаковщик и писатель должны выбирать хвост ОДНИМ правилом
// (chooseTailSetupSubset — НАИБОЛЬШЕЕ подмножество наладки под потолком нахлёста): при room 19 это
// сырьё 15 (ножи 30 не влезают), а не «ничего».
//
// #4149 (потолок в ЦЕЛЫХ минутах). Раньше здесь стояла и фикстура «реальная очередь Станка 2» —
// показывала, что после #4144 день 03.07 всё равно копил 462 (ceil по резкам дня выносил хвост за
// 16:20). #4149 научил упаковщик считать потолок нахлёста по ЦЕЛОЙ занятости, поэтому такой хвост на
// той очереди больше не образуется (лишний проход уносится на следующий день целиком). Фикстурный
// инвариант «каждый день ≤ 460 в целых минутах» переехал в atex-production-planning-4149.test.js;
// здесь остаётся МАШИНЕРИЯ писателя (#4144) на синтетике, не зависящей от дрейфа фикстуры.
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

// ── 1) Писатель колонок берёт решение упаковщика, а не пересчитывает от снапнутого planStart ──
var api = require('../download/atex/js/production-planning.js');
var baseSec = Math.floor(new Date(2026, 6, 1, 0, 0, 0).getTime() / 1000);   // полночь 01.07.2026, TZ=UTC
function ts(dayOffset, minuteOfDay) { return String(baseSec + dayOffset * 86400 + minuteOfDay * 60); }
var cutMeta = { id: '110', val: 'Задание в производство', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
function icut(o) {
    return { id: o.id, slitter: { id: '1', label: 'Станок 1' },
        materialId: o.mat, winding: 'OUT', batchId: 'b', knifeWidths: o.kw, knifeCount: o.kw.length,
        rollerWidth: 0, isFoil: false, plannedRuns: o.runs, duration: o.dur || 0,
        planDate: ts(o.day, o.min), number: ts(o.day, o.min), firstPartId: o.first || '',
        storedKnifeSetupMin: o.sk == null ? '' : String(o.sk),
        storedMaterialWindingMin: o.sm == null ? '' : String(o.sm), storedCutAndLeaderMin: '' };
}
// Сценарий из issue: предшественник P кончается в 16:07, хвост T (0 проходов) стоит там же,
// продолжение C — 08:00 следующего дня. Наладка T от P = ножи 30 + сырьё 15.
function runWriter(plannedTailSetup, tailStored) {
    var ctrl = Object.create(api.Controller.prototype);
    ctrl.meta = { cut: cutMeta };
    ctrl.cuts = [
        icut({ id: 'P', mat: 'MW411',  kw: [70], runs: 5, dur: 30, day: 0, min: 15 * 60 + 7 }),
        icut({ id: 'T', mat: 'MWR200', kw: [50], runs: 0, dur: 0,  day: 0, min: 16 * 60 + 7, first: 'T',
               sk: tailStored ? tailStored[0] : null, sm: tailStored ? tailStored[1] : null }),
        icut({ id: 'C', mat: 'MWR200', kw: [50], runs: 4, dur: 13, day: 1, min: 8 * 60, first: 'T' })
    ];
    ctrl.changeTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
    ctrl.daySettings = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
        MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
    ctrl.slitters = []; ctrl.prevSetupBySlitter = {}; ctrl.filter = { date: '2026-07-01' };
    ctrl.plannedTailSetup = plannedTailSetup;
    var by = {};
    ctrl.computeCutSetupUpdates(null).updates.forEach(function (u) { by[String(u.cutId)] = { knife: u.knife, material: u.material }; });
    return by;
}
// Упаковщик положил в хвост сырьё 15 (ключ — «станок + плановый старт», как в plannedTailSetup).
var planMap = {};
planMap['1|' + ts(0, 16 * 60 + 7)] = { knife: 0, material: 15 };
var withPlan = runWriter(planMap, null);
assertEqual(withPlan.T, { knife: 0, material: 15 },
    'писатель кладёт в хвост решение УПАКОВЩИКА (сырьё 15), хотя от снапнутого старта потолок дал бы ноль');
assertEqual(withPlan.C, { knife: 30, material: 0 },
    'продолжение добирает только остаток наладки — ножи 30, а не полные 45 (нет наезда на соседа)');

// Плана под рукой нет («Зафиксировать» по хранимым данным) — записанные колонки не обнуляем.
var noPlan = runWriter({}, [0, 15]);
assertEqual(noPlan.T === undefined || JSON.stringify(noPlan.T) === JSON.stringify({ knife: 0, material: 15 }), true,
    'без плана писатель держит уже записанные колонки хвоста, а не пересчитывает их в ноль');
assertEqual(noPlan.C, { knife: 30, material: 0 },
    'без плана продолжение по-прежнему добирает ножи 30');

// ── 2) РАСХОЖДЕНИЕ 2 (Станок 4, 01.07): в хвост влезает смена сырья, а упаковщик не кладёт ничего ──
// Минимальный воспроизводящий стенд: день заполнен до room = 19 мин, следующей резке нужны ножи 30 +
// сырьё 15. Сырьё кончится в 16:06 — ДО конца окна резки, потолок настройки (16:20) не тронут.
// Проход A целый (471 мин) — дрейфа ceil нет, #4149-гейт (целая занятость) даёт тот же хвост.
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
