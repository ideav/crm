// Issue #2390: Clearing a value in a row with a non-empty dashboard label
// must trigger _m_del. Previously the broken client-side post-filter
// (rec['Метка']) on JSON_OBJ responses silently dropped every record with
// a non-empty label, so the search returned 0 results and the empty-newVal
// branch returned without calling _m_del.
//
// Fix:
//   - Send the actual label substring to the server (F_<labelFieldId>=%LABEL%)
//     so the existing record is returned and matched.
//   - Drop the broken client-side post-filter that read rec['Метка']
//     from a JSON_OBJ payload (which only exposes positional `r` arrays).
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

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

function extractWindowFn(name) {
    const marker = 'window.' + name + ' = function';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing window fn ' + name);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) {
            // Convert "window.X = function(...) { body }" into "function X(...) { body }"
            const fnStart = source.indexOf('function', start);
            const argsStart = source.indexOf('(', fnStart);
            return 'function ' + name + source.slice(argsStart, i + 1);
        }
    }
    throw new Error('Unclosed window fn ' + name);
}

const calls = [];

const code = `
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const DASH_VALUE_LABEL_FIELD_ID = '155556';
const DASH_MATRIX_DATE_FIELD_ID = '155552';
const DASH_MATRIX_LINE_FIELD_ID = '155553';
const DASH_MATRIX_COL_FIELD_ID = '155554';
const DASH_MATRIX_LABEL_FIELD_ID = '155557';

function makeCell({ valueItemId, itemName, fr, to, rgHead, dashLabel, matrixLine, matrixCol, matrixLabel }) {
    const dataset = {};
    if (valueItemId) dataset.valueItemId = valueItemId;
    if (rgHead) dataset.rgHead = rgHead;
    if (dashLabel) dataset.dashLabel = dashLabel;
    if (matrixLine) dataset.matrixLine = matrixLine;
    if (matrixCol) dataset.matrixCol = matrixCol;
    if (matrixLabel) dataset.matrixLabel = matrixLabel;

    const sheet = {
        querySelector(selector) {
            if (selector === '.dash-fr-input') return fr ? { value: fr } : null;
            if (selector === '.dash-to-input') return to ? { value: to } : null;
            return null;
        }
    };
    const row = {
        getAttribute(name) { return name === 'item-name' ? (itemName || '') : null; },
        querySelectorAll() { return []; }
    };
    const table = { querySelector() { return null; } };

    return {
        dataset,
        style: {},
        textContent: '',
        setAttribute() {},
        getAttribute() { return null; },
        closest(selector) {
            if (selector === 'tr') return row;
            if (selector === '.f-sheet') return sheet;
            if (selector === 'table') return table;
            return null;
        }
    };
}

function dashCellDateFr(td) {
    const sheet = td.closest('.f-sheet');
    const input = sheet && sheet.querySelector('.dash-fr-input');
    return (input && input.value) || '';
}
function dashCellDateTo(td) {
    const sheet = td.closest('.f-sheet');
    const input = sheet && sheet.querySelector('.dash-to-input');
    return (input && input.value) || '';
}
function dashMatrixUsesDates(td) { return true; }
function dashMatrixSheetInputValue(td, selector) {
    const sheet = td.closest('.f-sheet');
    const input = sheet && sheet.querySelector(selector);
    return input ? input.value : '';
}

function newApi(method, url, callback, params, ctx) {
    callRecord.push({ method, url, callback, params, ctx });
}
function dashSetStatus(s) {}
function dashFormatNumberText(v) { return v; }
function dashCalcCells() {}
function dashCalcRGFormulas() {}
function dashShowMultivalModal() {}

const window = {};
const callRecord = [];

${extractFunction('dashCellItemRef')}
${extractFunction('dashCellRgHead')}
${extractFunction('dashValueSearchUrl')}
${extractFunction('dashMatrixDashLabel')}
${extractFunction('dashMatrixSearchUrl')}
${extractFunction('dashSaveValue')}
${extractFunction('dashSaveCell')}
${extractWindowFn('dashValueSearchDone')}

// === Issue #2390 specific cases ===

// Case 1: dashValueSearchUrl with non-empty label must include the label
// substring, not just '%'.
let td = makeCell({
    valueItemId: '2811',
    fr: '20260101',
    to: '20260131',
    rgHead: 'Кол-во',
    dashLabel: 'вводные'
});
let url = dashValueSearchUrl(td);
const encodedLabel = encodeURIComponent('вводные');
assert(
    url.includes('F_155556=%' + encodedLabel + '%'),
    'expected label substring filter F_155556=%вводные%, got: ' + url
);

// Case 2: dashValueSearchUrl with empty label keeps the '!%' (IS NULL) filter.
td = makeCell({
    valueItemId: '2811',
    fr: '20260101',
    to: '20260131',
    rgHead: 'Кол-во'
});
url = dashValueSearchUrl(td);
assert(
    url.includes('F_155556=!%'),
    'empty label must use F_155556=!%, got: ' + url
);

// Case 3: dashMatrixSearchUrl mirrors the same fix.
td = makeCell({
    matrixLine: 'line',
    matrixCol: 'col',
    fr: '20260101',
    to: '20260131',
    dashLabel: 'вводные'
});
url = dashMatrixSearchUrl(td);
assert(
    url.includes('F_155557=%' + encodedLabel + '%'),
    'matrix: expected label substring filter F_155557=%вводные%, got: ' + url
);

// Case 4: dashMatrixSearchUrl with empty label keeps '!%'.
td = makeCell({
    matrixLine: 'line',
    matrixCol: 'col',
    fr: '20260101',
    to: '20260131'
});
url = dashMatrixSearchUrl(td);
assert(
    url.includes('F_155557=!%'),
    'matrix: empty label must use F_155557=!%, got: ' + url
);

// Case 5: end-to-end simulation of clearing a value -> _m_del.
//   - dashSaveValue must issue a GET search.
//   - Feeding the JSON_OBJ payload from the issue back into
//     dashValueSearchDone must produce a _m_del POST (no longer
//     silently dropped by the broken client-side post-filter).
const cell = makeCell({
    valueItemId: '2811',
    fr: '20260101',
    to: '20260131',
    rgHead: 'Кол-во',
    dashLabel: 'вводные'
});
cell.dataset.src = 'rg';

callRecord.length = 0;
dashSaveValue(cell, '', '2');
assert(callRecord.length === 1, 'expected one search GET, got: ' + callRecord.length);
assert(callRecord[0].method === 'GET', 'expected GET, got ' + callRecord[0].method);
assert(callRecord[0].callback === 'dashValueSearchDone', 'wrong callback: ' + callRecord[0].callback);
assert(callRecord[0].url.includes('F_155556=%' + encodedLabel + '%'),
    'search URL must use the actual label substring filter, got: ' + callRecord[0].url);

// JSON_OBJ payload from the issue body — note the absence of any 'Метка'
// top-level key; the label only appears inside the positional 'r' array.
const serverJson = [
    {
        "i": 159454,
        "u": 1,
        "o": 1,
        "r": ["2", "01.01.2026", "2811:сайт", "", "", "", "1974:Кол-во", "вводные"]
    }
];
const ctx = callRecord[0].ctx;
callRecord.length = 0;
dashValueSearchDone(serverJson, ctx);
assert(callRecord.length === 1, 'expected one POST after search, got: ' + callRecord.length);
assert(callRecord[0].method === 'POST', 'expected POST, got: ' + callRecord[0].method);
assert(callRecord[0].url.indexOf('_m_del/159454') === 0,
    'expected _m_del/159454, got: ' + callRecord[0].url);
`;

vm.runInNewContext(code, { console });
console.log('issue-2390 cleared value saves with label: ok');
