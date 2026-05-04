'use strict';

// Issue #2330: if a dashboard panel has no item rows (itemID IS NULL),
// table mode should render the configured report JSON, including column headers,
// column formats, data rows, and totals.

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
function dashEnsureTableResizeHandle() {}

${extractFunction('dashAttr')}
${extractFunction('dashEscapeHtml')}
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashFormatNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashNormalizeReportJson')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashReportColumnNameHasIdSuffix')}
${extractFunction('dashReportColumnIsStyle')}
${extractFunction('dashReportStyleTargetName')}
${extractFunction('dashReportColumnIsMeasure')}
${extractFunction('dashReportColumnIsVisible')}
${extractFunction('dashReportVisibleColumns')}
${extractFunction('dashReportRowValue')}
${extractFunction('dashPanelGetVizReportData')}
${extractFunction('dashReportValueText')}
${extractFunction('dashReportColumnStyleKey')}
${extractFunction('dashReportRowCellStyles')}
${extractFunction('dashReportColumnIsHtml')}
${extractFunction('dashReportColumnAlign')}
${extractFunction('dashReportHasTotals')}
${extractFunction('dashReportTableCellHtml')}
${extractFunction('dashRenderReportTableHtml')}
${extractFunction('dashRenderReportTable')}

const assert = require('assert');

const sampleReport = {
    header: 'Участники',
    columns: [
        { id: '158716', type: '158602', format: 'DATE', name: 'Дата изменения', granted: 1, totals: '' },
        { id: '158718', type: '158604', format: 'SHORT', name: 'Участник', granted: 1, totals: '' },
        { id: '158720', type: '158606', format: 'SIGNED', name: 'Доля', granted: 1, totals: '100.00' },
        { id: '158787', type: '', format: 'SHORT', name: 'Стоимость доли текущая, млн р', totals: 294 }
    ],
    data: [
        ['30.12.2025', '30.12.2025'],
        ['ИО', 'ООО'],
        ['3', '2'],
        ['7.8', '6.9']
    ]
};

const normalized = dashNormalizeReportJson(sampleReport);
assert.strictEqual(normalized.header, 'Участники');
assert.strictEqual(normalized.columns[2].totals, '100.00');
assert.strictEqual(normalized.columns[3].totals, 294);
assert.deepStrictEqual(normalized.rows[1], {
    'Дата изменения': '30.12.2025',
    'Участник': 'ООО',
    'Доля': '2',
    'Стоимость доли текущая, млн р': '6.9'
});

const html = dashRenderReportTableHtml(normalized, {});
assert(!html.includes('dash-report-title-row'), 'report header should not duplicate the panel title');
assert(html.includes('data-format="SIGNED"'), 'column format should be preserved in rendered table markup');
assert(html.includes('<tfoot>'), 'report totals should render a footer');
assert(html.includes('100.00'), 'SIGNED column total should be visible');
assert(html.includes('294'), 'numeric zero-safe total values should be visible');
assert(html.includes('dash-report-cell--right'), 'numeric columns should be right-aligned');
assert(html.includes('dash-report-cell--center'), 'date columns should be center-aligned');

dashVizReports.reportKey = normalized;
dashModelData.fp1 = { vizReportKey: 'reportKey' };

const tableWrap = { innerHTML: '' };
const reportOnlyPanel = {
    id: 'fp1',
    querySelector(selector) {
        if (selector === '.f-table-wrap') return tableWrap;
        if (selector === '.f-item') return null;
        return null;
    }
};

assert.strictEqual(dashRenderReportTable(reportOnlyPanel), true);
assert(tableWrap.innerHTML.includes('Дата изменения'), 'report-only panel table should be replaced with report table');

const originalTableWrap = { innerHTML: '<table><tbody><tr class="f-item"></tr></tbody></table>' };
const panelWithItems = {
    id: 'fp1',
    querySelector(selector) {
        if (selector === '.f-table-wrap') return originalTableWrap;
        if (selector === '.f-item') return { id: 'item1' };
        return null;
    }
};

assert.strictEqual(dashRenderReportTable(panelWithItems), false);
assert.strictEqual(originalTableWrap.innerHTML, '<table><tbody><tr class="f-item"></tr></tbody></table>');
`;

vm.runInNewContext(code, { require });
console.log('issue-2330 dashboard report table: ok');
