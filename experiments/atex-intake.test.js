// Unit tests for the «Приёмка сырья» calc core (ideav/crm#2914).
// Verifies the design-spec / acceptance rules from docs/atex_workplaces.md §3.4:
//   • «Остаток, м²» инициализируется значением «Получено, м²»;
//   • партии упорядочиваются по дате прихода (FIFO — старые первыми).
//
// Run with: node experiments/atex-intake.test.js

var calc = require('../download/atex/js/intake.js').calc;

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

// ── toNumber: терпимый разбор ──
assertEqual(calc.toNumber('1250'), 1250, 'toNumber parses integer string');
assertEqual(calc.toNumber('1250,5'), 1250.5, 'toNumber accepts comma decimal');
assertEqual(calc.toNumber(' 1 200 '), 1200, 'toNumber strips spaces');
assertEqual(calc.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(calc.toNumber('abc'), 0, 'toNumber garbage → 0');

// ── initialRemainder: критерий приёмки #2914 (остаток = получено) ──
assertEqual(calc.initialRemainder(1500), 1500, 'initialRemainder equals received (integer)');
assertEqual(calc.initialRemainder('1500,25'), 1500.25, 'initialRemainder parses comma decimal');
assertEqual(calc.initialRemainder(''), 0, 'initialRemainder of empty received → 0');
assertEqual(calc.initialRemainder('1 000'), 1000, 'initialRemainder strips spaces');

// ── dateKey: сортировочный ключ для FIFO ──
assertEqual(calc.dateKey('2026-05-29'), 20260529, 'dateKey parses ISO date');
assertEqual(calc.dateKey('29.05.2026'), 20260529, 'dateKey parses Д.М.Г date');
assertEqual(calc.dateKey('2026-01-02') < calc.dateKey('2026-05-29'), true, 'earlier ISO date sorts first');
assertEqual(calc.dateKey(''), Infinity, 'empty date sorts last (Infinity)');

// ── sortFifo: старые партии первыми, не мутирует вход ──
var batches = [
    { id: 'b3', arrivedAt: '2026-05-29', received: 100, remainder: 100 },
    { id: 'b1', arrivedAt: '2026-05-01', received: 200, remainder: 50 },
    { id: 'b2', arrivedAt: '2026-05-15', received: 300, remainder: 300 }
];
assertEqual(calc.sortFifo(batches).map(function(b) { return b.id; }), ['b1', 'b2', 'b3'],
    'sortFifo orders batches ascending by arrival date');
// Исходный массив не изменился.
assertEqual(batches.map(function(b) { return b.id; }), ['b3', 'b1', 'b2'],
    'sortFifo does not mutate the input array');

// Равные даты сохраняют исходный порядок (стабильность).
var sameDate = [
    { id: 'x', arrivedAt: '2026-05-10' },
    { id: 'y', arrivedAt: '2026-05-10' },
    { id: 'z', arrivedAt: '2026-05-09' }
];
assertEqual(calc.sortFifo(sameDate).map(function(b) { return b.id; }), ['z', 'x', 'y'],
    'sortFifo is stable for equal dates');

// Партия без даты прихода уходит в конец очереди.
var withMissing = [
    { id: 'no-date', arrivedAt: '' },
    { id: 'dated', arrivedAt: '2026-05-20' }
];
assertEqual(calc.sortFifo(withMissing).map(function(b) { return b.id; }), ['dated', 'no-date'],
    'sortFifo pushes batches without a date to the end');

// ── summarize: сводка по партиям ──
assertEqual(calc.summarize(batches), {
    count: 3,
    totalReceived: 600,   // 100 + 200 + 300
    totalRemaining: 450   // 100 + 50 + 300
}, 'summarize aggregates count / received / remaining');
assertEqual(calc.summarize([]), { count: 0, totalReceived: 0, totalRemaining: 0 },
    'summarize of empty set is all zeros');

// Запятые-разделители и пробелы в суммах учитываются.
assertEqual(calc.summarize([
    { received: '1 000,5', remainder: '1 000,5' },
    { received: '500', remainder: '250' }
]), { count: 2, totalReceived: 1500.5, totalRemaining: 1250.5 },
    'summarize parses comma decimals and spaces');

console.log('\n' + passed + ' assertions passed');
