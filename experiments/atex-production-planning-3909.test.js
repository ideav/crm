// Unit tests for #3909 (ревизия #4099) — обед ФИКСИРУЕТСЯ в 12:20; #4099 бар несущего не растягивается.
//
// Заказчик (issue #3909): обед — реальная пауза 12:20–13:00 ВНУТРИ задания, идущего в это время;
// задание остаётся одной записью, но его полоса растягивается на LUNCH_DURATION (следующие задания
// реально сдвинуты на +40 ещё генерацией). Раньше обед «плавал» — рисовался в первом зазоре после
// 12:20 (на Ганте 12:53/14:25/12:46). Генерация уже даёт нужные planStart — это правки отображения:
//   • lunchBlocksFromSchedule (очередь) и ganttLunchMarkers (Гант) при известном LUNCH_START
//     показывают обед в 12:20 и помечают «несущее» задание (carrierCutId / carrierIndex);
//   • #4099 «рисуй как есть»: полоса несущего задания БОЛЬШЕ НЕ растягивается — обед рисуется
//     накладкой поверх реального бара по реальному времени.
// LUNCH_START неизвестен → прежняя привязка к зазору (деградация без поломки).
//
// Run with: node experiments/atex-production-planning-3909.test.js

process.env.TZ = 'Europe/Moscow';
var planning = require('../download/atex/js/production-planning.js').planning;
var gantt = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var LUNCH_START = 12 * 60 + 20;   // 740 = 12:20
var LUNCH_DUR = 40;

// ── ОЧЕРЕДЬ: lunchBlocksFromSchedule ──────────────────────────────────────────────────────────
// A — несущее задание: окно 11:00–12:30 (содержит 12:20). Зазор-обед 12:30–13:10. B — после обеда.
var schedule = [
    { cutId: 'A', startMin: 660, setupMin: 0, finishMin: 750, leaderMin: 0 },   // 11:00–12:30
    { cutId: 'B', startMin: 790, setupMin: 0, finishMin: 850, leaderMin: 0 }    // 13:10–14:10 (+40 обеда)
];
var lbsFixed = planning.lunchBlocksFromSchedule(schedule, { lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR });
assertEqual(lbsFixed.length, 1, '#3909 очередь: один обед на день');
assertEqual([lbsFixed[0].dispStartMin, lbsFixed[0].dispFinishMin], [740, 780],
    '#3909 очередь: обед показывается в 12:20–13:00 (а не в зазоре 12:30–13:10)');
assertEqual(lbsFixed[0].carrierCutId, 'A', '#3909 очередь: несущее обед задание — A (его окно содержит 12:20)');
assertEqual(lbsFixed[0].finishMin, 790, '#3909 очередь: ключ привязки строки — старт послеобеденной B (зазор)');

// LUNCH_START неизвестен → обед показывается в зазоре (прежнее поведение), carrierCutId нет.
var lbsOld = planning.lunchBlocksFromSchedule(schedule, { lunchDurationMin: LUNCH_DUR });
assertEqual([lbsOld[0].dispStartMin, lbsOld[0].dispFinishMin], [750, 790],
    '#3909 очередь: без LUNCH_START — обед в зазоре 12:30–13:10 (прежнее поведение)');
assertEqual(lbsOld[0].carrierCutId, null, '#3909 очередь: без LUNCH_START несущее не помечается');

// ── ГАНТ: ganttLunchMarkers ───────────────────────────────────────────────────────────────────
function gcut(id, planIso, knife, material, cutTime) {
    return { id: id, planDate: planIso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime };
}
function scaleFor(cuts) {
    var range = gantt.ganttRange('2026-06-29', 'day');
    return gantt.ganttScale(gantt.workingSegments(cuts, range, {}), 2);
}
// A: 11:00–12:26 (содержит 12:20). B: 13:06 — зазор-обед 12:26–13:06 (40).
var day = [gcut('A', '2026-06-29 11:00', 0, 0, 86), gcut('B', '2026-06-29 13:06', 0, 0, 30)];
var mk = gantt.ganttLunchMarkers(day, scaleFor(day), LUNCH_DUR, LUNCH_START);
assertEqual(mk.length, 1, '#3909 Гант: один обед на день');
assertEqual(mk[0].beforeIndex, 1, '#3909 Гант: строка обеда — перед послеобеденным заданием B');
assertEqual(mk[0].carrierIndex, 0, '#3909 Гант: несущее обед задание — A (index 0)');
var lunch1220 = new Date('2026-06-29 12:20').getTime();
var lunch1300 = new Date('2026-06-29 13:00').getTime();
assertEqual([mk[0].startMs, mk[0].endMs], [lunch1220, lunch1300],
    '#3909 Гант: маркер обеда в 12:20–13:00 (фиксированно), а не в зазоре после A');
assertEqual(mk[0].postStartMs, new Date('2026-06-29 13:06').getTime(),
    '#3909 Гант: postStartMs = старт послеобеденного B (предел растяжки несущего)');

// Без LUNCH_START — маркер в зазоре (прежнее поведение), carrierIndex отсутствует.
var mkOld = gantt.ganttLunchMarkers(day, scaleFor(day), LUNCH_DUR);
assertEqual(mkOld[0].carrierIndex, null, '#3909 Гант: без LUNCH_START несущее не помечается (carrierIndex null)');
assertEqual(mkOld[0].endMs, new Date('2026-06-29 13:06').getTime(),
    '#3909 Гант: без LUNCH_START маркер кончается на старте послеобеденного (зазор)');

// ── ГАНТ полностью (#4099): layoutGroups НЕ растягивает полосу несущего — рисуем как есть ──
var gcuts = [
    { id: 'A', planDate: '2026-06-29 11:00', cutTimeMin: 86, sequence: 1, slitter: { id: '1', label: 'Станок 1' } },
    { id: 'B', planDate: '2026-06-29 13:06', cutTimeMin: 30, sequence: 2, slitter: { id: '1', label: 'Станок 1' } }
];
var dayRange = gantt.ganttRange('2026-06-29', 'day');
var laid = gantt.layoutGroups(gcuts, dayRange, new Date('2026-06-29 10:00').getTime(), {},
    { pxPerMin: 1, lunchDurationMin: LUNCH_DUR, lunchStartMin: LUNCH_START });
var gA = laid.groups[0].tasks[0], gB = laid.groups[0].tasks[1];
// #4099: A — РЕАЛЬНОЙ ширины (11:00, cut 86 → 12:26 = 86 px при ppm=1), НЕ растянут до старта B.
assertEqual(gA.widthPx, 86, '#4099 Гант: полоса несущего A — реальная (86 px), не растянута на обед');
assertEqual(gA.barText, '11:00-12:26 (86 мин)',
    '#4099 Гант: подпись несущего — реальное окно 11:00–12:26 (86 мин)');
assertEqual(laid.groups[0].lunches[0].carrierIndex, 0, '#3909 Гант: layoutGroups помечает несущее A');
// barMin (для «Σ мин» станка) — рабочие, без обеда.
assertEqual(gA.barMin, 86, '#3909 Гант: barMin несущего = рабочие минуты (86), обед в сумму не входит');

console.log('\n' + passed + ' проверок прошло.');
