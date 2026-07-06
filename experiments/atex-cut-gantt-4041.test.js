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

// ── #4052: несущий обед бар УДЛИНЯЕТСЯ на длительность обеда (фрагмент расширяется), но не за
// старт следующего бара. C2 не сдвинут → удлинение до полного окна работа+обед = 105. ──
// P2 заканчивается 11:58 (11:40 + 18), сохранённый старт C2 = 12:00 (нет перекрытия → сдвига нет).
console.log('\n== #4052: несдвинутый несущий — удлинён на обед до 105 (работа 65 + обед 40) ==');
var P2 = cut('P2', '2026-06-29 11:40', 0, 0, 18);   // → 11:58
var C2 = cut('C2', '2026-06-29 12:00', 0, 15, 50);  // старт 12:00, наладка 15 + резка 50 = работа 65
var Q2 = cut('Q2', '2026-06-29 13:45', 0, 0,  8);   // старт послеобеденной резки (зазор от 13:05 = 40)
var out2 = layout([P2, C2, Q2]);
var b2 = {}; out2.groups[0].tasks.forEach(function(t) { b2[t.cut.id] = t; });
var lunches2 = out2.groups[0].lunches || [];
assertEqual(lunches2.length, 1, 'обед-маркер ровно один');
assertEqual(lunches2[0].carrierIndex != null, true, 'обед привязан к несущему заданию (carrierIndex)');
assertEqual(b2['C2'].barText, '12:00-13:45 (65 мин)',
    'несущий C2: удлинён на обед → 12:00-13:45 (пролёт 105 = работа 65 + обед 40); минуты — рабочие');
assertEqual(b2['C2'].barMin, 65, 'несущий C2: рабочие минуты в подписи = 65 (обед в сумму не входит)');
assertEqual(Math.round(b2['C2'].widthPx / PPM), 105, 'несущий C2: ширина бара = 105 мин (работа 65 + обед 40)');

// ── Сдвинутый антинахлёстом несущий: удлинение упирается в старт следующего бара (не перекрывая) ──
// P 11:50 (работа 15) заканчивается 12:05 → перекрывает сохранённый старт C (11:58) → #3887 двигает C
// на 12:05. Удлинение на обед 40 (12:05 + 65 + 40 = 13:50) упёрлось бы в Q (13:43) → обрезаем до Q.
console.log('\n== #4052: сдвинутый несущий — удлинение не заходит за старт следующего бара ==');
var P = cut('P', '2026-06-29 11:50', 0, 0,  15);
var C = cut('C', '2026-06-29 11:58', 0, 15, 50);   // сдвинут антинахлёстом на 12:05
var Q = cut('Q', '2026-06-29 13:43', 0, 0,  8);
var out = layout([P, Q, C]);   // порядок входа перепутан нарочно — layoutGroups сам упорядочит
var byId = {}; out.groups[0].tasks.forEach(function(t) { byId[t.cut.id] = t; });
assertEqual(byId['C'].barText, '12:05-13:43 (65 мин)',
    'сдвинутый несущий C: удлинён от сдвинутого старта 12:05 до старта Q 13:43 (не за него)');
assertEqual(byId['C'].widthPx <= (byId['Q'].leftPx - byId['C'].leftPx) + 0.5, true,
    'сдвинутый несущий C: правый край бара не заходит за старт следующего бара Q');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
