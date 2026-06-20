// Тест формулы «Точность подбора» рабочего места массового подбора SKU (issue #3501).
// Точность = взвешенная сумма: длина склеенных совпавших токенов / полусумма длин
// «Наименование SKU» и «Наименование из RFP» (по склеенным токенам) + флаг ТММ (вес ≈50%).
// Совпавшие токены берутся из колонки «токены» отчёта; если пусто — считаются пересечением.
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
assert(api && typeof api.computeAccuracy === 'function', 'computeAccuracy is exported');
const acc = api.computeAccuracy; // (rfpName, skuName, matchedTokens, tmaFlag)

const RFP = 'Болт М10х50 DIN933';
const SKU = 'Болт М10х50 DIN933';

// --- Числитель пересчитывается (колонка «токены» пуста) ---

// Идентичные наименования: текстовая часть = 100%, ТММ добавляет вторую половину.
assert.strictEqual(acc(RFP, SKU, '', '1'), 100, 'идентично + ТММ=1 → 100%');
assert.strictEqual(acc(RFP, SKU, '', '0'), 50, 'идентично, ТММ=0 → 50%');
assert.strictEqual(acc(RFP, SKU, '', ''), 50, 'идентично, ТММ пусто → 50%');

// Полное расхождение токенов: текстовая часть = 0, остаётся только вклад ТММ.
assert.strictEqual(acc('Гайка М8 нерж', 'Болт М10х50', '', '0'), 0, 'нет совпадений, ТММ=0 → 0%');
assert.strictEqual(acc('Гайка М8 нерж', 'Болт М10х50', '', '1'), 50, 'нет совпадений, ТММ=1 → 50%');

// Флаг ТММ даёт ровно половину шкалы независимо от текста.
assert.strictEqual(acc('', '', '', '1'), 50, 'пустые строки + ТММ=1 → 50%');
assert.strictEqual(acc('', '', '', '0'), 0, 'пустые строки, ТММ=0 → 0%');

// Частичное совпадение: RFP «Болт М10х50 DIN933 цинк» (токены 4+6+6+4=20),
// SKU «Болт М10х50» (4+6=10); совпало 10, полусумма (20+10)/2=15 → 10/15≈0.667.
const partial = 'Болт М10х50 DIN933 цинк';
assert.strictEqual(acc(partial, 'Болт М10х50', '', '0'), 33, 'частичное совпадение, ТММ=0 → 33%');
assert.strictEqual(acc(partial, 'Болт М10х50', '', '1'), 83, 'частичное совпадение, ТММ=1 → 83%');

// Текстовая часть симметрична относительно порядка наименований (полусумма длин).
assert.strictEqual(
    acc(partial, 'Болт М10х50', '', '0'),
    acc('Болт М10х50', partial, '', '0'),
    'текстовая часть симметрична по RFP/SKU'
);

// --- Числитель из колонки «токены» отчёта ---

// Совпавшие токены заданы явно: длина склеенных «konica»+«minolta» = 13.
// RFP-токены 4+1+5+6+7=23 («печь в сборе konica minolta»), SKU 8+6+7=21.
// Полусумма (23+21)/2=22, 13/22≈0.591 → ТММ=0 → 30%, ТММ=1 → 80%.
const rfpName = 'Печь в сборе konica minolta';
const skuName = 'Запчасть konica minolta';
assert.strictEqual(acc(rfpName, skuName, 'konica,minolta', '0'), 30, 'токены из отчёта, ТММ=0 → 30%');
assert.strictEqual(acc(rfpName, skuName, 'konica,minolta', '1'), 80, 'токены из отчёта, ТММ=1 → 80%');

// Явные токены имеют приоритет над пересчётом: больше совпавших токенов → выше точность.
assert(
    acc(rfpName, skuName, 'печь,konica,minolta', '0') > acc(rfpName, skuName, 'konica,minolta', '0'),
    'больше совпавших токенов из отчёта → выше точность'
);

// Результат всегда в диапазоне 0..100.
[['', '', '', ''], [RFP, SKU, '', '1'], [partial, 'Болт М10х50', 'болт', '1']].forEach(function(c) {
    const v = acc(c[0], c[1], c[2], c[3]);
    assert(v >= 0 && v <= 100, 'точность в диапазоне 0..100');
});

console.log('OK: test-issue-3501-xcom-mass-accuracy');
