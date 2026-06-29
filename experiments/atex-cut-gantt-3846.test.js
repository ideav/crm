// Unit tests for #3846 (Гант) — подпись обеденного зазора «🍽 Обед · N мин».
//
// Обед (#3342) генерация зашивает в planStart послеобеденных резок: между концом окна одной
// резки и началом окна следующей в ТОМ ЖЕ дне образуется зазор ≈ LUNCH_DURATION. Раньше Гант
// его не подписывал → зазор читался как «дыра в планировании» (#3842/#3846). ganttLunchMarkers
// находит такой зазор и отдаёт маркер для строки «Обед», привязанный к началу послеобеденной
// резки (как блок обеда в «Планировании производства»).
//
// Run with: node experiments/atex-cut-gantt-3846.test.js

process.env.TZ = 'Europe/Moscow';
var g = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// Резка в форме отчёта Ганта: planDate (план старт), наладка ножей/сырья, «Резка и Лидер».
function cut(id, planIso, knife, material, cutTime) {
    return { id: id, planDate: planIso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime };
}
var PPM = 2;   // px на минуту — масштаб оси для проверки ширины маркера
function scaleFor(cuts) {
    var range = g.ganttRange('2026-06-29', 'day');
    return g.ganttScale(g.workingSegments(cuts, range, {}), PPM);
}

// ── Обеденный зазор: A 11:00–12:26 (86 мин), обед 40, B 13:06 ─────────────────────────────────
var dayCuts = [cut('A', '2026-06-29 11:00', 0, 0, 86), cut('B', '2026-06-29 13:06', 0, 0, 30)];
var marks = g.ganttLunchMarkers(dayCuts, scaleFor(dayCuts), 40);
assertEqual(marks.length, 1, '#3846 Гант: один обед на день');
assertEqual(marks[0].beforeIndex, 1, '#3846 Гант: маркер перед послеобеденной резкой (index 1)');
assertEqual(marks[0].durationMin, 40, '#3846 Гант: длительность обеда = LUNCH_DURATION (40)');
// Привязка к началу резки B: endMs == план старт B (13:06), startMs == 12:26.
assertEqual(g.formatTime ? g.formatTime(marks[0].endMs) : null,
    g.formatTime ? g.formatTime(g.parseDateTimeMs('2026-06-29 13:06')) : null,
    '#3846 Гант: обед заканчивается на старте послеобеденной резки (13:06)');
assertEqual(marks[0].endMs - marks[0].startMs, 40 * 60000, '#3846 Гант: окно маркера = 40 мин');
// Ширина в px = 40 мин × PPM (обед целиком в рабочем окне дня, ось линейна).
assertEqual(marks[0].widthPx, 40 * PPM, '#3846 Гант: ширина маркера = 40 × px/мин');

// ── Резки встык (зазор 0) — обеда нет ─────────────────────────────────────────────────────────
var packed = [cut('A', '2026-06-29 11:00', 0, 0, 60), cut('B', '2026-06-29 12:00', 0, 0, 30)];
assertEqual(g.ganttLunchMarkers(packed, scaleFor(packed), 40), [],
    '#3846 Гант: встык (зазор 0) → маркеров нет');

// ── Обед выключен (lunchDurationMin = 0) — маркеров нет ───────────────────────────────────────
assertEqual(g.ganttLunchMarkers(dayCuts, scaleFor(dayCuts), 0), [],
    '#3846 Гант: обед выключен → []');

// ── Зазор через ночь (стык дней) — НЕ обед ────────────────────────────────────────────────────
var twoDays = [cut('A', '2026-06-29 16:00', 0, 0, 30), cut('B', '2026-06-30 08:00', 0, 0, 30)];
assertEqual(g.ganttLunchMarkers(twoDays, scaleFor(twoDays), 40), [],
    '#3846 Гант: зазор между днями (ночь) обедом не считается');

// ── Несколько резок, один обеденный зазор → один маркер ───────────────────────────────────────
var threeDay = [cut('A', '2026-06-29 10:00', 0, 0, 60), cut('B', '2026-06-29 11:00', 0, 0, 86), cut('C', '2026-06-29 13:06', 0, 0, 30)];
var m3 = g.ganttLunchMarkers(threeDay, scaleFor(threeDay), 40);
assertEqual(m3.length, 1, '#3846 Гант: при нескольких резках обед на день один');
assertEqual(m3[0].beforeIndex, 2, '#3846 Гант: обед перед резкой C (index 2)');

console.log('\n' + passed + ' проверок прошло.');
