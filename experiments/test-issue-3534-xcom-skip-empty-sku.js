// Тест issue #3534: отчёт mass_match иногда возвращает ведущую служебную строку без SKU
// (пустые SKUID/Артикул/Наименование, в «токенах» — требования RFP). Раньше она становилась
// «Наш артикул» → our=null → в строку RFP писалась заглушка «0», хотя реальные кандидаты были.
// Теперь pickMatches пропускает строки без SKUID: «Наш артикул» = первый настоящий SKU,
// точность считается по ЕГО токенам.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'download', 'xcom', 'js', 'xcom-mass-match.js');
assert(fs.existsSync(scriptPath), 'download/xcom/js/xcom-mass-match.js exists');

const source = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {
    window: {},
    document: {
        readyState: 'loading',
        addEventListener: function() {},
        getElementById: function() { return null; }
    },
    console,
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    fetch: function() { throw new Error('fetch should not be called by helper tests'); }
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'xcom-mass-match.js' });

const api = sandbox.window.XcomMassMatchWorkspace;
assert(api && typeof api.pickMatches === 'function', 'pickMatches exported');

// Реальный ответ mass_match для RFP 10462220-1 (из issue #3534): первая строка пустая, дальше — SKU.
const rows = [
    { RFP: '10462220-1', 'Наименование SKU': '', 'токены': '2000стр,быть,ГК,должен,изготовлен,компанией,печатного,производителем,расходный', 'Вес': '9', 'ТММ': '0', 'Артикул': '', SKUID: '' },
    { RFP: '10462220-1', 'Наименование SKU': 'Картридж Sakura SA12016SE для Lexmark E120/E120n, черный, 2000 к.', 'токены': '120,E,Lexmark,N,Картридж', 'Вес': '7', 'ТММ': '0', 'Артикул': 'SA12016SE', SKUID: '4174263' },
    { RFP: '10462220-1', 'Наименование SKU': 'Картридж Cactus CS-LX120 для Lexmark E120N, 2000 стр.', 'токены': '120,E,Lexmark,N,Картридж', 'Вес': '7', 'ТММ': '0', 'Артикул': 'CS-LX120', SKUID: '4195432' },
    { RFP: '10462220-1', 'Наименование SKU': 'Картридж Lexmark 12016SE для принтера E120/E120n на 2000 страниц', 'токены': '120,E,Lexmark,N,Картридж', 'Вес': '7', 'ТММ': '0', 'Артикул': '12016SE', SKUID: '4145074' }
];

const picked = api.pickMatches(rows);

// «Наш артикул» = ПЕРВЫЙ настоящий SKU, а не пустая служебная строка (раньше тут был null → «0»).
assert(picked.our, 'our не должен быть null — кандидаты есть');
assert.strictEqual(picked.our.id, '4174263', 'our.id = SKUID первого настоящего SKU');
assert.strictEqual(picked.our.label, 'Картридж Sakura SA12016SE для Lexmark E120/E120n, черный, 2000 к.', 'our.label = наименование SKU');

// Кандидаты — остальные настоящие SKU (без служебной строки).
assert.strictEqual(picked.candidates.length, 2, 'кандидатов — 2 (служебная строка отброшена)');
assert.deepStrictEqual(picked.candidates.map(function(c) { return c.id; }), ['4195432', '4145074'], 'id кандидатов');

// Точность считается по токенам «нашего» SKU, а не по служебной строке (там были требования RFP).
assert.strictEqual(picked.tokens, '120,E,Lexmark,N,Картридж', 'tokens берутся из строки «нашего» SKU');
assert.strictEqual(picked.tma, '0', 'tma берётся из строки «нашего» SKU');

// Нормальный случай (все строки с SKUID) — первая строка по-прежнему «Наш артикул».
const normal = api.pickMatches([
    { 'Наименование SKU': 'A', 'токены': 'x', 'ТММ': '1', SKUID: '11' },
    { 'Наименование SKU': 'B', 'токены': 'y', 'ТММ': '0', SKUID: '22' }
]);
assert.strictEqual(normal.our.id, '11', 'обычный случай: our = первая строка');
assert.strictEqual(normal.candidates.length, 1, 'обычный случай: 1 кандидат');
assert.strictEqual(normal.tokens, 'x', 'обычный случай: tokens из первой строки');

// Подлинно пустой результат (нет ни одного SKU) → our=null (legit-заглушка «0» в processRecord).
const empty = api.pickMatches([
    { 'Наименование SKU': '', 'токены': 'req', 'ТММ': '0', SKUID: '' }
]);
assert.strictEqual(empty.our, null, 'нет ни одного SKU → our=null (далее пишется заглушка)');
assert.strictEqual(empty.candidates.length, 0, 'нет кандидатов');

console.log('OK: test-issue-3534-xcom-skip-empty-sku');
