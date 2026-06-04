// Unit tests for the «Приёмка сырья» calc core (ideav/crm#2914).
// Verifies the design-spec / acceptance rules from docs/atex_workplaces.md §3.4:
//   • «Остаток, м²» инициализируется значением «Получено, м²»;
//   • партии упорядочиваются по дате прихода (FIFO — старые первыми).
//
// Run with: node experiments/atex-intake.test.js

var intake = require('../download/atex/js/intake.js');
var calc = intake.calc;
var helpers = intake.helpers;

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

// ── materialDefaultLength: длина джамбо по умолчанию из вида сырья ──
var materials = [
    { id: '1', label: 'MR194', rollLength: '4000' },
    { id: '2', label: 'MWR110L', rollLength: '' }
];
assertEqual(calc.materialDefaultLength(materials, '1'), 4000, 'default length from material roll length');
assertEqual(calc.materialDefaultLength(materials, 1), 4000, 'numeric id matches string stored id');
assertEqual(calc.materialDefaultLength(materials, '2'), 0, 'empty roll length → 0');
assertEqual(calc.materialDefaultLength(materials, '999'), 0, 'unknown material → 0');
assertEqual(calc.materialDefaultLength(materials, null), 0, 'null material → 0');

// ── barcode + server-side filters (#3094) ──
var batchMeta = {
    id: '106',
    val: 'Партия сырья',
    reqs: [
        { id: '1044', val: 'Вид сырья' },
        { id: '1155', val: 'Штрих-код' },
        { id: '1046', val: 'Дата прихода' },
        { id: '1048', val: 'Получено, м²' },
        { id: '1050', val: 'Остаток, м²' },
        { id: '1147', val: 'Длина, м' },
        { id: '1148', val: 'Остаток, м' }
    ]
};

assertEqual(helpers.reqIdByName(batchMeta, 'штрих-код'), '1155', 'reqIdByName finds barcode id');
assertEqual(helpers.columnIndex(batchMeta, 'Штрих-код'), 2, 'columnIndex includes barcode after material');

assertEqual(helpers.mapBatchRecord({
    i: 301,
    r: ['MR131 от 2026-06-01', '201:MR131', '4607001234567', '2026-06-01', '1000', '750', '1200', '900']
}, batchMeta), {
    id: '301',
    name: 'MR131 от 2026-06-01',
    materialId: '201',
    materialLabel: 'MR131',
    barcode: '4607001234567',
    arrivedAt: '2026-06-01',
    received: '1000',
    remainder: '750',
    lengthM: '1200',
    remainderM: '900'
}, 'mapBatchRecord reads barcode from JSON_OBJ row');

assertEqual(helpers.buildBatchListPath(batchMeta, {
    materialId: '201',
    barcode: '460700',
    arrivedAt: '2026-06-01'
}, 5000), 'object/106/?JSON_OBJ&LIMIT=0,5000&FR_1044=%40201&FR_1155=460700%25&FR_1046=2026-06-01',
    'buildBatchListPath re-queries object endpoint with material/barcode/date filters');

assertEqual(helpers.buildBatchFields(batchMeta, {
    materialId: '201',
    barcode: ' 4607001234567 ',
    arrivedAt: '2026-06-01',
    received: '1 000,5',
    remainder: '',
    lengthM: '1200',
    remainderM: ''
}), {
    t1044: '201',
    t1155: '4607001234567',
    t1046: '2026-06-01',
    t1048: 1000.5,
    t1050: 1000.5,
    t1147: 1200,
    t1148: 1200
}, 'buildBatchFields includes barcode and default remainders');

console.log('\n' + passed + ' assertions passed');
