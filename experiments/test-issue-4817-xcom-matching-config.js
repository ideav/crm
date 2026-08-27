// Тест параметризации категории номенклатуры (issue #4817, ТЗ 4816 §3.8): конфиг
// «Настройка сопоставления» — настраиваемый вес ТММ в точности и ЖЁСТКИЙ гейт кандидата
// по обязательным атрибутам (обе стороны заданы и не совпали → кандидат отбрасывается
// независимо от скоринга). Отчёты при этом не трогаются: специфика живёт в JS-слое.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'download', 'xcom', 'js', 'xcom-mass-match.js');
assert(fs.existsSync(scriptPath), 'download/xcom/js/xcom-mass-match.js exists');

function loadWorkspace() {
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
    return sandbox.window.XcomMassMatchWorkspace;
}

const api = loadWorkspace();
const acc = api.computeAccuracy; // (rfpName, skuName, matchedTokens, tmaFlag [, tmaWeight])

// --- 1. Вес ТММ настраивается (сегодня — константа 0.5) -------------------

// Одинаковые имена, ТММ=0: точность = (1-w)*100. w=0.3 → 70%, w=0.8 → 20%.
assert.strictEqual(acc('Болт М10х50', 'Болт М10х50', '', '0', 0.3), 70, 'tma_weight=0.3, ТММ=0 → 70%');
assert.strictEqual(acc('Болт М10х50', 'Болт М10х50', '', '0', 0.8), 20, 'tma_weight=0.8, ТММ=0 → 20%');
// ТММ=1: точность = w*100 + (1-w)*текст.
assert.strictEqual(acc('Болт М10х50', 'Болт М10х50', '', '1', 0.3), 100, 'tma_weight=0.3, идентично+ТММ → 100%');
// Совпадений текста нет, ТММ=1: точность = w*100.
assert.strictEqual(acc('Гайка М8', 'Болт М10х50', '', '1', 0.3), 30, 'tma_weight=0.3, только ТММ → 30%');
// Без пятого аргумента — прежнее поведение (0.5), существующие вызовы не ломаются.
assert.strictEqual(acc('Болт М10х50', 'Болт М10х50', '', '0'), 50, 'без tmaWeight — дефолт 0.5 (обратная совместимость)');

// --- 2. Гейт обязательных атрибутов (чистая функция) -----------------------

const gate = api.passesRequiredAttributes;
assert(typeof gate === 'function', 'passesRequiredAttributes is exported');

