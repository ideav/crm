// Unit tests for #3855 — «Почему опять минуты не сходятся?»
//
// Гант и production-planning (#3846) рисуют ОКНО резки = setup + (намотка+лидер) и ставят
// его по сохранённому «Время старта» (planStart). Чтобы соседние резки шли встык и обе РМ
// показывали ОДНО И ТО ЖЕ, planStart обязан:
//   1) равняться накопленной сумме сохранённых окон дня (иначе разрывы/перекрытия);
//   2) попадать на ЦЕЛУЮ минуту (иначе Гант обрезает :SS вниз, страница — вверх → ±1–2 мин).
//
// Раньше planStart писал ОТДЕЛЬНЫЙ расчёт (splitMachineQueue, raw-намотка + «ножи с нуля»),
// расходясь с окном (persistence: переналадка от заправки + ceil-намотка). Фикс #3855:
// «Время старта», «Наладка ножей», «Сырьё/намотка» и «Резка и Лидер» считаются ОДНОЙ
// функцией (computeCutSetupUpdates) и хранятся; planStart = накопленное целочисленное окно
// дня от 08:00 (derivePlanStartTimestamps). Никакого пересчёта «на лету».
//
// Данные взяты из таблицы «Задание в производство» (table/1078), Станок 1, 29.06.2026,
// скриншот в #3855: окно = Наладка ножей + Сырьё/намотка + Резка и Лидер.
//
// Run with: node experiments/atex-production-planning-3855.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name); console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var DAY = 86400000;
var base = Date.UTC(2026, 5, 29, 0, 0, 0);   // полночь 29.06.2026 (день 0)
var SHIFT_START = 480;          // 08:00
var LUNCH_START = 740, LUNCH_DUR = 40;   // 12:20, 40 мин

function tsAtMin(dayOff, min) { return Math.floor((base + dayOff * DAY + min * 60000) / 1000); }
// planDate каждой резки — штамп её дня (08:00), чтобы dayOffsetFromBase дал нужный день.
function cut(id, dayOff, windowMin) { return { id: id, planDate: String(tsAtMin(dayOff, SHIFT_START)), windowMin: windowMin }; }

// ── Данные #3855 (Станок 1, 29.06): окна 19/114/38/191 (сумма 362 < 450, без дробления) ──
var stanok1 = [ cut('c1', 0, 19), cut('c2', 0, 114), cut('c3', 0, 38), cut('c4', 0, 191) ];
var got = planning.derivePlanStartTimestamps(stanok1, { base: base, shiftStartMin: SHIFT_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR });

// Ожидаемый ВСТЫК план от 08:00: 08:00, 08:19, 10:13, 10:51 — всё на целой минуте.
assertEqual(got.c1, tsAtMin(0, 480), '#3855 c1 → 08:00 (480)');
assertEqual(got.c2, tsAtMin(0, 480 + 19), '#3855 c2 → 08:19 (встык: 480+19=499)');
assertEqual(got.c3, tsAtMin(0, 480 + 19 + 114), '#3855 c3 → 10:13 (613)');
assertEqual(got.c4, tsAtMin(0, 480 + 19 + 114 + 38), '#3855 c4 → 10:51 (651)');
// Все штампы — на целой минуте (секунды = 0).
[got.c1, got.c2, got.c3, got.c4].forEach(function(ts, i) {
    assertEqual((ts % 60), 0, '#3855 штамп резки ' + (i + 1) + ' попадает на целую минуту (нет :SS)');
});
// Шаг planStart == окну (нет разрывов/перекрытий).
assertEqual((got.c2 - got.c1) / 60, 19, '#3855 шаг c1→c2 == окно c1 (19), без разрыва');
assertEqual((got.c3 - got.c2) / 60, 114, '#3855 шаг c2→c3 == окно c2 (114)');
assertEqual((got.c4 - got.c3) / 60, 38, '#3855 шаг c3→c4 == окно c3 (38)');

