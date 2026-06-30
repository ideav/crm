// Unit tests for #3847 — «Максимальное время нахлёста за конец рабочего дня».
//
// #3909/#3910: ПОТОЛОК нахлёста привязан к cutEndMin (= DAY_END_HOUR − TOTAL_INTERVALS), а НЕ к
// DAY_END_HOUR. Резку (проход) нельзя класть с нахлёстом, если она кончится позже
// cutEndMin+MAX_OVERWORK_CUTS; настройку (ножи/смена сырья) — позже cutEndMin+MAX_OVERWORK_TUNE.
// Раньше базой был DAY_END_HOUR (день паковался до 16:35, копя 475–494 раб. мин — #3910); теперь
// 16:15 (резка) / 16:20 (настройка), буфер уборки (TOTAL_INTERVALS) поглощает нахлёст. Задание
// делится по проходам: короткий «хвостовой» проход/настройка ≤ лимита остаётся в дне, длинный — на
// следующий день.
//
// Фича включается ТОЛЬКО когда лимит задан (resolveWorkingWindow → maxOverworkCutsMin != null);
// без настроек планировщик пакует как раньше (до cutEndMin, #3821) — это проверяем отдельно.
//
// Run with: node experiments/atex-production-planning-3847.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Окно: 08:00 (480) … cutEndMin 16:10 (970); DAY_END_HOUR 16:30 (990); нахлёст резки 5, настройки 10.
var DAY_START = 480, CUT_END = 970, DAY_END_HOUR = 990;
var OVER = { dayEndHourMin: DAY_END_HOUR, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10 };
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };

function cut(id, material, knives) {
    return { id: id, materialId: material || 'M', winding: 'IN', batchId: 'b',
        knifeCount: (knives || [30]).length, knifeWidths: (knives || [30]), rollerWidth: 0, isFoil: false, plannedRuns: 6 };
}
function runsById(segs) {
    return segs.map(function(s) { return { day: s.dayOffset, runs: s.runs, setup: s.setupMin, ws: s.windowStartMin }; });
}

// ── Базовая ветка (генерация, gapFill=false): нахлёст резки ограничен cutEndMin+5 (#3909) ──────
// perPass 99: 5 проходов = 495 мин, конец 480+495=975=16:15 = cutEndMin+5 (ровно лимит) → ОК.
// Без нахлёста влезает 4 (floor(490/99)); нахлёст добавляет ровно 1 проход.
var baseOpts = { dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: { A: 99 }, runsByCut: { A: 6 } };
var onBase = planning.splitMachineQueue([cut('A')], Object.assign({}, baseOpts, OVER));
assertEqual(runsById(onBase), [{ day: 0, runs: 5, setup: 0, ws: 480 }, { day: 1, runs: 1, setup: 0, ws: 1920 }],
    '#3847/#3909 база: 5 проходов в день0 (последний кончается 16:15=cutEndMin+5), 6-й — день1');
// Сегмент дня0 кончается ровно в cutEndMin+MAX_OVERWORK_CUTS (975).
assertEqual(onBase[0].startMin + onBase[0].durationMin, 975, '#3847/#3909 база: конец дня0 = cutEndMin+5 (16:15)');

// ── Фича выключена (нет лимита) → пакуем до cutEndMin (#3821): 4 прохода в день0 ───────────────
var offBase = planning.splitMachineQueue([cut('A')], baseOpts);
assertEqual(runsById(offBase).map(function(s) { return { day: s.day, runs: s.runs }; }),
    [{ day: 0, runs: 4 }, { day: 1, runs: 2 }],
    '#3847 база: без лимита нахлёста — 4 прохода (до cutEndMin), как #3821');

// ── Ветка gapFill (autoSequence): тот же лимит резки ───────────────────────────────────────────
var gapOpts = Object.assign({}, baseOpts, { gapFill: true });
var onGap = planning.splitMachineQueue([cut('A')], Object.assign({}, gapOpts, OVER));
assertEqual(runsById(onGap).map(function(s) { return { day: s.day, runs: s.runs }; }),
    [{ day: 0, runs: 5 }, { day: 1, runs: 1 }],
    '#3847 gapFill: 5 проходов в день0, 6-й — день1 (как база)');
