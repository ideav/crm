'use strict';

// Issue #2334: dashboard report tables should not repeat the panel title,
// totals should use the same table background, and pivot mode should use
// a PrimeIcons icon distinct from the regular table icon.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');
const css = fs.readFileSync('css/dash.css', 'utf8');
const primeIconsCss = fs.readFileSync('assets/vendor/primeicons/primeicons.css', 'utf8');

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

function extractDashVizTypes() {
    const marker = 'var DASH_VIZ_TYPES = ';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing DASH_VIZ_TYPES');

    const arrayStart = source.indexOf('[', start);
    let depth = 0;
    for (let i = arrayStart; i < source.length; i++) {
        if (source[i] === '[') depth++;
        if (source[i] === ']') depth--;
        if (depth === 0) return vm.runInNewContext(source.slice(arrayStart, i + 1));
    }
    throw new Error('Unclosed DASH_VIZ_TYPES');
}

function extractCssRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'));
    return match ? match[1] : '';
}

const code = `
function dashFilterReportRowsForPanel(rows) { return rows || []; }

${extractFunction('dashAttr')}
${extractFunction('dashEscapeHtml')}
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashReportColumnNameHasIdSuffix')}
${extractFunction('dashReportColumnIsVisible')}
${extractFunction('dashReportVisibleColumns')}
${extractFunction('dashReportColumnAlign')}
${extractFunction('dashReportHasTotals')}
${extractFunction('dashReportValueText')}
${extractFunction('dashReportColumnIsHtml')}
${extractFunction('dashReportRowValue')}
${extractFunction('dashReportTableCellHtml')}
${extractFunction('dashRenderReportTableHtml')}
`;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const report = {
    header: 'Сводная таблица',
    columns: [
        { id: 'date', format: 'DATE', name: 'Дата', totals: '' },
        { id: 'amount', format: 'NUMBER', name: 'Сумма', totals: '123' }
    ],
    rows: [
        { 'Дата': '03.05.2026', 'Сумма': '123' }
    ]
};

const html = ctx.dashRenderReportTableHtml(report, {});
assert(!html.includes('dash-report-title-row'), 'report title row is not rendered inside the table');
assert(!html.includes('<th colspan="2">Сводная таблица</th>'), 'report header does not duplicate the panel title');
assert(html.includes('<tr class="dash-head f-head">'), 'column header row is still rendered');
assert(html.includes('<tfoot><tr class="dash-report-totals-row">'), 'totals row is still rendered');

const totalsRule = extractCssRule('.dash-report-totals-row td');
assert(totalsRule, 'totals row CSS rule exists');
assert(!/background(?:-color)?\s*:/.test(totalsRule), 'totals row does not override the table background');

const vizTypes = extractDashVizTypes();
const tableViz = vizTypes.find(type => type.id === 'table');
const pivotViz = vizTypes.find(type => type.id === 'pivot');
assert.strictEqual(tableViz.icon, 'pi-table', 'regular table keeps the table icon');
assert(pivotViz.icon && pivotViz.icon !== tableViz.icon, 'pivot uses an icon distinct from regular table');
assert(new RegExp('\\.' + pivotViz.icon + ':before\\s*\\{').test(primeIconsCss),
    'pivot icon exists in bundled PrimeIcons CSS');

console.log('issue-2334 dashboard report display: ok');
