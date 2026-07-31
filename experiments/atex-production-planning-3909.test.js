// Unit tests for #3909 (ревизия #4110) — обед ФИКСИРУЕТСЯ в 12:20 и растягивает несущий бар.
//
// Заказчик (issue #3909): обед — реальная пауза 12:20–13:00 ВНУТРИ задания, идущего в это время;
// задание остаётся одной записью, но его полоса растягивается на LUNCH_DURATION (следующие задания
// реально сдвинуты на +40 ещё генерацией). Раньше обед «плавал» — рисовался в первом зазоре после
// 12:20 (на Ганте 12:53/14:25/12:46). Генерация уже даёт нужные planStart — это правки отображения:
//   • lunchBlocksFromSchedule (очередь) и ganttLunchMarkers (Гант) при известном LUNCH_START
//     показывают обед в 12:20 и помечают «несущее» задание (carrierCutId / carrierIndex);
//   • #4110: полоса несущего задания растягивается на длительность обеда, а серая накладка
//     ложится НА бар — иначе она «висит в конце», когда обед попал в зазор после резки.
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

// Блок про lunchBlocksFromSchedule убран вместе с самой функцией (мёртвый код): обед на экране —
// накладка на несущей карточке, её проверяют atex-production-planning-4075 и atex-cut-gantt-4052.

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

// ── ГАНТ полностью (#4110): layoutGroups растягивает полосу несущего на обед ──
var gcuts = [
    { id: 'A', planDate: '2026-06-29 11:00', cutTimeMin: 86, sequence: 1, slitter: { id: '1', label: 'Станок 1' } },
    { id: 'B', planDate: '2026-06-29 13:06', cutTimeMin: 30, sequence: 2, slitter: { id: '1', label: 'Станок 1' } }
];
var dayRange = gantt.ganttRange('2026-06-29', 'day');
var laid = gantt.layoutGroups(gcuts, dayRange, new Date('2026-06-29 10:00').getTime(), {},
    { pxPerMin: 1, lunchDurationMin: LUNCH_DUR, lunchStartMin: LUNCH_START });
var gA = laid.groups[0].tasks[0], gB = laid.groups[0].tasks[1];
// #4110: A (11:00, cut 86 → 12:26) несёт обед 40 мин → бар 86 + 40 = 126 px, окно до 13:06;
// в скобках — РАБОЧИЕ минуты (86), обед в них не входит.
assertEqual(gA.widthPx, 126, '#4110 Гант: полоса несущего A растянута на обед (86 + 40 = 126 px)');
assertEqual(gA.barText, '11:00-13:06 (86 мин)',
    '#4110 Гант: подпись несущего — удлинённое окно 11:00–13:06, в скобках рабочие 86 мин');
assertEqual(laid.groups[0].lunches[0].carrierIndex, 0, '#3909 Гант: layoutGroups помечает несущее A');
// barMin (для «Σ мин» станка) — рабочие, без обеда.
assertEqual(gA.barMin, 86, '#3909 Гант: barMin несущего = рабочие минуты (86), обед в сумму не входит');

console.log('\n' + passed + ' проверок прошло.');
