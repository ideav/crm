// Regression test for ideav/crm#4041 (ревизия #4099) — обед на Ганте.
//
// #4099 «рисуй как есть»: бары рисуются на СОХРАНЁННОМ старте реальной ширины, антинахлёст (#3887)
// и удлинение несущего на обед (#4052) СНЯТЫ. Обед — накладка поверх реального бара по его реальному
// времени. Проверяем, что бар несущего обед задания имеет реальную ширину (работа, без обеда) и
// стоит на своём сохранённом старте (не сдвигается встык за предыдущим).
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

// ── #4099: несущий обед бар — РЕАЛЬНОЙ ширины (65 мин), НЕ удлиняется на обед. Обед — накладка
// поверх бара по реальному времени. C2 не сдвинут (нет перекрытия сохранённого старта). ──
console.log('\n== #4099: несущий — реальная ширина 65 (обед накладкой, бар не растянут) ==');
var P2 = cut('P2', '2026-06-29 11:40', 0, 0, 18);   // → 11:58
var C2 = cut('C2', '2026-06-29 12:00', 0, 15, 50);  // старт 12:00, наладка 15 + резка 50 = работа 65
var Q2 = cut('Q2', '2026-06-29 13:45', 0, 0,  8);   // старт послеобеденной резки
var out2 = layout([P2, C2, Q2]);
var b2 = {}; out2.groups[0].tasks.forEach(function(t) { b2[t.cut.id] = t; });
var lunches2 = out2.groups[0].lunches || [];
assertEqual(lunches2.length, 1, 'обед-маркер ровно один');
assertEqual(lunches2[0].carrierIndex != null, true, 'обед привязан к несущему заданию (carrierIndex)');
assertEqual(b2['C2'].barText, '12:00-13:05 (65 мин)',
    '#4099 несущий C2: реальное окно 12:00-13:05 (65 мин), бар не растянут на обед');
assertEqual(b2['C2'].barMin, 65, 'несущий C2: рабочие минуты в подписи = 65');
assertEqual(Math.round(b2['C2'].widthPx / PPM), 65, '#4099 несущий C2: ширина бара = реальные 65 мин (без обеда)');

// ── #4099: перекрытие сохранённых стартов — бары КАК ЕСТЬ (антинахлёст снят). C на своём 11:58. ──
console.log('\n== #4099: перекрытие — бар на сохранённом старте, не сдвигается ==');
var P = cut('P', '2026-06-29 11:50', 0, 0,  15);
var C = cut('C', '2026-06-29 11:58', 0, 15, 50);   // #4099: остаётся на 11:58 (не сдвигается)
var Q = cut('Q', '2026-06-29 13:43', 0, 0,  8);
var out = layout([P, Q, C]);   // порядок входа перепутан нарочно — layoutGroups сам упорядочит
var byId = {}; out.groups[0].tasks.forEach(function(t) { byId[t.cut.id] = t; });
assertEqual(byId['C'].barText, '11:58-13:03 (65 мин)',
    '#4099 несущий C: реальное окно 11:58-13:03 (65 мин), на сохранённом старте (не сдвинут)');
assertEqual(byId['C'].widthPx <= (byId['Q'].leftPx - byId['C'].leftPx) + 0.5, true,
    '#4099 несущий C: реальная ширина не заходит за старт следующего бара Q');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
