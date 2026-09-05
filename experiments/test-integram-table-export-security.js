/**
 * Exported CSV must not execute server-controlled values as spreadsheet formulas,
 * and numeric zero must survive the plain-text conversion.
 */

const assert = require('assert');

const IntegramTable = require('../js/integram-table.js');
const table = Object.create(IntegramTable.prototype);

table.columns = [{ id: 'number', name: 'Number', format: 'NUMBER' }];
assert.deepStrictEqual(
    table.prepareExportDataFromRows([[0]], table.columns),
    [['0']],
    'numeric zero must not be converted to an empty cell'
);

const dangerous = [
    '=HYPERLINK("https://example.invalid")',
    '+cmd|\' /C calc\'!A0',
    '-2+3',
    '@SUM(1+1)',
    '  =1+1',
    '\t@evil',
    '\u00A0=hidden'
];
for (const value of dangerous) {
    assert.strictEqual(table.neutralizeCsvFormula(value), "'" + value, `blocked formula: ${ value }`);
}
assert.strictEqual(table.neutralizeCsvFormula('ordinary text'), 'ordinary text');
assert.strictEqual(table.escapeCsvCell('a,b'), '"a,b"');
assert.strictEqual(table.escapeCsvCell('a"b'), '"a""b"');
assert.strictEqual(table.escapeCsvCell('line\r\nbreak'), '"line\r\nbreak"');

let downloadedBlob = null;
let downloadedName = null;
let successToast = null;
table.options = { title: 'audit' };
table.downloadBlob = (blob, filename) => {
    downloadedBlob = blob;
    downloadedName = filename;
};
table.showToast = (message, level) => {
    successToast = { message, level };
};

const columns = [
    { name: '=malicious header' },
    { name: 'Safe' }
];
table.exportToCSV([
    ['+payload', 'a,b'],
    ['normal', '@formula']
], columns);

assert(downloadedBlob instanceof Blob);
assert.match(downloadedName, /^audit_\d{4}-\d{2}-\d{2}\.csv$/);
assert.deepStrictEqual(successToast, { message: 'CSV файл успешно экспортирован', level: 'success' });

Promise.all([downloadedBlob.text(), downloadedBlob.arrayBuffer()]).then(([text, buffer]) => {
    assert.deepStrictEqual(
        Array.from(new Uint8Array(buffer).slice(0, 3)),
        [0xEF, 0xBB, 0xBF],
        'CSV keeps the UTF-8 BOM expected by Excel'
    );
    assert.strictEqual(
        text,
        '\'=malicious header,Safe\n\'+payload,"a,b"\nnormal,\'@formula'
    );
    console.log('PASS CSV formulas are neutralized and numeric zero is preserved');
}).catch(error => {
    console.error('FAIL export security:', error);
    process.exit(1);
});