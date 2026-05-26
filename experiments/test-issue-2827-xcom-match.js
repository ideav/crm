const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const templatePath = path.join(root, 'templates', 'xcom', 'match.html');
const scriptPath = path.join(root, 'js', 'xcom-match.js');
const stylePath = path.join(root, 'css', 'xcom-match.css');
const updateConfPath = path.join(root, 'update.conf');

assert(fs.existsSync(templatePath), 'templates/xcom/match.html exists');
assert(fs.existsSync(scriptPath), 'js/xcom-match.js exists');
assert(fs.existsSync(stylePath), 'css/xcom-match.css exists');

const template = fs.readFileSync(templatePath, 'utf8');
assert(template.includes('/css/xcom-match.css?0{_global_.version}'), 'template loads versioned CSS');
assert(template.includes('/js/xcom-match.js?0{_global_.version}'), 'template loads versioned JS');
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
assert.strictEqual(parsedMatch.searchParams.get('sku_id'), '555');
assert.strictEqual(parsedMatch.searchParams.get('sku_value'), 'ABC-10');

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
