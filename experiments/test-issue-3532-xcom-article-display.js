// Тест issue #3532: в таблице массового подбора SKU колонки «Наш артикул» и «Кандидаты»
// показывают АРТИКУЛ SKU (поле «Артикул» отчёта mass_match) вместо числового SKUID, при этом
// в строку RFP по-прежнему записывается ID (writeBack пишет item.id — здесь проверяется, что
// pickMatches сохраняет id, а рендер ячеек выводит артикул и кладёт id в title).
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
assert(typeof api.ourCell === 'function', 'ourCell exported');
assert(typeof api.candidatesCell === 'function', 'candidatesCell exported');

// Ответ отчёта mass_match: первая строка — «Наш артикул», остальные — кандидаты.
const rows = [
    { SKUID: '4126386', 'Наименование SKU': 'Ролик Konica Minolta', 'Артикул': 'A5AWR70E11' },
    { SKUID: '4126390', 'Наименование SKU': 'Ролик bizhub', 'Артикул': 'A5AWR70E12' },
    { SKUID: '4126391', 'Наименование SKU': 'Ролик подачи', 'Артикул': 'A5AWR70E13' }
];

const picked = api.pickMatches(rows);

// pickMatches сохраняет ID (для записи в RFP) и захватывает артикул (для показа).
assert.strictEqual(picked.our.id, '4126386', 'our.id = SKUID (сохраняется для записи)');
assert.strictEqual(picked.our.article, 'A5AWR70E11', 'our.article = поле «Артикул»');
assert.strictEqual(picked.candidates.length, 2, 'кандидатов — остальные строки');
assert.strictEqual(picked.candidates[0].id, '4126390', 'candidate.id = SKUID');
assert.strictEqual(picked.candidates[0].article, 'A5AWR70E12', 'candidate.article = «Артикул»');

// Рендер: видимый текст — артикул, ID сохраняется в title (а в RFP его пишет writeBack по item.id).
const ourHtml = api.ourCell({ our: picked.our });
assert(ourHtml.indexOf('A5AWR70E11') !== -1, 'ourCell показывает артикул');
assert(ourHtml.indexOf('title="ID 4126386"') !== -1, 'ourCell сохраняет ID в title');
assert(ourHtml.indexOf('>4126386<') === -1, 'ourCell не выводит ID как текст ячейки');

const candHtml = api.candidatesCell({ candidates: picked.candidates });
assert(candHtml.indexOf('A5AWR70E12') !== -1 && candHtml.indexOf('A5AWR70E13') !== -1,
    'candidatesCell показывает артикулы кандидатов');
assert(candHtml.indexOf('title="ID 4126390"') !== -1, 'candidatesCell сохраняет ID кандидата в title');

// Фоллбэк: если артикул в отчёте пуст — показываем ID (ячейка не пустеет).
const noArticle = api.pickMatches([{ SKUID: '999', 'Наименование SKU': 'Без артикула' }]);
assert.strictEqual(noArticle.our.article, '', 'нет колонки «Артикул» → article пуст');
const fallbackHtml = api.ourCell({ our: noArticle.our });
assert(fallbackHtml.indexOf('>999<') !== -1, 'при пустом артикуле ourCell выводит ID');

console.log('OK: test-issue-3532-xcom-article-display');
