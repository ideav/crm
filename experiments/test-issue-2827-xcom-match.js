const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
// #3588/PR#3590: рабочее место переименовано match.html → matching.html.
// #4817: активы ручного места перенесены из глобальных /js//css/ под download/xcom/ —
// шаблон самодостаточен для базы с любым именем (как у mass_match и atex).
const templatePath = path.join(root, 'templates', 'xcom', 'matching.html');
const scriptPath = path.join(root, 'download', 'xcom', 'js', 'xcom-match.js');
const stylePath = path.join(root, 'download', 'xcom', 'css', 'xcom-match.css');
const updateConfPath = path.join(root, 'update.conf');

assert(fs.existsSync(templatePath), 'templates/xcom/match.html exists');
assert(fs.existsSync(scriptPath), 'download/xcom/js/xcom-match.js exists');
assert(fs.existsSync(stylePath), 'download/xcom/css/xcom-match.css exists');

const template = fs.readFileSync(templatePath, 'utf8');
assert(template.includes('/download/{_global_.z}/css/xcom-match.css?1{_global_.version}'), 'template loads versioned CSS from download');
assert(template.includes('/download/{_global_.z}/js/xcom-match.js?1{_global_.version}'), 'template loads versioned JS from download');
assert(!/<script\b(?![^>]*\bsrc=)/i.test(template), 'template does not contain inline scripts');
assert(!/<style\b/i.test(template), 'template does not contain inline styles');

const updateConf = fs.readFileSync(updateConfPath, 'utf8');
assert(updateConf.includes('templates/xcom/* : /var/www/www-root/data/www/ideav.ru/templates/custom/xcom/'), 'update.conf deploys xcom custom templates');

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
    fetch: function() {
        throw new Error('fetch should not be called by helper tests');
    }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.URLSearchParams = URLSearchParams;

vm.runInNewContext(source, sandbox, { filename: scriptPath });

const helpers = sandbox.window.XcomMatchWorkspace;
assert(helpers, 'XcomMatchWorkspace helper API is exposed');
assert.strictEqual(helpers.buildMetadataUrl({ db: 'xcom', table: 'sku' }), '/xcom/metadata?JSON');
assert.strictEqual(helpers.buildMetadataUrl({ db: 'xcom', table: '123' }), '/xcom/metadata/123');

const resolvedSku = helpers.resolveSkuMetadata([
    { id: '42', val: 'client', reqs: [] },
    { id: '100', val: 'sku', reqs: [] }
], 'sku');
assert.strictEqual(resolvedSku.id, '100');

const columns = helpers.buildSkuColumns({
    id: '100',
    val: 'SKU',
    type: 'SHORT',
    reqs: [
        { id: '101', val: 'Наименование позиции', type: 'SHORT' },
        { id: '102', val: 'Описание', type: 'TEXT' },
        { id: '103', val: 'Производитель', type: 'SHORT' }
    ]
});

assert.deepStrictEqual(Array.from(columns.slice(0, 3).map(col => col.id)), ['100', '101', '102']);
assert.strictEqual(columns[1].name, 'Наименование позиции');

const searchUrl = helpers.buildSkuSearchUrl({
    db: 'xcom',
    table: '100',
    fields: columns.slice(0, 3),
    values: {
        '100': 'ABC-10',
        '101': 'кабель',
        '102': ''
    },
    limit: 20
});
const parsedSearch = new URL(searchUrl, 'https://example.test');
assert.strictEqual(parsedSearch.pathname, '/xcom/object/100/');
assert(parsedSearch.searchParams.has('JSON_OBJ'), 'SKU search requests JSON_OBJ');
assert.strictEqual(parsedSearch.searchParams.get('LIMIT'), '0,20');
assert.strictEqual(parsedSearch.searchParams.get('FR_100'), '%ABC-10%');
assert.strictEqual(parsedSearch.searchParams.get('FR_101'), '%кабель%');
assert.strictEqual(parsedSearch.searchParams.has('FR_102'), false);

const matchUrl = helpers.buildMatchReportUrl({
    db: 'xcom',
    report: 'Сопоставление',
    fields: columns.slice(0, 3),
    values: {
        '100': 'ABC-10',
        '101': 'кабель'
    },
    selectedRow: {
        id: '555',
        values: ['ABC-10', 'Кабель силовой', 'медный']
    }
});
const parsedMatch = new URL(matchUrl, 'https://example.test');
assert.strictEqual(parsedMatch.pathname, '/xcom/report/%D0%A1%D0%BE%D0%BF%D0%BE%D1%81%D1%82%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5');
assert(parsedMatch.searchParams.has('JSON'), 'match report requests JSON');
assert.strictEqual(parsedMatch.searchParams.get('FR_SKU'), 'ABC-10');
assert.strictEqual(parsedMatch.searchParams.get('FR_Наименование_позиции'), 'кабель');
// Выбранная строка передаётся отчёту той же конвенцией FR_{имя поля}, что и остальные фильтры
// (issue #2827: «параметры как FR_{название поля}»): первое поле строки — FR_RFP, а ссылочные
// значения — FR_{поле}ID. Отдельных sku_id/sku_value запрос не принимает.
assert.strictEqual(parsedMatch.searchParams.get('FR_RFP'), 'ABC-10');
assert.strictEqual(parsedMatch.searchParams.has('sku_id'), false);

const report = helpers.normalizeReportResponse({
    columns: [
        { id: '1', name: 'SKU' },
        { id: '2', name: 'Score' }
    ],
    data: [
        ['ABC-10', 'DEF-20'],
        ['99', '75']
    ]
});
assert.deepStrictEqual(report.columns.map(col => col.name), ['SKU', 'Score']);
assert.deepStrictEqual(report.rows[1], ['DEF-20', '75']);

console.log('issue-2827 xcom match workspace: ok');
