'use strict';

// Issue #2300: dashboard panel charts can be configured from an arbitrary
// report JSON source without changing the panel table source.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

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

const code = `
let dashModelData = {};
let dashVizReports = {};
function dashPanelFiltersFor() { return {}; }
function dashFilterReportRowsForPanel(rows) { return rows || []; }
function dashPanelTableRowPassesFilters() { return true; }
function dashPanelTableCellPassesFilters() { return true; }

${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashChartMeasureValue')}
${extractFunction('dashAttr')}
${extractFunction('dashNormalizePanelFilter')}
${extractFunction('dashReportRefId')}
${extractFunction('dashCleanReportRef')}
${extractFunction('dashResolvePanelVizReportId')}
${extractFunction('dashVizReportKey')}
${extractFunction('dashVizReportUrl')}
${extractFunction('dashNormalizeReportJson')}
${extractFunction('dashReportColumnByField')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashReportColumnNameHasIdSuffix')}
${extractFunction('dashReportColumnIsStyle')}
${extractFunction('dashReportColumnIsMeasure')}
${extractFunction('dashReportColumnIsDimension')}
${extractFunction('dashReportDefaultColumn')}
${extractFunction('dashReportRowValue')}
${extractFunction('dashReportValueLabel')}
${extractFunction('dashReportAddOrdered')}
${extractFunction('dashCollectReportVizData')}
${extractFunction('dashPanelGetVizReportData')}
${extractFunction('dashCollectPanelData')}
${extractFunction('dashBuildReportFieldOptions')}
${extractFunction('dashBuildReportFieldMapHtml')}

const assert = require('assert');

const sampleReport = {
    header: 'Sales',
    columns: [
        { id: 'month', name: 'Месяц', type: '3888', format: 'DATE' },
        { id: 'region', name: 'Регион', type: '3596', format: 'SHORT' },
        { id: 'amount', name: 'Выручка', type: '3596', format: 'NUMBER' },
        { id: 'client_id', name: 'КлиентID', type: '4547', format: 'NUMBER', ref: 1 }
    ],
    data: [
        ['2026-01', '2026-01', '2026-02'],
        ['Москва', 'СПб', 'Москва'],
        ['100', '250,5', '300'],
        ['10', '20', '10']
    ]
};

assert.strictEqual(dashResolvePanelVizReportId({ chartReportID: '155675' }), '155675');
assert.strictEqual(dashResolvePanelVizReportId({ 'ЗапросID': '155675:Мои задачи' }), '155675');
assert.strictEqual(
    dashVizReportUrl('155675', '01.01.2026', '31.01.2026', '&F_Status=Open'),
    'report/155675?JSON&FR_Date=01.01.2026&TO_Date=31.01.2026&F_Status=Open'
);

const normalized = dashNormalizeReportJson(sampleReport);
assert.strictEqual(normalized.columns.length, 4);
assert.strictEqual(normalized.rows.length, 3);
assert.deepStrictEqual(normalized.rows[1], {
    'Месяц': '2026-01',
    'Регион': 'СПб',
    'Выручка': '250,5',
    'КлиентID': '20'
});
assert.strictEqual(dashReportColumnByField(normalized.columns, 'amount').name, 'Выручка');
assert.strictEqual(dashReportColumnIsMeasure(dashReportColumnByField(normalized.columns, 'amount')), true);
assert.strictEqual(dashReportColumnIsMeasure({ name: 'Дельта', format: 'SIGNED' }), true);
assert.strictEqual(dashReportColumnIsMeasure(dashReportColumnByField(normalized.columns, 'client_id')), false);

let chartData = dashCollectReportVizData(normalized, {
    type: 'bar',
    fieldMap: { labelField: 'month', seriesField: 'region', valueField: 'amount' }
});
assert.deepStrictEqual(chartData.labels, ['2026-01', '2026-02']);
assert.deepStrictEqual(chartData.datasets, [
    { label: 'Москва', data: [100, 300] },
    { label: 'СПб', data: [250.5, 0] }
]);
assert.strictEqual(chartData.records.length, 3);

chartData = dashCollectReportVizData(normalized, {
    type: 'pie',
    fieldMap: { labelField: 'region', valueField: 'amount' }
});
assert.deepStrictEqual(chartData.labels, ['Москва', 'СПб']);
assert.deepStrictEqual(chartData.datasets[0].data, [400, 250.5]);

chartData = dashCollectReportVizData(normalized, {
    type: 'bar',
    fieldMap: { labelField: 'region' }
});
assert.deepStrictEqual(chartData.labels, ['Москва', 'СПб']);
assert.deepStrictEqual(chartData.datasets[0], { label: 'Выручка', data: [400, 250.5] });

dashVizReports[dashVizReportKey('155675', '')] = normalized;
dashModelData.fp1 = {
    vizReportKey: dashVizReportKey('155675', '')
};
const panelEl = {
    id: 'fp1',
    querySelector() {
        throw new Error('table data should not be read when a viz report is configured');
    },
    querySelectorAll() {
        throw new Error('table rows should not be read when a viz report is configured');
    }
};
chartData = dashCollectPanelData(panelEl, {
    type: 'line',
    fieldMap: { labelField: 'month', valueField: 'amount' }
});
assert.deepStrictEqual(chartData.labels, ['2026-01', '2026-02']);
assert.deepStrictEqual(chartData.datasets[0].data, [350.5, 300]);

dashVizReports[dashVizReportKey('empty', '')] = { columns: normalized.columns, rows: [] };
dashModelData.fp2 = {
    vizReportKey: dashVizReportKey('empty', '')
};
chartData = dashCollectPanelData({
    id: 'fp2',
    querySelectorAll() {
        throw new Error('empty viz reports should still suppress table data');
    }
}, { type: 'line', fieldMap: { labelField: 'month', valueField: 'amount' } });
assert.deepStrictEqual(chartData, { labels: [], datasets: [], records: [], columns: normalized.columns });

const fieldHtml = dashBuildReportFieldMapHtml('line', {
    labelField: 'month',
    valueField: 'amount',
    seriesField: 'region'
}, normalized);
assert(fieldHtml.includes('name="labelField"'));
assert(fieldHtml.includes('value="month" selected'));
assert(fieldHtml.includes('name="valueField"'));
assert(fieldHtml.includes('value="amount" selected'));
assert(fieldHtml.includes('name="seriesField"'));
const valueSelect = fieldHtml.match(/name="valueField"[\\s\\S]*?<\\/select>/)[0];
assert(!valueSelect.includes('value="client_id"'), 'reference ID columns should not be offered as metric values');
`;

vm.runInNewContext(code, { require });
console.log('issue-2300 dashboard viz report source: ok');
