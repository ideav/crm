'use strict';

// Issue #2362: numeric values rendered in dashboard tables should use a
// regular space as the thousands separator while remaining parseable.

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

const code = `
var document = {};
function dashFilterReportRowsForPanel(rows) { return rows || []; }

${extractFunction('dashAttr')}
${extractFunction('dashEscapeHtml')}
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashFormatNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashCellText')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashReportColumnNameHasIdSuffix')}
${extractFunction('dashReportColumnIsStyle')}
${extractFunction('dashReportStyleTargetName')}
${extractFunction('dashReportColumnIsVisible')}
${extractFunction('dashReportVisibleColumns')}
${extractFunction('dashReportColumnIsMeasure')}
${extractFunction('dashReportValueText')}
${extractFunction('dashReportColumnStyleKey')}
${extractFunction('dashReportRowCellStyles')}
${extractFunction('dashReportColumnIsHtml')}
${extractFunction('dashReportColumnAlign')}
${extractFunction('dashReportHasTotals')}
${extractFunction('dashReportRowValue')}
${extractFunction('dashReportTableCellHtml')}
${extractFunction('dashRenderReportTableHtml')}
${extractFunction('dashCalcLineTotals')}
${extractFunction('dashEvalFormula')}
`;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

assert.strictEqual(ctx.dashFormatNumberText('1234567'), '1 234 567');
assert.strictEqual(ctx.dashFormatNumberText('-201754'), '-201 754');
assert.strictEqual(ctx.dashFormatNumberText('1234,56'), '1 234,56');
assert.strictEqual(ctx.dashFormatNumberText('2\u00a0061\u00a0818.88'), '2 061 818.88');
assert.strictEqual(ctx.dashFormatNumberText('001234'), '001234', 'leading-zero codes are left unchanged');
assert.strictEqual(ctx.dashGetFloat('1 234 567.89'), 1234567.89, 'formatted values remain parseable');

const report = {
    columns: [
        { id: 'name', format: 'CHARS', name: 'Name', totals: '' },
        { id: 'amount', format: 'NUMBER', name: 'Amount', totals: '1000000' },
        { id: 'delta', format: 'SIGNED', name: 'Delta', totals: '-201754' }
    ],
    rows: [
        { Name: 'Contract', Amount: '1234567.89', Delta: '-201754' }
    ]
};

const html = ctx.dashRenderReportTableHtml(report, {});
assert(html.includes('>1 234 567.89</td>'), 'NUMBER report cells are formatted');
assert(html.includes('>-201 754</td>'), 'SIGNED report cells are formatted');
assert(html.includes('>1 000 000</td>'), 'numeric report totals are formatted');
assert(!html.includes('>1234567.89</td>'), 'raw ungrouped number is not rendered');

const formulaCell = { innerHTML: '', setAttribute() {} };
assert.strictEqual(ctx.dashEvalFormula(formulaCell, '1000 + 2000'), true);
assert.strictEqual(formulaCell.innerHTML, '3 000', 'calculated formula cells are formatted');

let lineTotal;
const row = {
    querySelectorAll(selector) {
        if (selector !== '.f-rg-cell') return [];
        return [
            { innerHTML: '2 061 818' },
            { innerHTML: '2 061 818.88' },
            { innerHTML: '-201 754' }
        ];
    }
};
lineTotal = {
    innerHTML: '',
    title: '',
    closest() { return row; }
};
ctx.document = {
    querySelectorAll(selector) {
        return selector === '#dash-model .f-line-sum' ? [lineTotal] : [];
    }
};
ctx.dashCalcLineTotals();
assert.strictEqual(String(lineTotal.innerHTML), '3 921 882.88', 'line totals are formatted');

console.log('issue-2362 dashboard thousands format: ok');
