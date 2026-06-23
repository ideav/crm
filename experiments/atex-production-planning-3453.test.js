// Unit tests for #3453 — не планировать резки без партии сырья.
// Контракт pickBatchFIFOForRun: возвращает null, если активной «Партии сырья» этого
// вида с остатком нет. runGenerateCuts на этом null пропускает раскладку (не создаёт
// резку с пустой «Партией сырья»).
//
// Run with: node experiments/atex-production-planning-3453.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var pick = planning.pickBatchFIFOForRun;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var batches = [
    { id: '10', materialId: 'M1', active: true, dateKey: 20260101, remainder: 500 },
    { id: '11', materialId: 'M1', active: true, dateKey: 20260102, remainder: 500 },
    { id: '20', materialId: 'M2', active: false, dateKey: 20260101, remainder: 500 }  // не активна
];

// Нет ни одной партии этого вида → null (резку не планируем).
assert(pick(batches, 'M3', 100, null) === null, 'нет партий вида M3 → null');

// Партия есть, но неактивна → null.
assert(pick(batches, 'M2', 100, null) === null, 'партия M2 неактивна → null');

// Есть активная партия с остатком → FIFO по dateKey (самая ранняя).
assert(pick(batches, 'M1', 100, null) === '10', 'M1 → самая ранняя партия 10 (FIFO)');

// Остаток исчерпан резервом прогонов → null (нечем обеспечить).
var rem = { '10': 0, '11': 0 };
assert(pick(batches, 'M1', 100, rem) === null, 'остаток партий M1 исчерпан → null');

// Частичный остаток: партия 10 пуста, 11 свободна → берём 11.
var rem2 = { '10': 0, '11': 300 };
assert(pick(batches, 'M1', 100, rem2) === '11', 'партия 10 пуста → берём 11');

// Пустой справочник партий → null.
assert(pick([], 'M1', 100, null) === null, 'нет партий вообще → null');

console.log('\n' + passed + ' passed');
