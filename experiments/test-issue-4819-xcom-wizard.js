const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'download/xcom/js/xcom-wizard.js'), 'utf8');
const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    console, module: { exports: {} }, setInterval() {}, clearInterval() {}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'xcom-wizard.js' });
const api = sandbox.window.XcomWizardWorkspace;
const plain = value => JSON.parse(JSON.stringify(value));

const dataset = api.matrixToDataset([
    ['', '', ''],
    ['Наименование', 'Артикул', 'Артикул'],
    ['Картридж лазерный HP 85A', 'CE285A', 'vendor-1'],
    ['', '', '']
]);
assert.deepStrictEqual(plain(dataset.headers), ['Наименование', 'Артикул', 'Артикул 2']);
assert.strictEqual(dataset.headerRow, 2);
assert.strictEqual(dataset.totalRows, 1);

const headers = ['Название товара', 'Код товара', 'Производитель', 'Модель'];
const rows = [
    { 'Название товара': 'Картридж лазерный для принтера HP LaserJet', 'Код товара': 'CE285A', Производитель: 'HP', Модель: '85A' },
    { 'Название товара': 'Картридж лазерный для принтера Canon', 'Код товара': '737', Производитель: 'Canon', Модель: '737' }
];
const mapping = api.suggestMapping(headers, rows);
assert.strictEqual(mapping.name, 'Название товара');
assert.strictEqual(mapping.article, 'Код товара');
assert.strictEqual(mapping.brand, 'Производитель');
assert.strictEqual(mapping.model, 'Модель');

const mappings = { rfp: mapping, sku: mapping };
const rules = api.buildRules(mappings);
assert(rules.some(rule => rule.role === 'brand' && rule.required));
assert(rules.some(rule => rule.role === 'model' && rule.required));
const config = plain(api.buildMatchingConfig({ category: 'IT-техника', preset: 'it-equipment', tma_weight: '0.4', rules, mappings }));
assert.strictEqual(config.tma_weight, 0.4);
assert.strictEqual(config.category, 'IT-техника');
assert.strictEqual(config.column_mapping.rfp.name, 'Название товара');
assert.strictEqual(config.required_attributes.length, 2);
const table = {
    id: '101', val: 'RFP', reqs: [
        { id: '1011', val: 'Наименование' }, { id: '1012', val: 'Артикул поставщика' },
        { id: '1013', val: 'Бренд' }, { id: '1014', val: 'Модель' }
    ]
};
// #5617: главное значение — колонка ключа записи, наименование — поле «Наименование».
const keyed = Object.assign({}, mapping, { code: 'Код товара', article: '' });
const upload = plain(api.buildUploadSetting('rfp', { headers, headerRow: 2 }, keyed, table, 'Лист 1'));
assert.strictEqual(upload.type, '101');
assert.strictEqual(upload.importMap['101'], 1, 'main value maps to the record key column');
assert.strictEqual(upload.importMap['1011'], 0, 'product name maps to the Наименование field');
assert.strictEqual(upload.xlsx.sheet, 'Лист 1');
assert.strictEqual(upload.xlsx.r0, 1);
const mappingRows = plain(api.buildMappingRows({
    category: 'IT-техника', mappings, rules,
    files: { rfp: { name: 'rfp.xlsx' }, sku: { name: 'sku.xlsx' } },
    sheets: { rfp: 'RFP', sku: 'SKU' },
    datasets: { rfp: { totalRows: 2 }, sku: { totalRows: 3 } }
}));
assert.strictEqual(mappingRows.length, 14);
assert(mappingRows.some(row => row.side === 'RFP' && row.role === 'Бренд' && row.required === '1'));
assert.strictEqual(api.validateStep(1, { datasets: { rfp: dataset, sku: null } }), 'Выберите и разберите оба файла.');
assert.strictEqual(api.validateStep(2, { mappings: { rfp: { name: 'A' }, sku: {} } }), 'Укажите колонку «Наименование» для RFP и SKU.');
assert.strictEqual(api.formatDuration(125000), '02:05');
const template = fs.readFileSync(path.join(__dirname, '..', 'templates/xcom/wizard.html'), 'utf8');
assert(template.includes('data-integram-table'), 'saved mapping uses the platform table component');
assert(template.includes('/js/integram-table.js?{_global_.version}'), 'wizard loads the platform table component');

console.log('OK: test-issue-4819-xcom-wizard');
