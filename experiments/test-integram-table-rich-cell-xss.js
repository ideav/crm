/*
 * Regression tests for executable rich-cell content.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'js', 'integram-table');
const renderCellSource = fs.readFileSync(path.join(root, '06-render-cell.js'), 'utf8');
const formEditSource = fs.readFileSync(path.join(root, '19-form-edit.js'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, '25-create-form-helper.js'), 'utf8');
const utilsSource = fs.readFileSync(path.join(root, '22-utils.js'), 'utf8');
const modularSource = fs.readdirSync(root)
    .filter(name => name.endsWith('.js'))
    .sort()
    .map(name => fs.readFileSync(path.join(root, name), 'utf8'))
    .join('\n');

function extractMethod(source, name) {
    const marker = '\n        ' + name + '(';
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) throw new Error('Could not find method ' + name);
    const start = markerIndex + 1;
    const brace = source.indexOf('{', start);
    let depth = 0;
    for (let index = brace; index < source.length; index++) {
        if (source[index] === '{') depth++;
        else if (source[index] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error('Could not find method end for ' + name);
}

const Host = new Function(
    'class Host {' +
    extractMethod(utilsSource, 'escapeHtml') +
    extractMethod(utilsSource, 'normalizeNumericId') +
    extractMethod(utilsSource, 'sanitizeLinkUrl') +
    extractMethod(utilsSource, 'sanitizeCellStyle') +
    extractMethod(utilsSource, 'sanitizeCellHtml') +
    extractMethod(utilsSource, 'parseButtonAction') +
    '} return Host;'
)();
const host = new Host();

assert.strictEqual(
    host.sanitizeCellHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;',
    'HTML sanitizer must fail closed when no DOM parser is available'
);

assert.strictEqual(host.normalizeNumericId(42), '42',
    'numeric IDs must remain usable');
assert.strictEqual(host.normalizeNumericId("1');alert(1)//"), '',
    'script-bearing IDs must be rejected instead of interpolated into handlers');
assert.strictEqual(host.normalizeNumericId('12x'), '',
    'partially numeric IDs must be rejected');

assert.strictEqual(host.sanitizeLinkUrl('javascript:alert(1)'), '',
    'javascript URLs must be rejected');
assert.strictEqual(host.sanitizeLinkUrl('java\nscript:alert(1)'), '',
    'control-character-obfuscated javascript URLs must be rejected');
assert.strictEqual(host.sanitizeLinkUrl('data:text/html,<script>alert(1)</script>'), '',
    'data URLs must be rejected');
assert.strictEqual(host.sanitizeLinkUrl('/db/file/report.pdf'), '/db/file/report.pdf',
    'same-origin relative file URLs remain supported');
assert.strictEqual(host.sanitizeLinkUrl('https://files.example/report.pdf'), 'https://files.example/report.pdf',
    'HTTPS file URLs remain supported');

assert.strictEqual(
    host.sanitizeCellStyle('color: red; text-align: center; position: fixed'),
    'color: red; text-align: center',
    'STYLE allow-list must drop layout-breaking properties'
);
assert.strictEqual(
    host.sanitizeCellStyle('color: red" onmouseover="alert(1); background: url(https://evil.invalid/x)'),
    '',
    'STYLE values must not escape the attribute or load attacker resources'
);

assert.deepStrictEqual(
    host.parseButtonAction("newApi('POST','_m_set/42?JSON','','reloadAllIntegramTables')"),
    ['POST', '_m_set/42?JSON', '', 'reloadAllIntegramTables'],
    'literal newApi BUTTON actions remain supported without eval'
);
assert.strictEqual(host.parseButtonAction('alert(1)'), null,
    'arbitrary function calls must be blocked');
assert.strictEqual(host.parseButtonAction("newApi('GET','x',window.alert)"), null,
    'BUTTON arguments must be scalar literals');

assert(renderCellSource.includes('this.sanitizeCellHtml(displayValue)'),
    'HTML cells must pass through the rich-content sanitizer');
assert(renderCellSource.includes('this.sanitizeCellHtml(value)'),
    'server-provided FILE anchors must pass through the sanitizer');
assert(!renderCellSource.includes('btnOnclick'),
    'BUTTON values must never be copied into inline onclick');
assert(renderCellSource.includes('const subordinateTypeId = this.normalizeNumericId(column.arr_id);'),
    'subordinate actions must validate table IDs before building inline handlers');
assert(renderCellSource.includes('const actionColumnId = this.normalizeNumericId(col.id);'),
    'column create buttons must validate metadata IDs before building inline handlers');
assert(formEditSource.includes('const nestedTypeId = this.normalizeNumericId(req.arr_id);'),
    'nested subordinate actions must validate metadata IDs before building inline handlers');
assert(helperSource.includes("recordId = /^\\d+$/.test(String(recordId ?? '').trim())"),
    'standalone edit entry point must validate IDs before network requests');

assert(renderCellSource.includes('colHeaders.map(h => `<th>${ this.escapeHtml(String(h)) }</th>`)'),
    'paste preview headers must be HTML-escaped');
assert(renderCellSource.includes('value="${ this.escapeHtml(String(val)) }"'),
    'paste preview input values must be fully attribute-escaped');
assert(!renderCellSource.includes('value="${val.replace(/"/g'),
    'partial quote-only escaping must not be used for paste preview values');
assert(formEditSource.includes('const safeFileHref = this.sanitizeLinkUrl(fileHref);'),
    'edit forms must sanitize server-provided file URLs');
assert(helperSource.includes('const safeFileHref = this.sanitizeLinkUrl(fileHref);'),
    'standalone edit forms must sanitize server-provided file URLs');
assert.strictEqual((modularSource.match(/target="_blank"(?!\s+rel="noopener noreferrer")/g) || []).length, 0,
    'new-tab links must disable opener access');

console.log('PASS table HTML, file URLs and new-tab links reject executable or opener-capable content');
