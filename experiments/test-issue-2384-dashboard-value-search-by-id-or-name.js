// Issue #2384: dashValueSearchUrl must distinguish between
// FR_1042=@{id}  — when the cell knows the реф id (data-value-item-id)
// FR_1042={name} — when only the row's item-name is available
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

const code = `
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const DASH_VALUE_LABEL_FIELD_ID = '1099';

function makeCell({ valueItemId, itemName, fr, to, rgHead, dashLabel }) {
    const dataset = {};
    if (valueItemId) dataset.valueItemId = valueItemId;
    if (rgHead) dataset.rgHead = rgHead;
    if (dashLabel) dataset.dashLabel = dashLabel;

    const sheet = {
        querySelector(selector) {
            if (selector === '.dash-fr-input') return fr ? { value: fr } : null;
            if (selector === '.dash-to-input') return to ? { value: to } : null;
            return null;
        }
    };
    const row = {
        getAttribute(name) { return name === 'item-name' ? (itemName || '') : null; }
    };
    const table = { querySelector() { return null; } };

    return {
        dataset,
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

${extractFunction('dashCellItemRef')}
${extractFunction('dashCellRgHead')}
${extractFunction('dashValueSearchUrl')}

// Case 1: id known — must use FR_1042=@{id}
let td = makeCell({ valueItemId: '5678', itemName: 'Выручка', fr: '2026-01-01', to: '2026-01-31' });
let url = dashValueSearchUrl(td);
assert(url.includes('FR_1042=@5678'), 'expected FR_1042=@5678, got: ' + url);
assert(!url.includes('FR_1042=@%'), 'should not double-encode @ for ids: ' + url);

// Case 2: only name — must use FR_1042={name} without @
td = makeCell({ itemName: 'Выручка', fr: '2026-01-01', to: '2026-01-31' });
url = dashValueSearchUrl(td);
const encoded = encodeURIComponent('Выручка');
assert(url.includes('FR_1042=' + encoded), 'expected FR_1042={name} without @, got: ' + url);
assert(!url.includes('FR_1042=@'), 'name-based filter must not use @ prefix: ' + url);

// Case 3: empty name + no id — still no @
td = makeCell({});
url = dashValueSearchUrl(td);
assert(url.includes('FR_1042='), 'expected FR_1042= present, got: ' + url);
assert(!url.includes('FR_1042=@'), 'empty name must not use @ prefix: ' + url);

// Case 4: rgHead and dashLabel passthrough still work
td = makeCell({ valueItemId: '42', rgHead: 'group', dashLabel: 'a', fr: '2026-02-01' });
url = dashValueSearchUrl(td);
assert(url.includes('FR_1042=@42'), 'rgHead case: ' + url);
assert(url.includes('F_1104=group'), 'rgHead must be preserved: ' + url);
assert(url.includes('F_1099=%'), 'dashLabel must drive label filter: ' + url);
`;

vm.runInNewContext(code, { console });
console.log('issue-2384 dashboard value search: ok');
