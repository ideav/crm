// Regression test for ideav/crm#4041 (ревизия #4110) — обед на Ганте.
//
// #4110 «расширять фрагмент на длительность обеда»: бар несущего обед задания УДЛИНЯЕТСЯ на обед
// (работа + обед), а накладка обеда лежит НА баре. Старт бара — сохранённый (#4099, антинахлёст
// #3887 остаётся снятым; соседние бары не двигаем). Проверяем, что несущий бар растянут на обед и
// подпись показывает удлинённое окно (минуты в скобках — рабочие, обед в них не входит).
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

// ── #4110: несущий обед бар УДЛИНЯЕТСЯ на обед (65 работа + 40 обед = 105 мин); зазор до Q2 был
// зарезервирован генерацией под обед → удлинённый бар доходит ровно до Q2. Обед — накладка НА баре. ──
console.log('\n== #4110: несущий растянут на обед (12:00-13:45), обед накладкой НА баре ==');
var P2 = cut('P2', '2026-06-29 11:40', 0, 0, 18);   // → 11:58
var C2 = cut('C2', '2026-06-29 12:00', 0, 15, 50);  // старт 12:00, наладка 15 + резка 50 = работа 65
var Q2 = cut('Q2', '2026-06-29 13:45', 0, 0,  8);   // старт послеобеденной резки
var out2 = layout([P2, C2, Q2]);
var b2 = {}; out2.groups[0].tasks.forEach(function(t) { b2[t.cut.id] = t; });
var lunches2 = out2.groups[0].lunches || [];
assertEqual(lunches2.length, 1, 'обед-маркер ровно один');
assertEqual(lunches2[0].carrierIndex != null, true, 'обед привязан к несущему заданию (carrierIndex)');
assertEqual(b2['C2'].barText, '12:00-13:45 (65 мин)',
    '#4110 несущий C2: окно растянуто на обед 12:00-13:45 (в скобках 65 рабочих мин)');
assertEqual(b2['C2'].barMin, 65, 'несущий C2: рабочие минуты в подписи = 65 (обед не в счёт)');
assertEqual(Math.round(b2['C2'].widthPx / PPM), 105, '#4110 несущий C2: ширина бара = 65 работа + 40 обед = 105 мин');

// ── #4110: несущий на сохранённом старте (антинахлёст снят, #4099) РАСТЯНУТ на обед. Зазор до Q
// был под обед → удлинённый бар доходит ровно до старта Q (не заходит за него). ──
console.log('\n== #4110: несущий на сохранённом старте 11:58, растянут на обед до 13:43 ==');
var P = cut('P', '2026-06-29 11:50', 0, 0,  15);
var C = cut('C', '2026-06-29 11:58', 0, 15, 50);   // #4099: старт остаётся 11:58 (не сдвигается)
var Q = cut('Q', '2026-06-29 13:43', 0, 0,  8);
var out = layout([P, Q, C]);   // порядок входа перепутан нарочно — layoutGroups сам упорядочит
var byId = {}; out.groups[0].tasks.forEach(function(t) { byId[t.cut.id] = t; });
assertEqual(byId['C'].barText, '11:58-13:43 (65 мин)',
    '#4110 несущий C: окно растянуто на обед 11:58-13:43 (в скобках 65 рабочих мин), старт сохранён');
assertEqual(byId['C'].widthPx <= (byId['Q'].leftPx - byId['C'].leftPx) + 0.5, true,
    '#4110 несущий C: удлинённый на обед бар доходит до старта Q, но не заходит за него');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
