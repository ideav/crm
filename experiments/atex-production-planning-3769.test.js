// Тест issue #3769 (download/atex/js/production-planning.js):
// В конце .atex-pp-strip-row — «Срок изготовления» позиций задания; строка красится по
// сроку относительно «Даты план»: раньше → красный (is-overdue), дальше план+DAYS_FORECAST
// → жёлтый (is-far), в окне → без класса.
var assert = require('assert');
var planning = require('../download/atex/js/production-planning.js').planning;

function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (получено: ' + JSON.stringify(a) + ')'); }
function deq(a, b, msg) { assert.deepStrictEqual(a, b, msg + ' (получено: ' + JSON.stringify(a) + ')'); }

// --- dayKeyToDate: YYYYMMDD → Date / невалидное → null ---
var d = planning.dayKeyToDate(20260624);
assert(d instanceof Date && d.getFullYear() === 2026 && d.getMonth() === 5 && d.getDate() === 24, 'dayKeyToDate(20260624) → 24.06.2026');
eq(planning.dayKeyToDate(Infinity), null, 'dayKeyToDate(Infinity) → null');
eq(planning.dayKeyToDate(0), null, 'dayKeyToDate(0) → null');
eq(planning.dayKeyToDate(20261324), null, 'dayKeyToDate(13-й месяц) → null');

// --- formatDayKey: YYYYMMDD → DD.MM.YYYY ---
eq(planning.formatDayKey(20260624), '24.06.2026', 'formatDayKey 20260624');
eq(planning.formatDayKey(20260101), '01.01.2026', 'formatDayKey с ведущими нулями');
eq(planning.formatDayKey(Infinity), '', 'formatDayKey(Infinity) → пусто');

// round-trip: batchDateKey("DD.MM.YYYY") → formatDayKey == исходная строка
eq(planning.formatDayKey(planning.batchDateKey('24.06.2026')), '24.06.2026', 'round-trip batchDateKey→formatDayKey');

// --- dueColorClass: правила расцветки ---
var plan = 20260620;             // «Дата план» = 20.06.2026
var FC = 10;                     // DAYS_FORECAST = 10
eq(planning.dueColorClass(20260619, plan, FC), 'is-overdue', 'срок 19.06 < план 20.06 → красный');
eq(planning.dueColorClass(20260601, plan, FC), 'is-overdue', 'срок сильно раньше → красный');
eq(planning.dueColorClass(20260620, plan, FC), '', 'срок = план (день 0) → в окне, без класса');
eq(planning.dueColorClass(20260625, plan, FC), '', 'срок +5 дней (≤10) → в окне');
eq(planning.dueColorClass(20260630, plan, FC), '', 'срок +10 дней включительно → в окне');
eq(planning.dueColorClass(20260701, plan, FC), 'is-far', 'срок +11 дней (через границу месяца) → жёлтый');
eq(planning.dueColorClass(20260705, plan, FC), 'is-far', 'срок далеко в будущем → жёлтый');

// forecast выключен (null) → жёлтого нет, красный остаётся
eq(planning.dueColorClass(20260701, plan, null), '', 'forecast=null → нет жёлтого');
eq(planning.dueColorClass(20260619, plan, null), 'is-overdue', 'forecast=null → красный работает');

// невалидные ключи → без класса
eq(planning.dueColorClass(Infinity, plan, FC), '', 'нет срока → без класса');
eq(planning.dueColorClass(20260620, Infinity, FC), '', 'нет даты план → без класса');

// --- cutDueKeys: уникальные отсортированные сроки позиций задания ---
var genPositions = [
    { id: '1', dueKey: planning.batchDateKey('24.06.2026') }, // 20260624
    { id: '2', dueKey: planning.batchDateKey('20.06.2026') }, // 20260620
    { id: '3', dueKey: Infinity },                            // без срока
    { id: '4', dueKey: planning.batchDateKey('24.06.2026') }  // дубль срока
];
var supplies = [
    { cutId: '10', positionId: '1' },
    { cutId: '10', positionId: '2' },
    { cutId: '10', positionId: '1' },  // дубль позиции
    { cutId: '10', positionId: '3' },  // позиция без срока
    { cutId: '10', positionId: '4' },  // тот же срок, что у поз.1
    { cutId: '99', positionId: '2' }   // чужое задание — не учитываем
];
deq(planning.cutDueKeys({ id: '10' }, supplies, genPositions), [20260620, 20260624],
    'cutDueKeys: уникальные сроки задания 10, отсортированы, Infinity и чужой cut отброшены');
deq(planning.cutDueKeys({ id: '77' }, supplies, genPositions), [], 'cutDueKeys: нет обеспечений → []');
deq(planning.cutDueKeys({ id: '10' }, [], genPositions), [], 'cutDueKeys: нет supplies → []');

// --- интеграция: самый ранний срок задаёт цвет ---
var keys = planning.cutDueKeys({ id: '10' }, supplies, genPositions); // [20260620, 20260624]
// план 25.06.2026 → ранний срок 20.06 раньше → красный
eq(planning.dueColorClass(keys[0], 20260625, FC), 'is-overdue', 'интеграция: ранний срок раньше плана → красный');
// план 19.06.2026, forecast 10 → ранний срок 20.06 через +1 день → в окне
eq(planning.dueColorClass(keys[0], 20260619, FC), '', 'интеграция: ранний срок в окне → без класса');

// planDateDayKey (unix-штамп) совместим с dueColorClass
var planKeyFromTs = planning.planDateDayKey(String(Math.floor(Date.UTC(2026, 5, 20, 9, 0, 0) / 1000)));
assert(planKeyFromTs === 20260620 || planKeyFromTs === 20260619 || planKeyFromTs === 20260621,
    'planDateDayKey(unix) даёт YYYYMMDD ~20.06.2026 (зависит от TZ): ' + planKeyFromTs);

console.log('OK: atex-production-planning-3769.test');
