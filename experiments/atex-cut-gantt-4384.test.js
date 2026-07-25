// Unit test for ideav/crm#4384 — «Диаграмма Ганта (задания)».
// При выборе даты в поле `.atex-cg-date` диапазон `.atex-cg-range` должен СТАРТОВАТЬ
// с выбранной даты (а не выравниваться на понедельник недели / 1-е число месяца, как
// делает ganttRange). Проверяем чистое ядро modeRangeFromDate + что построенный из
// него #3713-диапазон ganttRangeFromTo действительно начинается с выбранной даты.
//
// Run with: node experiments/atex-cut-gantt-4384.test.js

process.env.TZ = 'UTC';

var gantt = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// 2026-07-15 — среда (для контраста с выравниванием недели на понедельник 13-го).
var PICKED = '2026-07-15';

// ── modeRangeFromDate: [С; По] по режиму, начало = выбранная дата ──
assertEqual(gantt.modeRangeFromDate(PICKED, 'day'),
    { fromIso: '2026-07-15', toIso: '2026-07-15' }, 'day: 1 день, старт с даты');
assertEqual(gantt.modeRangeFromDate(PICKED, 'three'),
    { fromIso: '2026-07-15', toIso: '2026-07-17' }, '3 дня: старт с даты');
assertEqual(gantt.modeRangeFromDate(PICKED, 'week'),
    { fromIso: '2026-07-15', toIso: '2026-07-21' }, 'неделя: 7 дней ОТ даты, не с понедельника');
assertEqual(gantt.modeRangeFromDate(PICKED, 'month'),
    { fromIso: '2026-07-15', toIso: '2026-08-14' }, 'месяц: окно ≈месяц ОТ даты, не с 1-го числа');

// ── Ключевой инвариант: собранный из выбора #3713-диапазон СТАРТУЕТ с выбранной даты ──
['day', 'three', 'week', 'month'].forEach(function(mode) {
    var r = gantt.modeRangeFromDate(PICKED, mode);
    var range = gantt.ganttRangeFromTo(r.fromIso, r.toIso);
    assertEqual(range.startIso, PICKED, mode + ': ganttRangeFromTo.startIso = выбранная дата');
    // подсветка режима сохраняется (daySpanToMode по длине окна)
    assertEqual(range.mode, mode, mode + ': режим окна совпадает с выбранным');
});

// ── Контраст: старый путь (ganttRange от якоря) НЕ стартует с даты в неделе/месяце ──
assertEqual(gantt.ganttRange(PICKED, 'week').startIso, '2026-07-13',
    'контроль: ganttRange(неделя) выравнивает на понедельник 13-го');
assertEqual(gantt.ganttRange(PICKED, 'month').startIso, '2026-07-01',
    'контроль: ganttRange(месяц) выравнивает на 1-е число');

// ── Устойчивость к мусорному вводу — не падать, начинать с валидной даты ──
var junk = gantt.modeRangeFromDate('', 'week');
assertEqual(typeof junk.fromIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(junk.fromIso), true,
    'пустой ввод: fromIso — валидная ISO-дата (не падаем)');

// ── Нормализация режима: неизвестный режим → день ──
assertEqual(gantt.modeRangeFromDate(PICKED, 'xyz'),
    { fromIso: '2026-07-15', toIso: '2026-07-15' }, 'неизвестный режим → день');

console.log('\n' + passed + ' assertions passed');
