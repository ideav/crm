'use strict';

// Issue #2350: dashboard report tables should hide columns whose names end
// with ID and render cells from HTML-format columns as markup.

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
function dashFilterReportRowsForPanel(rows) { return rows || []; }

${extractFunction('dashAttr')}
${extractFunction('dashEscapeHtml')}
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashReportColumnIsNumeric')}
${extractFunction('dashReportColumnNameHasIdSuffix')}
${extractFunction('dashReportColumnIsVisible')}
${extractFunction('dashReportVisibleColumns')}
${extractFunction('dashReportValueText')}
${extractFunction('dashReportColumnIsHtml')}
${extractFunction('dashReportColumnAlign')}
${extractFunction('dashReportHasTotals')}
${extractFunction('dashReportRowValue')}
${extractFunction('dashReportTableCellHtml')}
${extractFunction('dashRenderReportTableHtml')}
`;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const report = {
    columns: [
        { id: 'doc', format: 'CHARS', name: 'Документ' },
        { id: 'docTypeId', format: 'NUMBER', name: 'Тип документаID', totals: '999' },
        { id: 'calc', format: 'HTML', name: 'Вычисляемое' },
        { id: 'plain', format: 'CHARS', name: 'Обычный HTML' }
    ],
    rows: [
        {
            'Документ': 'Акт',
            'Тип документаID': '12345',
            'Вычисляемое': '<span class="status-ok">Готово</span>',
            'Обычный HTML': '<b>plain text</b>'
        }
    ]
};

const html = ctx.dashRenderReportTableHtml(report, {});

assert(!html.includes('Тип документаID'), 'ID-suffix column header is hidden');
assert(!html.includes('12345'), 'ID-suffix column data is hidden');
assert(!html.includes('999'), 'ID-suffix column totals are hidden');
assert(html.includes('<span class="status-ok">Готово</span>'), 'HTML-format cell renders raw markup');
assert(!html.includes('&lt;span'), 'HTML-format cell is not escaped');
assert(html.includes('&lt;b&gt;plain text&lt;/b&gt;'), 'non-HTML cell remains escaped');
assert(html.includes('data-format="HTML"'), 'HTML column format is preserved in rendered markup');

console.log('issue-2350 dashboard report table: ok');