const ATTRS = [{ rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU' }];
assert.strictEqual(gate({ 'Бренд RFP': 'HP', 'Бренд SKU': 'HP' }, ATTRS), true, 'атрибут совпал → проходит');
assert.strictEqual(gate({ 'Бренд RFP': 'HP', 'Бренд SKU': 'Canon' }, ATTRS), false, 'обе стороны заданы и различаются → отброшен');
assert.strictEqual(gate({ 'Бренд RFP': ' hp ', 'Бренд SKU': 'HP' }, ATTRS), true, 'сравнение без регистра/пробелов');
assert.strictEqual(gate({ 'Бренд RFP': 'HP' }, ATTRS), true, 'одна сторона пуста — судить нельзя → проходит');
assert.strictEqual(gate({}, ATTRS), true, 'колонок нет вовсе (отчёт без атрибутов) → гейт не мешает');
assert.strictEqual(gate({ 'Бренд RFP': 'HP', 'Бренд SKU': 'Canon' }, []), true, 'пустой список обязательных → всё проходит');
// Несколько атрибутов: ВСЕ должны совпасть.
const TWO = [{ rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU' }, { rfp_key: 'Модель RFP', sku_key: 'Модель SKU' }];
assert.strictEqual(gate({ 'Бренд RFP': 'HP', 'Бренд SKU': 'HP', 'Модель RFP': '85A', 'Модель SKU': '85X' }, TWO), false, 'второй атрибут не совпал → отброшен');

// --- 3. Валидатор схемы конфига --------------------------------------------

const validate = api.validateMatchingConfig;
assert(typeof validate === 'function', 'validateMatchingConfig is exported');

// Массив возвращается из vm-контекста (другой Array.prototype) — deepStrictEqual по нему
// падает на кросс-реалм-прототипе, поэтому срезаем в массив хоста.
const errorsOf = function(config) { return Array.prototype.slice.call(validate(config)); };

assert.deepStrictEqual(errorsOf({ tma_weight: 0.5, required_attributes: ATTRS }), [], 'валидный конфиг без ошибок');
assert.deepStrictEqual(errorsOf({}), [], 'пустой конфиг валиден (= все дефолты)');
assert(errorsOf({ tma_weight: 1.5 }).length > 0, 'tma_weight вне 0..1 — ошибка');
assert(errorsOf({ tma_weight: 'half' }).length > 0, 'tma_weight не число — ошибка');
assert(errorsOf({ required_attributes: [{ rfp_key: 'Бренд RFP' }] }).length > 0, 'атрибут без sku_key — ошибка');
assert(errorsOf({ required_attributes: [{ rfp_key: '', sku_key: 'Бренд SKU' }] }).length > 0, 'пустой rfp_key — ошибка');
assert(errorsOf({ reqired_attributes: [] }).length > 0, 'опечатка в ключе (неизвестное поле) — ошибка, а не молчание');

// --- 4. Слияние дефолтов с переопределением ---------------------------------

const merge = api.mergeMatchingConfig;
assert(typeof merge === 'function', 'mergeMatchingConfig is exported');
// Результат — объект vm-контекста: сравниваем через JSON (кросс-реалм-прототипы).
const plain = function(v) { return JSON.parse(JSON.stringify(v)); };
const merged = merge({ tma_weight: 0.5, required_attributes: [] }, { tma_weight: 0.3 });
assert.strictEqual(merged.tma_weight, 0.3, 'override меняет вес');
assert.deepStrictEqual(plain(merged.required_attributes), [], 'не заданный в override ключ остаётся от базы');
assert.deepStrictEqual(
    plain(merge({ tma_weight: 0.5, required_attributes: [] }, {})),
    { tma_weight: 0.5, required_attributes: [] },
    'пустой override — база как есть'
);

// --- 5. pickMatches применяет гейт из конфига -------------------------------

const st = api._state;
st.matchConfig = { tma_weight: 0.5, required_attributes: ATTRS };
const ROWS = [
    { SKUID: '1', 'Наименование SKU': 'Картридж HP 85A', 'Артикул': 'CB85A', 'Бренд RFP': 'HP', 'Бренд SKU': 'HP' },
    { SKUID: '2', 'Наименование SKU': 'Картридж Canon 737', 'Артикул': '737', 'Бренд RFP': 'HP', 'Бренд SKU': 'Canon' }
];
const picked = api.pickMatches(ROWS.slice());
assert.strictEqual(picked.our.id, '1', 'первый прошедший гейт — наш');
assert.strictEqual(picked.candidates.length, 0, 'кандидат с чужим бренмом отброшен гейтом');

// Без обязательных атрибутов — прежнее поведение: оба SKU в результате.
st.matchConfig = { tma_weight: 0.5, required_attributes: [] };
const pickedAll = api.pickMatches(ROWS.slice());
assert.strictEqual(pickedAll.our.id, '1', 'без гейта первый SKU — наш');
assert.strictEqual(pickedAll.candidates.length, 1, 'без гейта второй SKU — кандидат');

// --- 6. РМ настроек: форма ↔ конфиг (чистые мапперы xcom-settings.js) -------

const settingsPath = path.join(root, 'download', 'xcom', 'js', 'xcom-settings.js');
assert(fs.existsSync(settingsPath), 'download/xcom/js/xcom-settings.js exists');
const settingsSource = fs.readFileSync(settingsPath, 'utf8');
const settingsSandbox = {
    window: {},
    document: {
        readyState: 'loading',
        addEventListener: function() {},
        getElementById: function() { return null; },
        createElement: function() { return { innerHTML: '', querySelector: function() { return { addEventListener: function() {} }; } }; }
    },
    console,
    fetch: function() { throw new Error('fetch should not be called by helper tests'); }
};
vm.createContext(settingsSandbox);
vm.runInContext(settingsSource, settingsSandbox, { filename: 'xcom-settings.js' });
const settingsApi = settingsSandbox.window.XcomMatchingSettingsWorkspace;
assert(settingsApi && typeof settingsApi.formFromConfig === 'function', 'XcomMatchingSettingsWorkspace exported');

// Частичный конфиг (нет ключей) → форма показывает дефолты, а не пустоту.
const form = settingsApi.formFromConfig({});
assert.strictEqual(form.tma_weight, 0.5, 'нет tma_weight в конфиге → дефолт 0.5 в форме');
assert.strictEqual(form.required_attributes.length, 1, 'нет атрибутов → одна пустая строка в форме');
// Вес вне диапазона в конфиге → в форме он обрезан в 0..1.
assert.strictEqual(settingsApi.formFromConfig({ tma_weight: 1.4 }).tma_weight, 1, 'tma_weight=1.4 → 1 в форме');

// Незаконченная строка атрибута (один ключ пуст) не попадает в конфиг.
const cfgFromForm = settingsApi.configFromForm({
    tma_weight: '0.3',
    required_attributes: [
        { rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU' },
        { rfp_key: 'Модель RFP', sku_key: '' }
    ]
});
assert.strictEqual(cfgFromForm.tma_weight, 0.3, 'вес из формы → число');
assert.deepStrictEqual(JSON.parse(JSON.stringify(cfgFromForm.required_attributes)), [{ rfp_key: 'Бренд RFP', sku_key: 'Бренд SKU' }], 'пустая строка атрибута отброшена');

// Round-trip: конфиг → форма → конфиг без потерь.
const roundTrip = settingsApi.configFromForm(settingsApi.formFromConfig({ tma_weight: 0.3, required_attributes: ATTRS }));
assert.deepStrictEqual(JSON.parse(JSON.stringify(roundTrip)), { tma_weight: 0.3, required_attributes: ATTRS }, 'round-trip форма↔конфиг');

console.log('OK: test-issue-4817-xcom-matching-config');