var offGap = planning.splitMachineQueue([cut('A')], gapOpts);
assertEqual(runsById(offGap).map(function(s) { return { day: s.day, runs: s.runs }; }),
    [{ day: 0, runs: 4 }, { day: 1, runs: 2 }],
    '#3847 gapFill: без лимита — 4 прохода (как #3821)');

// ── Нахлёст НАСТРОЙКИ ограничен cutEndMin+10 (#3909) ───────────────────────────────────────────
// A (p97×5=485) заполняет день0 до 16:05. B — другое сырьё (setup 15). Первый проход B не влезает
// (cutEndMin+5), но настройка 15 кончается в 16:20 = cutEndMin+10 → сегмент НАСТРОЙКИ в хвост,
// проходы B — на день1.
var setupOpts = { dayStartMin: DAY_START, dayEndMin: CUT_END, leader: 0, times: TIMES,
    perPassByCut: { A: 97, B: 100 }, runsByCut: { A: 5, B: 2 } };
var withSetup = planning.splitMachineQueue([cut('A', 'M1'), cut('B', 'M2')], Object.assign({}, setupOpts, OVER));
var bSegs = withSetup.filter(function(s) { return s.cutId === 'B'; });
assertEqual(bSegs.map(function(s) { return { day: s.dayOffset, runs: s.runs, setup: s.setupMin, setupOnly: !!s.setupOnly }; }),
    [{ day: 0, runs: 0, setup: 15, setupOnly: true }, { day: 1, runs: 2, setup: 0, setupOnly: false }],
    '#3847/#3909: настройка B (15 мин) кладётся в хвост дня0 (нахлёст ≤ +10), проходы — день1');
assertEqual(bSegs[0].startMin + bSegs[0].durationMin, 980, '#3847/#3909: конец настройки в хвосте = 16:20 (= cutEndMin+10)');

// Та же раскладка, но A заполняет день0 ровно до cutEndMin (p98×5=490, 16:10): в нахлёст настройки
// остаётся лишь 10 мин < 15 → настройка B не влезает даже в хвост → ВСЯ резка B на день1.
var setupOpts2 = Object.assign({}, setupOpts, { perPassByCut: { A: 98, B: 100 } });
var withBigSetup = planning.splitMachineQueue([cut('A', 'M1'), cut('B', 'M2')], Object.assign({}, setupOpts2, OVER));
var bBig = withBigSetup.filter(function(s) { return s.cutId === 'B'; });
assertEqual(bBig.map(function(s) { return { day: s.dayOffset, runs: s.runs, setup: s.setupMin }; }),
    [{ day: 1, runs: 2, setup: 15 }],
    '#3847/#3909: настройка не влезает в остаток нахлёста (10<15) → вся резка B на день1');

// ── resolveWorkingWindow парсит лимиты ────────────────────────────────────────────────────────
function ww(extra) {
    return planning.resolveWorkingWindow(Object.assign({ DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20' }, extra), 30);
}
var w1 = ww({ MAX_OVERWORK_CUTS: '5', MAX_OVERWORK_TUNE: '10' });
assertEqual([w1.endMin, w1.cutEndMin, w1.maxOverworkCutsMin, w1.maxOverworkTuneMin], [990, 970, 5, 10],
    '#3847: resolveWorkingWindow → endMin 990, cutEndMin 970, лимиты 5/10');
var w2 = ww({});
assertEqual([w2.maxOverworkCutsMin, w2.maxOverworkTuneMin], [null, null],
    '#3847: нет настроек нахлёста → null/null (фича выключена)');
var w3 = ww({ MAX_OVERWORK_CUTS: '0' });
assertEqual([w3.maxOverworkCutsMin, w3.maxOverworkTuneMin], [0, 0],
    '#3847: «0» — заданный лимит (нахлёст запрещён), не «выключено»; tune наследует cuts');
var w4 = ww({ MAX_OVERWORK_CUTS: '5' });
assertEqual([w4.maxOverworkCutsMin, w4.maxOverworkTuneMin], [5, 5],
    '#3847: задан только CUTS → TUNE наследует его (общий смысл «нахлёст»)');

console.log('\n' + passed + ' проверок прошло.');
