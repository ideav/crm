// Issue #2707: upload preview needs a "copy table" action that emits TSV
// suitable for pasting into Excel.

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

console.log('\nTest 1: template exposes a copy button for #preview');
assert(source.includes('id="copy-preview-table"'), 'copy button is rendered');
assert(source.includes('onclick="copyPreviewTable()"'), 'copy button calls copyPreviewTable');

const sandbox = { console };
[
    'normalizePreviewClipboardText',
    'previewCellClipboardText',
    'previewCellColSpan',
    'buildPreviewTableTsv'
].forEach(function(name) {
    const fn = extractFunction(name);
    if (fn) vm.runInNewContext(fn, sandbox);
});

console.log('\nTest 2: TSV uses clean copy text and keeps Excel columns aligned');
if (sandbox.buildPreviewTableTsv) {
    assert(sandbox.normalizePreviewClipboardText(' keep  double  spaces ') === 'keep  double  spaces',
        'ordinary repeated spaces inside a cell are preserved');
    const table = makeTable([
        makeRow([
            makeCell('Customer\nSHORT', { 'data-copy-text': 'Customer' }),
            makeCell('Jan 2026', { colspan: '2' })
        ]),
        makeRow([
            makeCell(' Acme\tLtd '),
            makeCell('10'),
            makeCell('20')
        ])
    ]);
    const tsv = sandbox.buildPreviewTableTsv(table);
    const lines = tsv.split('\n');
    assert(lines[0] === 'Customer\tJan 2026\t',
        'header row uses data-copy-text and expands colspan: ' + JSON.stringify(lines[0]));
    assert(lines[1] === 'Acme Ltd\t10\t20',
        'body row converts embedded tabs/newlines to spaces: ' + JSON.stringify(lines[1]));
    assert(lines[0].split('\t').length === lines[1].split('\t').length,
        'header and body column counts match');
}

console.log('\nTest 3: missing preview table is harmless');
if (sandbox.buildPreviewTableTsv) {
    assert(sandbox.buildPreviewTableTsv(null) === '', 'null table returns empty TSV');
}

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
