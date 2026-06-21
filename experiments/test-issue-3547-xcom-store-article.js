// Тест issue #3547: в строку RFP записывается АРТИКУЛ SKU (а не числовой SKUID) — в оба поля
// «Наш артикул» и «Кандидаты». До этого writeBack хранил item.id (#3519); теперь, как и в
// отображении (#3532), храним то, что видно — артикул, с фоллбэком на ID, если артикул пуст.
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
assert(typeof api.buildWriteValues === 'function', 'buildWriteValues exported');
assert(typeof api.skuStoredValue === 'function', 'skuStoredValue exported');

// Поля таблицы RFP, в которые пишет _m_set (id реквизитов произвольные — важна привязка значений).
api._state.fields = {
    our: { id: '111', index: 4 },
    candidates: { id: '222', index: 5 },
    accuracy: { id: '333', index: 6 }
};

// Ответ отчёта mass_match: первая строка — «Наш артикул», остальные — кандидаты.
const rows = [
    { SKUID: '4126386', 'Наименование SKU': 'Ролик Konica Minolta', 'Артикул': 'A5AWR70E11' },
    { SKUID: '4126390', 'Наименование SKU': 'Ролик bizhub', 'Артикул': 'A5AWR70E12' },
    { SKUID: '4126391', 'Наименование SKU': 'Ролик подачи', 'Артикул': 'A5AWR70E13' }
];
const picked = api.pickMatches(rows);
const record = { id: '900', our: picked.our, candidates: picked.candidates, accuracy: 87 };

const values = api.buildWriteValues(record);

// «Наш артикул» — артикул первого SKU, а НЕ его SKUID.
assert.strictEqual(values['111'], 'A5AWR70E11', '«Наш артикул» = артикул первого SKU');
assert.notStrictEqual(values['111'], '4126386', '«Наш артикул» — не SKUID');

// «Кандидаты» — артикулы остальных SKU через запятую, а НЕ их SKUID.
assert.strictEqual(values['222'], 'A5AWR70E12, A5AWR70E13', '«Кандидаты» = артикулы через запятую');
assert.strictEqual(values['222'].indexOf('4126390'), -1, '«Кандидаты» не содержат SKUID');

// «Точность подбора» пишется как есть.
assert.strictEqual(values['333'], 87, '«Точность подбора» = число');

// skuStoredValue: артикул в приоритете, фоллбэк на ID при пустом артикуле.
assert.strictEqual(api.skuStoredValue({ id: '5', article: 'ART-5' }), 'ART-5', 'артикул в приоритете');
assert.strictEqual(api.skuStoredValue({ id: '5', article: '' }), '5', 'пустой артикул → ID');
assert.strictEqual(api.skuStoredValue({ id: '5' }), '5', 'нет поля article → ID');

// Фоллбэк на ID в записи: SKU без артикула — в RFP уходит его SKUID (поле не пустеет).
const noArticle = api.pickMatches([
    { SKUID: '999', 'Наименование SKU': 'Без артикула' },
    { SKUID: '1000', 'Наименование SKU': 'Кандидат без артикула' }
]);
const noArtValues = api.buildWriteValues({ id: '901', our: noArticle.our, candidates: noArticle.candidates, accuracy: 10 });
assert.strictEqual(noArtValues['111'], '999', 'нет артикула → пишем SKUID (поле непустое)');
assert.strictEqual(noArtValues['222'], '1000', 'кандидат без артикула → его SKUID');

// Заглушка «нет совпадений»: пишется '0' (placeholderOurId), строка помечается обработанной.
const placeholderRecord = { id: '902', our: { id: '0', label: 'нет совпадений', placeholder: true }, candidates: [], accuracy: 0 };
const phValues = api.buildWriteValues(placeholderRecord);
assert.strictEqual(phValues['111'], '0', 'заглушка без совпадений → «Наш артикул» = 0');
assert.strictEqual(phValues['222'], undefined, 'у заглушки нет кандидатов → поле «Кандидаты» не пишем');

console.log('OK: test-issue-3547-xcom-store-article');
