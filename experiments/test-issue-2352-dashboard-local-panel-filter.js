'use strict';

// Issue #2352: panelFilter values like "Field:Value" must not be sent to
// report URLs. They are panel-local filters applied to the loaded report rows.

const assert = require('assert');
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

const urlCtx = {};
vm.createContext(urlCtx);
vm.runInContext(`
${extractFunction('dashNormalizePanelFilter')}
${extractFunction('dashReportRefId')}
${extractFunction('dashCleanReportRef')}
${extractFunction('dashReportKey')}
${extractFunction('dashReportUrl')}
${extractFunction('dashVizReportKey')}
${extractFunction('dashVizReportUrl')}
`, urlCtx);

assert.strictEqual(
    urlCtx.dashReportUrl('Документы', '01.01.2026', '31.12.2026', 'Тип документаID:158844'),
    'report/Документы?JSON_KV&FR_Date=01.01.2026&TO_Date=31.12.2026',
    'colon panelFilter must not be appended to formula report requests'
);
assert.strictEqual(
    urlCtx.dashVizReportUrl('158891', '01.01.2026', '31.12.2026', 'Тип документаID:158844'),
    'report/158891?JSON&FR_Date=01.01.2026&TO_Date=31.12.2026',
    'colon panelFilter must not be appended to panel report requests'
);
assert.strictEqual(
    urlCtx.dashVizReportUrl('158891', '01.01.2026', '31.12.2026', 'FR_dept=IN(2889)'),
    'report/158891?JSON&FR_Date=01.01.2026&TO_Date=31.12.2026&FR_dept=IN(2889)',
    'equals panelFilter must still be appended to panel report requests'
);
assert.strictEqual(
    urlCtx.dashVizReportUrl('158891', '01.01.2026', '31.12.2026', '?FR_dept=IN(2889)&Тип%20документаID:158844'),
    'report/158891?JSON&FR_Date=01.01.2026&TO_Date=31.12.2026&FR_dept=IN(2889)',
    'mixed panelFilter values must append only server-side query parts'
);
assert.strictEqual(
    urlCtx.dashReportKey('Документы', 'Тип документаID:158844'),
    urlCtx.dashReportKey('Документы', ''),
    'local-only filters must share the same server report cache key'
);
assert.notStrictEqual(
    urlCtx.dashReportKey('Документы', 'FR_dept=IN(2889)'),
    urlCtx.dashReportKey('Документы', ''),
    'server filters must remain part of the report cache key'
);

const localCtx = { require };
vm.createContext(localCtx);
vm.runInContext(`
let dashModelData = {};
let dashPanelFilters = {};

${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashPanelDateValue')}
${extractFunction('dashPanelMonthValue')}
${extractFunction('dashPanelFilterValueKey')}
${extractFunction('dashPanelFilterIsActive')}
${extractFunction('dashPanelReportRowPassesFilter')}
${extractFunction('dashFilterReportRowsForPanel')}
${extractFunction('dashPanelFilterPartIsLocal')}
${extractFunction('dashPanelFilterParts')}
${extractFunction('dashDecodePanelFilterPart')}
${extractFunction('dashPanelLocalFilterState')}
${extractFunction('dashMergePanelFilterState')}
${extractFunction('dashPanelFiltersFor')}

const assert = require('assert');

const rows = [
    { 'Документ': 'Акт', 'Тип документаID': '158844', 'Статус': 'Опубликовано' },
    { 'Документ': 'Протокол', 'Тип документаID': '158835', 'Статус': 'Опубликовано' },
    { 'Документ': 'Новость', 'Тип документаID': '158844', 'Статус': 'Черновик' }
];

const localFilters = dashPanelLocalFilterState('Тип документаID:158844&Статус:Опубликовано');
assert.deepStrictEqual(
    dashFilterReportRowsForPanel(rows, localFilters).map(function(row) { return row['Документ']; }),
    ['Акт'],
    'local panelFilter values must filter report rows by matching field values'
);

dashModelData.fp1 = { panelFilters: dashPanelLocalFilterState('Тип документаID:158844') };
dashPanelFilters.fp1 = {
    'report:Статус': { source: 'report', field: 'Статус', kind: 'values', valueType: 'text', selected: ['Опубликовано'] }
};

assert.deepStrictEqual(
    dashFilterReportRowsForPanel(rows, dashPanelFiltersFor({ id: 'fp1' })).map(function(row) { return row['Документ']; }),
    ['Акт'],
    'configured local filters and interactive panel filters must be combined'
);
`, localCtx);

const formulaCtx = { require };
vm.createContext(formulaCtx);
vm.runInContext(`
const repRegex = /^\\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\\]$/;
let dashReports = {};
let dashReportNames = {};
let dashReportKeys = {};
let dashReportSources = {};
let dashFormulas = {};
let dashModelData = {};
let dashPanelFilters = {};

${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashNormalizeVal')}
${extractFunction('dashFormatNumberText')}
${extractFunction('dashPanelDateValue')}
${extractFunction('dashPanelMonthValue')}
${extractFunction('dashPanelFilterValueKey')}
${extractFunction('dashPanelFilterIsActive')}
${extractFunction('dashPanelReportRowPassesFilter')}
${extractFunction('dashFilterReportRowsForPanel')}
${extractFunction('dashPanelFilterPartIsLocal')}
${extractFunction('dashPanelFilterParts')}
${extractFunction('dashDecodePanelFilterPart')}
${extractFunction('dashPanelLocalFilterState')}
${extractFunction('dashMergePanelFilterState')}
${extractFunction('dashPanelFiltersFor')}
${extractFunction('dashNormalizePanelFilter')}
${extractFunction('dashReportRefId')}
${extractFunction('dashCleanReportRef')}
${extractFunction('dashReportKey')}
${extractFunction('dashParseReportFormula')}
${extractFunction('dashReportFieldName')}
${extractFunction('dashReportHasField')}
${extractFunction('dashReportSumField')}
${extractFunction('dashNormalizeGroupName')}
${extractFunction('dashSameGroupName')}
${extractFunction('dashReportGroupMatches')}
${extractFunction('dashCellRgColumn')}
${extractFunction('dashCellReportGroup')}
${extractFunction('dashCollectReportGroups')}
${extractFunction('dashResolveReportCellValue')}
${extractFunction('dashGetRepVals')}

const assert = require('assert');

const panel = { id: 'fp1' };
const cell = {
    innerHTML: '',
    attrs: { range: '20260101-20261231' },
    dataset: {},
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
    closest(selector) { return selector === '.f-panel' ? panel : null; }
};
const row = {
    querySelectorAll(selector) {
        return selector === '.f-rg-cell[data-src="report"],.f-values[data-src="report"]' ? [cell] : [];
    }
};
const document = {
    getElementById(id) {
        return id === 'item1' ? row : null;
    }
};

const reportKey = dashReportKey('Документы', 'Тип документаID:158844');
dashModelData.fp1 = { panelFilters: dashPanelLocalFilterState('Тип документаID:158844') };
dashReportNames[reportKey] = 'Документы';
dashReportKeys.item1 = reportKey;
dashFormulas.item1 = '[Документы.Количество]';
dashReports[reportKey] = [
    { Date: '20260101', 'Количество': '5', 'Тип документаID': '158844' },
    { Date: '20260101', 'Количество': '9', 'Тип документаID': '158835' }
];

dashGetRepVals();
assert.strictEqual(cell.innerHTML, '5', 'formula report cells must use locally filtered report rows');
`, formulaCtx);

console.log('issue-2352 dashboard local panelFilter: ok');
