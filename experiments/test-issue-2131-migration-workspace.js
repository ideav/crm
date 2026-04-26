const assert = require('assert');
const utils = require('../js/migr.js');

const tables = [
    { id: 42, name: 'Роль' },
    { id: 269, name: 'Настройка' },
    { id: 155551, name: 'Матрица' }
];

const queries = [
    { id: 299, name: 'Главная страница' },
    { id: 5230, name: 'Исполнители' },
    { id: 155564, name: 'Матрица показателей' }
];

const source = [
    "fetch('/demo/object/42?JSON_OBJ')",
    "fetch('/demo/report/5230?JSON_KV')",
    "data-api-url=\"/{_global_.z}/metadata/269\"",
    "fetch('/demo/report/Матрица%20показателей?JSON')",
    "fetch('/demo/object/155551/?JSON_OBJ&F_155553=NPS')",
    "fetch('/demo/report/5230?JSON')"
].join('\n');

const refs = utils.parseDependencyRefs(source, { tables, queries });

assert.deepStrictEqual(refs.tables.map((item) => item.id), ['42', '269', '155551']);
assert.deepStrictEqual(refs.queries.map((item) => item.id), ['5230', '155564']);
assert.strictEqual(refs.tables[0].source, 'object');
assert.strictEqual(refs.queries[1].source, 'report-name');

const config = utils.serializeConfig({
    settingsName: 'Базовая миграция',
    selectedTables: new Map([
        ['42', { id: '42', name: 'Роль', exportData: true, filter: 'F_42=%admin%' }],
        ['269', { id: '269', name: 'Настройка', exportData: false, filter: '' }]
    ]),
    selectedQueries: new Map([
        ['5230', { id: '5230', name: 'Исполнители' }]
    ]),
    selectedFiles: new Map([
        ['templates:main.html', { root: 'templates', path: 'main.html', name: 'main.html' }]
    ])
});

assert.strictEqual(config.name, 'Базовая миграция');
assert.deepStrictEqual(config.tables.map((item) => item.id), ['42', '269']);
assert.strictEqual(config.tables[0].exportData, true);
assert.deepStrictEqual(config.queries.map((item) => item.id), ['5230']);
assert.deepStrictEqual(config.files.map((item) => item.path), ['main.html']);

console.log('PASS issue-2131 migration workspace utilities');
