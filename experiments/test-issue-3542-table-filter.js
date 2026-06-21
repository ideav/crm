// Тест issue #3542 (js/integram-table.js):
// 1) первой (главной) колонке любого типа доступен поиск по ID (@ / !@), как у ссылочных;
// 2) диапазон (...) собирает значение из двух полей from/to, поддерживает открытые границы.
// Методы класса чистые — инстанс создаём через Object.create без конструктора (он требует DOM).
const path = require('path');
const assert = require('assert');

const IntegramTable = require(path.join(__dirname, '..', 'js', 'integram-table.js'));
assert(typeof IntegramTable === 'function', 'IntegramTable exported');

const t = Object.create(IntegramTable.prototype);

// Минимальный набор операторов (как в конструкторе — здесь это просто данные).
t.filterTypes = {
    'SHORT': [
        { symbol: '^', name: 'начинается с...', format: 'FR_{ T }={ X }%' },
        { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' }
    ],
    'NUMBER': [
        { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
        { symbol: '...', name: 'в диапазоне', format: 'FR_{ T }={ X1 }&TO_{ T }={ X2 }' },
        { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
        { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
    ],
    'REF': [
        { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
        { symbol: '@', name: 'по ID: включая', format: 'FR_{ T }=@{ X }' },
        { symbol: '!@', name: 'по ID: исключая', format: 'FR_{ T }=!@{ X }' }
    ]
};

t.columns = [
    { id: '100', format: 'SHORT' },   // первая (главная) колонка
    { id: '200', format: 'NUMBER' },  // обычная числовая
    { id: '300', format: 'REF' }      // ссылочная
];

// --- isFirstColumn ---
assert.strictEqual(t.isFirstColumn(t.columns[0]), true, 'columns[0] — первая колонка');
assert.strictEqual(t.isFirstColumn(t.columns[1]), false, 'columns[1] — не первая');
assert.strictEqual(t.isFirstColumn({ id: '999', format: 'SHORT' }), false, 'неизвестная колонка — не первая');

// --- getColumnFilterTypes: первая колонка любого типа получает @ / !@ ---
const firstOps = t.getColumnFilterTypes(t.columns[0]).map(f => f.symbol);
assert(firstOps.includes('@') && firstOps.includes('!@'), 'первая колонка: добавлены @ и !@');
assert(firstOps.includes('^'), 'первая колонка: базовые операторы сохранены');
const numOps = t.getColumnFilterTypes(t.columns[1]).map(f => f.symbol);
assert(!numOps.includes('@'), 'обычная колонка: @ НЕ добавляется');

// REF-колонка уже имеет @ — не дублируем (даже если бы была первой)
const refFirst = Object.create(IntegramTable.prototype);
refFirst.filterTypes = t.filterTypes;
refFirst.columns = [{ id: '300', format: 'REF' }];
const refOps = refFirst.getColumnFilterTypes(refFirst.columns[0]).map(f => f.symbol);
assert.strictEqual(refOps.filter(s => s === '@').length, 1, 'REF: @ не дублируется');

// --- applyFilter: поиск по ID на первой колонке ---
function run(column, filter) {
    const p = new URLSearchParams();
    t.applyFilter(p, column, filter);
    return p;
}

let p = run(t.columns[0], { type: '@', value: '5' });
assert.strictEqual(p.get('FR_100'), '@5', '@ один ID → FR_100=@5');

p = run(t.columns[0], { type: '@', value: '5, 6, abc' });
assert.strictEqual(p.get('FR_100'), '@IN(5,6)', '@ несколько ID → FR_100=@IN(5,6) (формат IN, нечисловые отброшены)');

p = run(t.columns[0], { type: '!@', value: '7' });
assert.strictEqual(p.get('FR_100'), '!@7', '!@ → FR_100=!@7');

// На обычной (не первой) колонке @ недоступен → фильтр не добавляется
p = run(t.columns[1], { type: '@', value: '5' });
assert.strictEqual(p.get('FR_200'), null, 'на не-первой колонке @ игнорируется');

// --- applyFilter: диапазон из двух значений ---
p = run(t.columns[1], { type: '...', value: '1,5' });
assert.strictEqual(p.get('FR_200'), '1', 'диапазон: FR_200=1');
assert.strictEqual(p.get('TO_200'), '5', 'диапазон: TO_200=5');

p = run(t.columns[1], { type: '...', value: '1,' });
assert.strictEqual(p.get('FR_200'), '1', 'открытый диапазон (только от): FR_200=1');
assert.strictEqual(p.get('TO_200'), null, 'открытый диапазон (только от): TO не задан');

p = run(t.columns[1], { type: '...', value: ',5' });
assert.strictEqual(p.get('FR_200'), null, 'открытый диапазон (только до): FR не задан');
assert.strictEqual(p.get('TO_200'), '5', 'открытый диапазон (только до): TO_200=5');

p = run(t.columns[1], { type: '...', value: ',' });
assert.strictEqual(p.get('FR_200'), null, 'пустой диапазон: FR не задан');
assert.strictEqual(p.get('TO_200'), null, 'пустой диапазон: TO не задан');

console.log('OK: test-issue-3542-table-filter');
