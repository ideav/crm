'use strict';

// Issue #2360: dashboard report tables should hide service style columns
// and apply their per-row CSS values to the intended visible cells.

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

function maybeExtractFunction(name) {
    return source.includes('function ' + name + '(') ? extractFunction(name) : '';
}

const code = `
function dashFilterReportRowsForPanel(rows) { return rows || []; }

${extractFunction('dashAttr')}
${extractFunction('dashEscapeHtml')}
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashFormatNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashReportColumnNameHasIdSuffix')}
${maybeExtractFunction('dashReportColumnIsStyle')}
${extractFunction('dashReportColumnIsVisible')}
${extractFunction('dashReportVisibleColumns')}
${extractFunction('dashReportValueText')}
${extractFunction('dashReportColumnIsHtml')}
${extractFunction('dashReportColumnAlign')}
${extractFunction('dashReportHasTotals')}
${extractFunction('dashReportRowValue')}
${maybeExtractFunction('dashReportStyleTargetName')}
${maybeExtractFunction('dashReportColumnStyleKey')}
${maybeExtractFunction('dashReportRowCellStyles')}
${extractFunction('dashReportTableCellHtml')}
${extractFunction('dashRenderReportTableHtml')}
`;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const report = {
    columns: [
        { id: 'name', format: 'CHARS', name: 'Name' },
        { id: 'amount', format: 'NUMBER', name: 'Amount Total' },
        { id: 'amountStyle', format: 'CHARS', name: 'Amount Total.style' },
        { id: 'status', format: 'CHARS', name: 'Status' },
        { id: 'rowStyle', format: 'CHARS', name: 'style' },
        { id: 'note', format: 'CHARS', name: 'Note' },
        { id: 'missingStyle', format: 'CHARS', name: 'Missing Column.style' }
    ],
    rows: [
        {
            'Name': 'Contract',
            'Amount Total': '125',
            'Amount Total.style': 'background-color: #bfe3db; color: black',
            'Status': 'Ready',
            'style': 'font-weight: bold',
            'Note': 'Fallback target',
            'Missing Column.style': 'text-decoration: underline'
        }
    ]
};

const html = ctx.dashRenderReportTableHtml(report, {});

assert(!/<th[^>]*>Amount Total\.style<\/th>/.test(html), '.style column header is hidden');
assert(!/<th[^>]*>style<\/th>/.test(html), 'plain style column header is hidden');
assert(!/<th[^>]*>Missing Column\.style<\/th>/.test(html), 'unmatched .style column header is hidden');
assert(!/>background-color: #bfe3db; color: black<\//.test(html), 'targeted style value is not rendered as cell text');
assert(!/>font-weight: bold<\//.test(html), 'plain style value is not rendered as cell text');

assert(
    /<td[^>]*data-column-id="amount"[^>]*style="background-color: #bfe3db; color: black"[^>]*>125<\/td>/.test(html),
    '.style value is applied to the matching visible column, including names with spaces'
);
assert(
    /<td[^>]*data-column-id="status"[^>]*style="font-weight: bold"[^>]*>Ready<\/td>/.test(html),
    'plain style column applies to the previous visible cell'
);
assert(
    /<td[^>]*data-column-id="note"[^>]*style="text-decoration: underline"[^>]*>Fallback target<\/td>/.test(html),
    'unmatched .style column applies to the previous visible cell'
);

console.log('issue-2360 dashboard report style columns: ok');
