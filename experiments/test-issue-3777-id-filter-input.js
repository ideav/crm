// Тест issue #3777 (js/integram-table.js):
// На DATE/DATETIME-колонке оператор «по ID» (@ / !@) должен показывать ТЕКСТОВОЕ
// поле (ID или список), а не дата-пикер. Баг: при выборе @ без ранее заданного
// фильтра ячейка оставалась дата-пикером, т.к. re-render сравнивал с oldType=undefined,
// а отображалась ДЕФОЛТНАЯ форма (DATETIME по умолчанию '=' → дата-пикер).
// filterInputKind — чистый метод; инстанс через Object.create без конструктора.
const path = require('path');
const assert = require('assert');

const IntegramTable = require(path.join(__dirname, '..', 'js', 'integram-table.js'));
assert(typeof IntegramTable === 'function', 'IntegramTable exported');

const t = Object.create(IntegramTable.prototype);

// --- filterInputKind: единый источник истины для формы поля ---
assert.strictEqual(t.filterInputKind('DATETIME', '='), 'date-picker', 'DATETIME = → дата-пикер');
assert.strictEqual(t.filterInputKind('DATETIME', '@'), 'text', 'DATETIME @ → текст (ID)');
assert.strictEqual(t.filterInputKind('DATETIME', '!@'), 'text', 'DATETIME !@ → текст (ID)');
assert.strictEqual(t.filterInputKind('DATETIME', '...'), 'range', 'DATETIME ... → диапазон');
assert.strictEqual(t.filterInputKind('DATE', '>'), 'date-picker', 'DATE > → дата-пикер');
assert.strictEqual(t.filterInputKind('DATE', '@'), 'text', 'DATE @ → текст (ID)');
assert.strictEqual(t.filterInputKind('NUMBER', '...'), 'range', 'NUMBER ... → диапазон');
assert.strictEqual(t.filterInputKind('NUMBER', '='), 'text', 'NUMBER = → текст');
assert.strictEqual(t.filterInputKind('SHORT', '@'), 'text', 'SHORT @ → текст');

// --- решение о ре-рендере (повторяет логику showFilterTypeMenu) ---
// re-render нужен, когда форма поля меняется; old|| дефолт учитывает «фильтр ещё не задан».
function shouldReRender(format, oldType, symbol) {
    const effectiveOldType = oldType || t.getDefaultFilterType(format);
    return format !== 'REF' &&
        t.filterInputKind(format, effectiveOldType) !== t.filterInputKind(format, symbol);
}

// БАГ #3777: на DATETIME без ранее заданного фильтра (oldType undefined) выбор @ → ре-рендер в текст
assert.strictEqual(shouldReRender('DATETIME', undefined, '@'), true,
    'DATETIME: дефолтный дата-пикер → @ должен ре-рендериться в текст (issue #3777)');
assert.strictEqual(shouldReRender('DATETIME', undefined, '!@'), true,
    'DATETIME: дефолтный дата-пикер → !@ должен ре-рендериться в текст');
assert.strictEqual(shouldReRender('DATETIME', undefined, '...'), true,
    'DATETIME: дефолтный дата-пикер → ... должен ре-рендериться в диапазон');

// Переключение @ ↔ !@ (оба текст) — без ре-рендера (нет мигания, ввод не сбрасывается)
assert.strictEqual(shouldReRender('DATETIME', '@', '!@'), false, 'DATETIME: @ ↔ !@ без ре-рендера');

// Дефолтный '=' → явный '=' — без ре-рендера (форма та же)
assert.strictEqual(shouldReRender('DATETIME', undefined, '='), false, 'DATETIME: дефолт = → = без ре-рендера');

// Дата-пикер → @ (с заданным oldType) — ре-рендер
assert.strictEqual(shouldReRender('DATETIME', '=', '@'), true, 'DATETIME: = → @ ре-рендер');
// @ → дата-пикер обратно — ре-рендер
assert.strictEqual(shouldReRender('DATETIME', '@', '='), true, 'DATETIME: @ → = ре-рендер');
// диапазон → @ — ре-рендер
assert.strictEqual(shouldReRender('DATETIME', '...', '@'), true, 'DATETIME: ... → @ ре-рендер');

// NUMBER: дефолт '=' (текст) → '...' (диапазон) — ре-рендер
assert.strictEqual(shouldReRender('NUMBER', undefined, '...'), true, 'NUMBER: дефолт = → ... ре-рендер');
// SHORT: дефолт '^' (текст) → '@' (текст) — без ре-рендера
assert.strictEqual(shouldReRender('SHORT', undefined, '@'), false, 'SHORT: дефолт ^ → @ без ре-рендера');

console.log('OK: test-issue-3777-id-filter-input');