// ── Обед: если резка стартует в/после 12:20 — перед ней пауза-обед 40 мин ──
// 3 резки по 130 мин: 08:00, 10:10, затем третья стартовала бы 12:20 → обед → 13:00.
var lunchCase = [ cut('L1', 0, 130), cut('L2', 0, 130), cut('L3', 0, 60) ];
var gl = planning.derivePlanStartTimestamps(lunchCase, { base: base, shiftStartMin: SHIFT_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR });
assertEqual(gl.L1, tsAtMin(0, 480), '#3855 обед: L1 08:00');
assertEqual(gl.L2, tsAtMin(0, 610), '#3855 обед: L2 10:10 (480+130)');
assertEqual(gl.L3, tsAtMin(0, 740 + 40), '#3855 обед: L3 13:00 (старт ≥ 12:20 → пауза-обед 40 перед ней)');

// ── Новый день: клок сбрасывается к 08:00 ──
var twoDays = [ cut('D1', 0, 100), cut('D2', 1, 50) ];
var g2 = planning.derivePlanStartTimestamps(twoDays, { base: base, shiftStartMin: SHIFT_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR });
assertEqual(g2.D2, tsAtMin(1, 480), '#3855 новый день: D2 → 08:00 следующего дня (клок сброшен)');

// ── Интеграция: computeCutSetupUpdates пересчитывает «Время старта» из тех же окон ──
// Мини-контроллер: 2 резки одного станка, та же конфигурация (сырьё A, ножи [50]). Первая —
// «ножи с нуля» 30 (нет заправки), вторая — 0. duration=10, лидер 0 → cutTime 10/10.
// Окна 40/10 → planStart 08:00 / 08:40, на целой минуте, встык.
var cutMeta = { id: '110', val: 'Задание в производство', reqs: [
    { id: '1092', val: 'Очередность' },
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
function icut(id, seq) {
    return { id: id, slitter: { id: '1', label: 'Станок 1' }, materialId: 'A', winding: 'OUT',
        batchId: 'b', knifeWidths: [50], knifeCount: 1, rollerWidth: 0, isFoil: false,
        plannedRuns: 2, duration: 10, sequence: seq, planDate: String(tsAtMin(0, SHIFT_START)),
        number: String(tsAtMin(0, SHIFT_START)),
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}
var ctrl = Object.create(api.Controller.prototype);
ctrl.meta = { cut: cutMeta };
ctrl.cuts = [icut('i1', 1), icut('i2', 2)];
ctrl.changeTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
ctrl.prevSetupBySlitter = {};   // нет заправки → первая резка «ножи с нуля» (30)
ctrl.filter = { date: '2026-06-29' };
ctrl.nowMs = function() { return base; };
ctrl.workingWindow = function() { return { startMin: SHIFT_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR, cutEndMin: 970, endMin: 990, cleanupMin: 30 }; };

var ires = ctrl.computeCutSetupUpdates(null);
var byId = {}; ires.updates.forEach(function(u) { byId[u.cutId] = u; });
assertEqual(!!(byId.i1 && byId.i2), true, '#3855 интеграция: обе резки в updates');
assertEqual(byId.i1 && byId.i1.knife, 30, '#3855 интеграция: первая резка — настройка ножей 30');
assertEqual(byId.i2 && byId.i2.knife, 0, '#3855 интеграция: вторая — 0 (та же конфигурация)');
assertEqual(byId.i1 && byId.i1.planStartTs, tsAtMin(0, 480), '#3855 интеграция: i1 «Время старта» = 08:00 (целая минута)');
assertEqual(byId.i2 && byId.i2.planStartTs, tsAtMin(0, 520), '#3855 интеграция: i2 = 08:40 (встык: 480 + окно 40)');
assertEqual(byId.i2.planStartTs % 60, 0, '#3855 интеграция: штамп на целой минуте');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
