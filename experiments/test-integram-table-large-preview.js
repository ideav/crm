/*
 * Regression coverage for the large interactive preview dataset.
 * Run with: node experiments/test-integram-table-large-preview.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'demo', 'integram-table-polish.html'), 'utf8');
const datasetScriptMatch = html.match(/<script>\s*(const previewColumns =[\s\S]*?window\.fetch =[\s\S]*?)<\/script>\s*<script src="\.\.\/js\/integram-table\.js"><\/script>/);
assert.ok(datasetScriptMatch, 'large preview data script is present');

const sandbox = {
    console,
    URL,
    Response,
    setTimeout,
    document: { getElementById: () => ({}) },
    window: { location: { origin: 'http://127.0.0.1:8765' }, setTimeout }
};
vm.createContext(sandbox);
const preview = vm.runInContext(datasetScriptMatch[1] + '\n;({ previewColumns, previewRecordCount, previewRecords });', sandbox);

assert.strictEqual(preview.previewRecordCount, 487, 'preview has the intended non-round record count');
assert.strictEqual(preview.previewColumns.length, 24, 'preview has 24 columns');
assert.strictEqual(preview.previewRecords.length, 487, 'all preview records are generated');
assert.ok(preview.previewRecords.every(record => record.length === 24), 'every record matches the column count');
assert.strictEqual(preview.previewRecords[0][0], '100001', 'first edge record exists');
assert.strictEqual(preview.previewRecords[486][0], '100487', 'last edge record exists');
assert.strictEqual(preview.previewRecords[0][1], '', 'empty supplier edge case exists');
assert.strictEqual(preview.previewRecords[0][4], '0', 'zero amount edge case exists');
assert.match(preview.previewRecords[0][6], /WITHOUT-BREAKS/, 'long unbroken SKU edge case exists');
assert.match(preview.previewRecords[0][20], /<спецзаказ> &/, 'escaping edge case exists');
assert.match(html, /pageSize:\s*50/, 'table requests 50 visible records per page');

(async () => {
    const firstResponse = await sandbox.window.fetch('/preview/report/42?LIMIT=0,51');
    const firstPage = await firstResponse.json();
    assert.strictEqual(firstPage.data.length, 24, 'first page includes all columns');
    assert.strictEqual(firstPage.data[0].length, 51, 'first page includes one look-ahead row');

    const lastResponse = await sandbox.window.fetch('/preview/report/42?LIMIT=450,51');
    const lastPage = await lastResponse.json();
    assert.strictEqual(lastPage.data[0].length, 37, 'last page is intentionally partial');
    assert.strictEqual(lastPage.data[0][0], '100451', 'last page starts at the requested offset');
    assert.strictEqual(lastPage.data[0][36], '100487', 'last page reaches the final record');

    const countResponse = await sandbox.window.fetch('/preview/report/42?RECORD_COUNT=1');
    assert.deepStrictEqual(await countResponse.json(), { count: 487 }, 'count endpoint reports the full dataset');
    console.log('PASS: large preview contains 487 rows, 24 columns and correct edge pages');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
