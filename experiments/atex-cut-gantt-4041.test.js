// Regression test for ideav/crm#4041 — «перерывы должны сдвигать конец задания; числа обеда».
//
// На Ганте задание, на которое приходится обед, показывалось «12:02-13:42 (65 мин)» — пролёт 100 мин
// под работу 65, хотя 65 + обед 40 = 105. В БД старт этой резки = 11:58; scheduleFromStored/#3887
// антинахлёст двигал бар ВПЕРЁД встык за предыдущим (11:58 → 12:02), «съедая» ~4 мин обеденного
// зазора. При этом обед детектируется по СОХРАНЁННЫМ временам (ganttLunchMarkers → cutTimeRange), а
// левый край несущего бара брался уже СДВИНУТЫЙ → пролёт 12:02→13:42 = 100, обед визуально 35 вместо 40.
//
// Фикс (#4041): несущее обед задание при растяжке якорим на его СОХРАНЁННЫЙ старт (снимаем сдвиг
// встык #3887, сохраняем сдвиг за перерывы #4007) → пролёт бара честно охватывает работу + обед.
//
// Run with: node experiments/atex-cut-gantt-4041.test.js

process.env.TZ = 'Europe/Moscow';
var g = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var PPM = 2;                       // px на минуту
var LUNCH_START = 12 * 60 + 20;    // 12:20
var LUNCH_DUR = 40;
var ms = function(iso) { return g.parseDateTimeMs(iso); };
var RANGE = g.ganttRange('2026-06-29', 'day');
var NOW = ms('2026-06-01 00:00');   // всё в будущем → все резки запланированы (actualStart null)
function cut(id, planIso, knife, material, cutTime) {
    return { id: id, planDate: planIso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime,
             slitter: { id: '1', label: 'Станок 1' } };
}
function layout(cuts) {
    return g.layoutGroups(cuts, RANGE, NOW, {}, { pxPerMin: PPM, lunchDurationMin: LUNCH_DUR, lunchStartMin: LUNCH_START });
}

// ── Сценарий #4041: несущий обед бар СДВИНУТ антинахлёстом, но якорится на сохранённый старт ──
// P 11:50 (работа 15) заканчивается 12:05 → перекрывает сохранённый старт C (11:58) → #3887 двигает C
// на 12:05. C: наладка 15 + резка 50 = работа 65, сохранённый конец 13:03. Q 13:43 (зазор 40 = обед).
console.log('\n== #4041: несущий обед бар якорится на сохранённый старт (пролёт = работа + обед) ==');
var P = cut('P', '2026-06-29 11:50', 0, 0,  15);
var C = cut('C', '2026-06-29 11:58', 0, 15, 50);   // ← несущий обед, в БД 11:58
var Q = cut('Q', '2026-06-29 13:43', 0, 0,  8);
var out = layout([P, Q, C]);   // порядок входа перепутан нарочно — layoutGroups сам упорядочит
var tasks = out.groups[0].tasks;
var byId = {}; tasks.forEach(function(t) { byId[t.cut.id] = t; });
var lunches = out.groups[0].lunches || [];

assertEqual(lunches.length, 1, 'обед-маркер ровно один');
assertEqual(lunches[0].carrierIndex != null, true, 'обед привязан к несущему заданию (carrierIndex)');
// Несущий = C. Его бар должен начинаться с СОХРАНЁННОГО 11:58, а не со сдвинутого 12:05.
assertEqual(byId['C'].barText, '11:58-13:43 (65 мин)',
    'несущий C: подпись = сохранённый старт 11:58 → 13:43 (пролёт 105 = работа 65 + обед 40), не «12:05-…»');
assertEqual(byId['C'].barMin, 65, 'несущий C: рабочие минуты в подписи = 65 (обед в сумму не входит)');
// Пролёт бара (px) = 105 мин × PPM (11:58→13:43); левый край сдвинут назад к сохранённому старту.
var spanMin = Math.round(byId['C'].widthPx / PPM);
assertEqual(spanMin, 105, 'несущий C: ширина бара = 105 мин (11:58→13:43), обед не «усох» до 35');

// ── Контроль: несущий обед бар, который НЕ был сдвинут антинахлёстом, — подпись без изменений ──
// P2 заканчивается 11:58 (11:40 + 18), сохранённый старт C2 = 12:00 (нет перекрытия → сдвига нет).
console.log('\n== #4041: несдвинутый несущий — поведение прежнее (старт из БД совпадает с показом) ==');
var P2 = cut('P2', '2026-06-29 11:40', 0, 0, 18);   // → 11:58
var C2 = cut('C2', '2026-06-29 12:00', 0, 15, 50);  // старт 12:00, перекрытия с P2 нет
var Q2 = cut('Q2', '2026-06-29 13:45', 0, 0,  8);   // зазор от 13:05 = 40
var out2 = layout([P2, C2, Q2]);
var b2 = {}; out2.groups[0].tasks.forEach(function(t) { b2[t.cut.id] = t; });
assertEqual(b2['C2'].barText, '12:00-13:45 (65 мин)',
    'несдвинутый несущий C2: подпись со своего старта 12:00 → 13:45 (105 = 65 + 40), поведение прежнее');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
