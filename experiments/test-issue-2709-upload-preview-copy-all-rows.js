// Issue #2709: upload preview copy must use all parsed rows from JS memory,
// not only the currently rendered preview page.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/upload.html', 'utf8');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log('  PASS: ' + msg);
        passed++;
    } else {
        console.error('  FAIL: ' + msg);
        failed++;
    }
}

function extractFunction(name) {
    const start = source.indexOf('function ' + name + '(');
    assert(start !== -1, name + ' exists in templates/upload.html');
    if (start === -1) return '';

    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    assert(false, name + ' has a complete function body');
    return '';
}

function makeCell(text, attrs) {
    attrs = attrs || {};
    return {
        textContent: text,
        getAttribute: function(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        }
    };
}

function makeRow(cells) {
    return {
        querySelectorAll: function(selector) {
            assert(selector === 'th,td', 'row selector requests table cells');
            return cells;
        }
    };
}

function makeTable(rows) {
    return {
        querySelectorAll: function(selector) {
            assert(selector === 'tr', 'table selector requests rows');
            return rows;
        }
    };
}

const sandbox = {
    console,
    sourceMap: [
        { id: '0', name: 'Name', skip: 0 },
        { id: '1', name: 'Amount', skip: 0 }
    ],
    chosenType: undefined,
    autoParent: undefined,
    toImport: [],
    evalErrs: {},
    origMap: {},
    serializeUploadCellValue: function(v) {
        if (v === undefined || v === null) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return v.toString();
    },
    getParent: function() {
        return '';
    }
};

[
    'normalizePreviewClipboardText',
    'previewCellClipboardText',
    'previewCellColSpan',
    'buildPreviewTableTsv',
    'previewCopyActionHtml',
    'appendPreviewTsvText',
    'buildPreviewImportHeaderRow',
    'previewImportColumnIndex',
    'previewImportCellText',
    'buildPreviewImportTsv'
].forEach(function(name) {
    const fn = extractFunction(name);
    if (fn) vm.runInNewContext(fn, sandbox);
});

for (let i = 1; i <= 1001; i++) {
    sandbox.toImport[i] = ['row ' + i, String(i)];
}

console.log('\nTest 1: DOM table only represents the rendered preview page');
const renderedTable = makeTable([
    makeRow([
        makeCell('Name', { 'data-copy-text': 'Name' }),
        makeCell('Amount', { 'data-copy-text': 'Amount' })
    ]),
    makeRow([
        makeCell('row 1', { 'data-copy-text': 'row 1' }),
        makeCell('1', { 'data-copy-text': '1' })
    ])
]);
const domTsv = sandbox.buildPreviewTableTsv(renderedTable);
assert(domTsv.split('\n').length === 2, 'rendered table fixture has one data row');

console.log('\nTest 2: preview copy TSV includes every parsed import row');
if (sandbox.buildPreviewImportTsv) {
    const fullTsv = sandbox.buildPreviewImportTsv(renderedTable);
    const lines = fullTsv.split('\n');
    assert(lines.length === 1002, 'TSV contains header plus all 1001 data rows');
    assert(lines[0] === 'Name\tAmount', 'header uses import column names');
    assert(lines[1] === 'row 1\t1', 'first parsed row is copied');
    assert(lines[1001] === 'row 1001\t1001', 'last parsed row beyond the rendered page is copied');
}

console.log('\nTest 3: copy action is an icon in the resume block');
if (sandbox.previewCopyActionHtml) {
    const actionHtml = sandbox.previewCopyActionHtml();
    assert(actionHtml.includes('class="preview-copy-icon"'), 'copy action uses icon-only control styling');
    assert(!actionHtml.includes('> Скопировать таблицу'), 'copy control has no visible text label');
    assert(source.includes('(l>0?previewCopyActionHtml():\'\')+\'</h5>\''),
        'copy action is appended to the #resume heading');
}

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
