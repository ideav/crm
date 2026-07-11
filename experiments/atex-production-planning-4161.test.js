// Tests for ideav/crm#4161 — панель «Качество плана» показывает КРАСНЫМ число просроченных
// заданий, только если такие есть (.atex-pp-quality).
//
// countOverdueCuts(cuts, supplies, genPositions, {scopeFromKey, scopeToKey, forecastDays}) — число
// заданий окна, у которых плановый день ПОЗЖЕ самого раннего «Срока изготовления» позиций
// (dueColorClass → 'is-overdue', как красит строку карточки #3769/#4051). Окно — тот же предикат
// [С;По], что «всего заданий» (storedSetupTotals), поэтому «просрочено» ≤ показанного числа заданий.
// Рендер добавляет красный пункт ТОЛЬКО когда N>0.
//
// Run with: node experiments/atex-production-planning-4161.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function sec(y, m, d) { return String(Math.floor(Date.UTC(y, m - 1, d) / 1000)); }   // unix-сек → «Дата план»

// genPositions: срок позиции (dueKey YYYYMMDD). P_F без срока → фолбэк на supply.dueKey (#4051).
var genPositions = [
    { id: 'P_A', dueKey: 20260703 },   // раньше плана A (05.07) → просрочено
    { id: 'P_B', dueKey: 20260710 },   // позже плана B → в срок
    { id: 'P_C', dueKey: 20260706 },   // = плану C → в срок (не «раньше»)
    { id: 'P_D', dueKey: 20260701 },   // раньше плана D (07.07) → просрочено
    { id: 'P_F' }                       // без срока в genPositions → возьмём supply.dueKey
];
var supplies = [
    { cutId: 'A', positionId: 'P_A' },
    { cutId: 'B', positionId: 'P_B' },
    { cutId: 'C', positionId: 'P_C' },
    { cutId: 'D', positionId: 'P_D' },
    { cutId: 'F', positionId: 'P_F', dueKey: 20260701 }   // фолбэк из cut_planning (#4051): раньше плана F → просрочено
];
var cuts = [
    { id: 'A', planDate: sec(2026, 7, 5) },
    { id: 'B', planDate: sec(2026, 7, 5) },
    { id: 'C', planDate: sec(2026, 7, 6) },
    { id: 'D', planDate: sec(2026, 7, 7) },
    { id: 'E', planDate: sec(2026, 7, 6) },   // без обеспечения/срока → не считается
    { id: 'F', planDate: sec(2026, 7, 8) }
];

// ── Весь план (без окна): просрочены A, D, F = 3 (E без срока, B/C в срок не в счёт) ──
assertEqual(planning.countOverdueCuts(cuts, supplies, genPositions, {}), 3,
    '#4161: по всему плану просрочено 3 (A,D,F); B/C в срок, E без срока — не в счёт');

// ── Окно [05.07; 06.07]: A,B,C,E. Просрочено — только A (D=07, F=08 вне окна) ──
assertEqual(planning.countOverdueCuts(cuts, supplies, genPositions, { scopeFromKey: 20260705, scopeToKey: 20260706 }), 1,
    '#4161: окно [05;06] — просрочено 1 (только A; D/F вне окна не считаются)');

// ── Окно [07.07; …]: D,F → 2 (в т.ч. F по фолбэку supply.dueKey #4051) ──
assertEqual(planning.countOverdueCuts(cuts, supplies, genPositions, { scopeFromKey: 20260707 }), 2,
    '#4161: окно [07;…] — просрочено 2 (D + F по фолбэку срока из обеспечения)');

// ── forecastDays не влияет на просрочку (он лишь для жёлтого «is-far») ──
assertEqual(planning.countOverdueCuts(cuts, supplies, genPositions, { forecastDays: 3 }), 3,
    '#4161: forecastDays не меняет число просроченных (просрочка forecast-независима)');

// ── Нет просроченных → 0 (тогда рендер НЕ показывает красный пункт) ──
var onTime = [{ id: 'X', planDate: sec(2026, 7, 1) }];
var onTimeSup = [{ cutId: 'X', positionId: 'P_B' }];   // срок 10.07 позже плана 01.07
assertEqual(planning.countOverdueCuts(onTime, onTimeSup, genPositions, {}), 0,
    '#4161: план без просрочки → 0 (красный пункт не рисуется)');

// ── Пустой ввод устойчив ──
assertEqual(planning.countOverdueCuts([], supplies, genPositions, {}), 0, '#4161: пустой список резок → 0');
assertEqual(planning.countOverdueCuts(null, null, null, null), 0, '#4161: null-аргументы → 0 (без падения)');

console.log('\n' + passed + '/' + total + ' проверок пройдено.');
if (passed !== total) process.exitCode = 1;
