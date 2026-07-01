// Unit tests for the «Перенести задание на другой день» ordering (ideav/crm#3602, #3923).
// Verifies the pure helper planMoveSequences — В КАКОМ ПОРЯДКЕ выстраиваются задания целевого
// дня станка при переносе задания в начало/конец дня. #3923: порядок дня задаёт planStart
// (planDate), «Очередность» больше не хранится, поэтому helper возвращает только { ordered }
// (желаемый порядок id); moveCutToDay присваивает по нему плейсхолдер-planStart, а
// autoSequenceQueue(preserveOrder) переупаковывает день встык.
//   • «в начало» — перемещаемое первым, прочие следом по их planStart;
//   • «в конец»  — прочие по planStart, перемещаемое последним;
//   • пустой день — перемещаемое одно;
//   • входной список дня сортируется по сохранённому planStart (затем ножи ↓, затем id);
//   • перемещаемое задание, случайно попавшее в список дня, не дублируется;
//   • зафиксированные задания цели тоже переупорядочиваются (перенос — наивысший приоритет).
//
// Run with: node experiments/atex-production-planning-3602.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Задания целевого дня (тот же станок), намеренно не по порядку planStart (planDate — unix-сек).
var dayCuts = [
    { id: 'b', planDate: '200', knifeCount: 10 },
    { id: 'a', planDate: '100', knifeCount: 6 },
    { id: 'c', planDate: '300', knifeCount: 16 }
];

// 1) В начало дня: перемещаемое M первым, прочие следом в порядке planStart a,b,c.
assertEqual(
    planning.planMoveSequences('M', dayCuts, 'start'),
    { ordered: ['M', 'a', 'b', 'c'] },
    'в начало дня — перемещаемое первым, прочие по planStart'
);

// 2) В конец дня: прочие по planStart a,b,c, перемещаемое последним.
assertEqual(
    planning.planMoveSequences('M', dayCuts, 'end'),
    { ordered: ['a', 'b', 'c', 'M'] },
    'в конец дня — перемещаемое последним'
);

// 3) Пустой день: перемещаемое одно.
assertEqual(
    planning.planMoveSequences('M', [], 'start'),
    { ordered: ['M'] },
    'пустой день — перемещаемое одно'
);
assertEqual(
    planning.planMoveSequences('M', [], 'end'),
    { ordered: ['M'] },
    'пустой день (конец) — перемещаемое одно'
);

// 4) Тай-брейк по ножам ↓ при равном/отсутствующем planStart.
assertEqual(
    planning.planMoveSequences('M', [
        { id: 'x', planDate: '', knifeCount: 6 },
        { id: 'y', planDate: '', knifeCount: 16 }
    ], 'end'),
    { ordered: ['y', 'x', 'M'] },
    'без planStart — порядок по ножам ↓ (16 раньше 6)'
);

// 5) Перемещаемое задание уже в списке дня (перенос в тот же день) — не дублируется.
assertEqual(
    planning.planMoveSequences('a', dayCuts, 'start'),
    { ordered: ['a', 'b', 'c'] },
    'перенос в тот же день — без дубля перемещаемого, в начало'
);
assertEqual(
    planning.planMoveSequences('a', dayCuts, 'end'),
    { ordered: ['b', 'c', 'a'] },
    'перенос в тот же день — без дубля перемещаемого, в конец'
);

// 6) Зафиксированные задания цели тоже переупорядочиваются (наивысший приоритет переноса).
assertEqual(
    planning.planMoveSequences('M', [
        { id: 'f1', planDate: '100', fixed: true },
        { id: 'f2', planDate: '200', fixed: true }
    ], 'start'),
    { ordered: ['M', 'f1', 'f2'] },
    'фиксация цели не мешает — зафиксированные следом'
);

// 7) Вход не мутируется (порядок исходного массива сохранён).
var orig = [
    { id: 'b', planDate: '200' },
    { id: 'a', planDate: '100' }
];
planning.planMoveSequences('M', orig, 'start');
assertEqual(
    orig.map(function(c) { return c.id; }),
    ['b', 'a'],
    'вход не мутируется'
);

console.log('\n' + passed + ' assertions passed');
