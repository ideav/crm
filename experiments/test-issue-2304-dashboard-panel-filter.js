'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');
const template = fs.readFileSync('templates/dash.html', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

if (!source.includes('f-panel-filter-icon')) {
    throw new Error('dashboard panels must render a filter icon in the panel header');
}
if (!template.includes('dash-panel-filter-modal')) {
    throw new Error('dashboard template must include the panel filter modal');
}

const code = `
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashReportRowValue')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashPanelDateValue')}
${extractFunction('dashPanelMonthValue')}
${extractFunction('dashPanelFilterValueKey')}
${extractFunction('dashPanelFilterFieldKind')}
${extractFunction('dashPanelAddFilterOption')}
${extractFunction('dashBuildReportFilterFields')}
${extractFunction('dashPanelFilterIsActive')}
${extractFunction('dashPanelReportRowPassesFilter')}
${extractFunction('dashFilterReportRowsForPanel')}
${extractFunction('dashMergePanelFilterFields')}

const assert = require('assert');

const columns = [
    { id: 'client', name: 'Клиент', format: 'SHORT' },
    { id: 'amount', name: 'Сумма', format: 'NUMBER' },
    { id: 'deadline', name: 'Срок', format: 'DATE' },
    { id: 'month', name: 'Месяц', format: 'DATE' },
    { id: 'period', name: 'Период', format: 'SHORT' }
];
const rows = [
    { 'Клиент': 'Альфа', 'Сумма': '10', 'Срок': '2026-01-10', 'Месяц': '2026-01', 'Период': '2026-01' },
    { 'Клиент': 'Бета', 'Сумма': '15', 'Срок': '2026-01-15', 'Месяц': '2026-01', 'Период': '2026-01' },
    { 'Клиент': 'Альфа', 'Сумма': '25,5', 'Срок': '2026-02-05', 'Месяц': '2026-02', 'Период': '2026-02' }
];

const fields = dashBuildReportFilterFields(columns, rows);
const byField = {};
fields.forEach(function(field) { byField[field.field] = field; });

assert.strictEqual(byField['Клиент'].kind, 'values');
assert.deepStrictEqual(byField['Клиент'].options.map(function(option) { return option.value; }), ['Альфа', 'Бета']);
assert.strictEqual(byField['Сумма'].kind, 'range');
assert.strictEqual(byField['Сумма'].valueType, 'number');
assert.strictEqual(byField['Сумма'].min, '10');
assert.strictEqual(byField['Сумма'].max, '25.5');
assert.strictEqual(byField['Срок'].kind, 'range');
assert.strictEqual(byField['Срок'].valueType, 'date');
assert.strictEqual(byField['Месяц'].kind, 'month');
assert.deepStrictEqual(byField['Месяц'].options.map(function(option) { return option.value; }), ['2026-01', '2026-02']);
assert.strictEqual(byField['Период'].kind, 'month');
assert.deepStrictEqual(byField['Период'].options.map(function(option) { return option.value; }), ['2026-01', '2026-02']);

let filtered = dashFilterReportRowsForPanel(rows, {
    'report:Клиент': { source: 'report', field: 'Клиент', kind: 'values', selected: ['Альфа'] },
    'report:Сумма': { source: 'report', field: 'Сумма', kind: 'range', valueType: 'number', from: '12', to: '30' },
    'report:Месяц': { source: 'report', field: 'Месяц', kind: 'month', selected: ['2026-02'] }
});
assert.deepStrictEqual(filtered, [rows[2]]);

filtered = dashFilterReportRowsForPanel(rows, {
    'report:Срок': { source: 'report', field: 'Срок', kind: 'range', valueType: 'date', from: '2026-01-12', to: '2026-01-31' }
});
assert.deepStrictEqual(filtered, [rows[1]]);

filtered = dashFilterReportRowsForPanel([{ 'Другой отчет': '1' }], {
    'report:Клиент': { source: 'report', field: 'Клиент', kind: 'values', selected: ['Альфа'] }
});
assert.deepStrictEqual(filtered, [{ 'Другой отчет': '1' }], 'filters for one report field should not zero unrelated report rows');

const merged = [{ key: 'report:Сумма', kind: 'range', valueType: 'number', min: '10', max: '2' }];
dashMergePanelFilterFields(merged, [{ key: 'report:Сумма', kind: 'range', valueType: 'number', min: '2', max: '10' }]);
assert.strictEqual(merged[0].min, '2');
assert.strictEqual(merged[0].max, '10');
`;

vm.runInNewContext(code, { require });
console.log('issue-2304 dashboard panel filter: ok');
