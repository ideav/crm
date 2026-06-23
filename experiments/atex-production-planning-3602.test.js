// Unit tests for the «Перенести задание на другой день» sequencing (ideav/crm#3602).
// Verifies the pure helper planMoveSequences — какую «Очередность» получают задания
// целевого дня станка при переносе задания в начало/конец дня:
//   • «в начало» — перемещаемое получает 1, прочие сдвигаются на 2..N+1;
//   • «в конец»  — прочие сохраняют 1..N, перемещаемое получает N+1;
//   • пустой день — перемещаемое одно, очередность 1;
//   • входной список дня сортируется по сохранённой «Очередности» (затем ножи ↓);
//   • перемещаемое задание, случайно попавшее в список дня, не дублируется.
//
// Перенос имеет наивысший приоритет (#3602): зафиксированные задания цели тоже
// перенумеровываются — флаг fixed на сортировку/нумерацию не влияет.
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

// Задания целевого дня (тот же станок), намеренно не по порядку «Очередности».
var dayCuts = [
    { id: 'b', sequence: 2, knifeCount: 10 },
    { id: 'a', sequence: 1, knifeCount: 6 },
    { id: 'c', sequence: 3, knifeCount: 16 }
];

// 1) В начало дня: перемещаемое M → 1, прочие сдвигаются 2,3,4 в порядке очереди a,b,c.
assertEqual(
    planning.planMoveSequences('M', dayCuts, 'start'),
    { ordered: ['M', 'a', 'b', 'c'], seqByCut: { M: 1, a: 2, b: 3, c: 4 } },
    'в начало дня — перемещаемое первым, прочие сдвинуты'
);

// 2) В конец дня: прочие сохраняют 1,2,3, перемещаемое → 4.
assertEqual(
    planning.planMoveSequences('M', dayCuts, 'end'),
    { ordered: ['a', 'b', 'c', 'M'], seqByCut: { a: 1, b: 2, c: 3, M: 4 } },
    'в конец дня — перемещаемое последним'
);

// 3) Пустой день: перемещаемое одно, очередность 1.
assertEqual(
    planning.planMoveSequences('M', [], 'start'),
    { ordered: ['M'], seqByCut: { M: 1 } },
    'пустой день — перемещаемое одно, № 1'
);
assertEqual(
    planning.planMoveSequences('M', [], 'end'),
    { ordered: ['M'], seqByCut: { M: 1 } },
    'пустой день (конец) — перемещаемое одно, № 1'
);

// 4) Тай-брейк по ножам ↓ при равной/отсутствующей «Очередности».
assertEqual(
    planning.planMoveSequences('M', [
        { id: 'x', sequence: null, knifeCount: 6 },
        { id: 'y', sequence: null, knifeCount: 16 }
    ], 'end'),
    { ordered: ['y', 'x', 'M'], seqByCut: { y: 1, x: 2, M: 3 } },
    'без очередности — порядок по ножам ↓ (16 раньше 6)'
);

// 5) Перемещаемое задание уже в списке дня (перенос в тот же день) — не дублируется.
assertEqual(
    planning.planMoveSequences('a', dayCuts, 'start'),
    { ordered: ['a', 'b', 'c'], seqByCut: { a: 1, b: 2, c: 3 } },
    'перенос в тот же день — без дубля перемещаемого, в начало'
);
assertEqual(
    planning.planMoveSequences('a', dayCuts, 'end'),
    { ordered: ['b', 'c', 'a'], seqByCut: { b: 1, c: 2, a: 3 } },
    'перенос в тот же день — без дубля перемещаемого, в конец'
);

// 6) Зафиксированные задания цели тоже перенумеровываются (наивысший приоритет переноса).
assertEqual(
    planning.planMoveSequences('M', [
        { id: 'f1', sequence: 1, fixed: true },
        { id: 'f2', sequence: 2, fixed: true }
    ], 'start'),
    { ordered: ['M', 'f1', 'f2'], seqByCut: { M: 1, f1: 2, f2: 3 } },
    'фиксация цели не мешает — зафиксированные сдвигаются'
);

// 7) Вход не мутируется (порядок исходного массива сохранён).
var orig = [
    { id: 'b', sequence: 2 },
    { id: 'a', sequence: 1 }
];
planning.planMoveSequences('M', orig, 'start');
assertEqual(
    orig.map(function(c) { return c.id; }),
    ['b', 'a'],
    'вход не мутируется'
);

console.log('\n' + passed + ' assertions passed');
