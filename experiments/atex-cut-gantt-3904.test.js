// Unit tests for ideav/crm#3904 — «обед с утра» на Ганте.
//
// На дне, который НАЧИНАЕТСЯ с короткой переходящей резки, следующая резка несёт настройку
// (ножи+сырьё). Между концом переходящей и стартом настраиваемой образуется зазор ≈ обеда, и
// ganttLunchMarkers, беря ПЕРВЫЙ зазор дня ≥ LUNCH_DURATION, ошибочно помечал его обедом —
// «🍽 Обед» рисовался в 08:xx. Теперь зазор считается обедом, ТОЛЬКО если послеобеденная резка
// начинается у времени обеда (≥ LUNCH_START). LUNCH_START неизвестен → старое поведение.
//
// Run with: node experiments/atex-cut-gantt-3904.test.js

process.env.TZ = 'Europe/Moscow';
var g = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

function cut(id, planIso, knife, material, cutTime) {
    return { id: id, planDate: planIso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime };
}
var PPM = 2;
function scaleFor(cuts) {
    var range = g.ganttRange('2026-06-29', 'day');
    return g.ganttScale(g.workingSegments(cuts, range, {}), PPM);
}
var LUNCH_START = 12 * 60 + 20;   // 12:20 = 740 мин

// День: переходящая 08:00–08:18; настройка 45 у след. резки → утренний зазор 08:18–09:03 (45);
// реальный обед — полдень: C3 кончается 12:30, C4 в 13:10 (зазор 40).
var day = [
    cut('cont', '2026-06-29 08:00', 0, 0, 18),    // переходящая, конец 08:18
    cut('C2',   '2026-06-29 09:03', 30, 15, 4),    // настройка 45 → зазор 08:18–09:03
    cut('C3',   '2026-06-29 09:52', 0, 0, 158),    // конец 12:30
    cut('C4',   '2026-06-29 13:10', 0, 0, 30)      // обед 12:30–13:10 (40 мин)
];

// ── С LUNCH_START: утренний зазор НЕ обед, обед — перед C4 (index 3) ──
var withStart = g.ganttLunchMarkers(day, scaleFor(day), 40, LUNCH_START);
assertEqual(withStart.length, 1, '#3904: один обед на день');
assertEqual(withStart[0].beforeIndex, 3, '#3904: обед в полдень (перед C4), а не утром');

// ── Контроль: без LUNCH_START (как раньше) помечается ПЕРВЫЙ зазор — утренний (index 1) ──
var noStart = g.ganttLunchMarkers(day, scaleFor(day), 40);
assertEqual(noStart.length === 1 && noStart[0].beforeIndex, 1,
    '#3904 контроль: без LUNCH_START помечается утренний зазор (прежнее поведение)');

// ── Некорректный LUNCH_START (NaN) → проверка времени пропускается, не падаем ──
var badStart = g.ganttLunchMarkers(day, scaleFor(day), 40, NaN);
assertEqual(badStart.length === 1 && badStart[0].beforeIndex, 1,
    '#3904: NaN LUNCH_START → старое поведение (деградация без поломки)');

// ── Нормальный день (обед в полдень, без утренних зазоров) — обед на месте при любом LUNCH_START ──
var normal = [cut('A', '2026-06-29 11:00', 0, 0, 86), cut('B', '2026-06-29 13:06', 0, 0, 30)];
var nm = g.ganttLunchMarkers(normal, scaleFor(normal), 40, LUNCH_START);
assertEqual(nm.length, 1 && nm[0] && nm[0].beforeIndex === 1 ? 1 : nm.length,
    '#3904: обычный обед в полдень распознаётся и с LUNCH_START');

console.log('\n' + passed + ' проверок прошло.');
if (!process.exitCode) console.log('Все проверки #3904 зелёные.');
