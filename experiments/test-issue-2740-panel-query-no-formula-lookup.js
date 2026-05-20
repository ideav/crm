// Test: when a panel is driven by panelQuery and the row has no formula,
// fall back to looking the value up by the row name (itemSrcName ?? item),
// applying the Метка label filter (issue #2740).
//
// Reproduces the dashDrawPeriods rg-with-columns resolution: the bucket
// produced by dashGetPanelValuesDone is keyed either by `itemKey` (no
// RGcolumnsID) or by `itemKey:colGroup`. For rows with no formulas the
// renderer used to only try `itemKey:colName`, leaving the cell empty
// whenever panelQuery returns rows without an RGcolumnsID. The fallback
// added in this issue restores the value from the plain item-name slot
// for those cells.

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passed++; }
    else { console.error('  FAIL: ' + msg); failed++; }
}

// ─── Minimal stubs mirroring dash.js shape ──────────────────────────────

let dashItems = {};
let dashValues = {};
let dashPanelValues = {};
let dashFormulas = {};

function dashGetFloat(v) {
    var f = parseFloat(String(v).replace(',', '.'));
    return isNaN(f) ? 0 : f;
}
function dashNormalizeVal(_item, val) {
    var v = val || '';
    if (typeof val === 'object' && val !== null) v = val[0].val;
    return String(v).replace(/ /g, '').replace(/,/g, '.');
}
// Simplified label-match: undefined dashLabel matches anything; otherwise
// the entry's Метка must equal the requested label exactly. Mirrors the
// behaviour of dashMatrixLabelMatches with a defined row label.
function dashMatrixLabelMatches(dashLabel, entryLabel) {
    if (dashLabel === '' || dashLabel === undefined || dashLabel === null) return true;
    return String(entryLabel || '') === String(dashLabel);
}
function dashGetVal(item, fr, to, dashLabel, panelKey) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item;
    var store = (panelKey && dashPanelValues[panelKey]) ? dashPanelValues[panelKey] : dashValues;
    if (!store[key]) return;
    var hasLabelFilter = dashLabel !== undefined;
    for (i in store[key]) {
        var entry = store[key][i];
        if (hasLabelFilter && !dashMatrixLabelMatches(dashLabel, entry['Метка'])) continue;
        if (!fr || (entry.date >= fr && entry.date <= to)) {
            valids = true;
            acc += dashGetFloat(entry.val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}
function dashGetValDetails() { return ''; }

function dashRowLookupName(row) {
    if (!row) return '';
    var meta = dashItems[row.id];
    return (meta && meta.srcName) || row.getAttribute('item-name') || '';
}

// itemRegex — copied from dash.js.
const itemRegex = /^\[([A-Za-яЁё][ A-Za-яЁё0-9\(\)-]*)\]$/;

// ─── The bit under test ─────────────────────────────────────────────────
// Replicates the rg-with-columns cell-value resolution in dashDrawPeriods,
// including the new issue #2740 fallback.

function resolveRgCellValue(row, colName, fr, to, panelId) {
    var itemName = dashRowLookupName(row)
        , rowLabel = (dashItems[row.id] && dashItems[row.id].label) || ''
        , v = dashGetVal(itemName + ':' + colName, fr, to, rowLabel, panelId);
    if (v !== undefined) return v;
    if (dashFormulas[row.id]) {
        if (dashFormulas[row.id] === '[]') {
            v = dashGetVal(itemName, fr, to, rowLabel, panelId);
            if (v !== undefined) return v;
        } else if (itemRegex.test(dashFormulas[row.id])) {
            var aliasItem = dashFormulas[row.id].match(itemRegex)[1];
            v = dashGetVal(aliasItem + ':' + colName, fr, to, rowLabel, panelId);
            if (v) return v;
            v = dashGetVal(aliasItem, fr, to, rowLabel, panelId);
            if (v) return v;
            return '0';
        }
    }
    // Issue 2740 fallback: panel driven by panelQuery + row has no formula.
    if (v === undefined && !dashFormulas[row.id] && dashPanelValues[panelId]) {
        v = dashGetVal(itemName, fr, to, rowLabel, panelId);
        if (v !== undefined) return v;
    }
    return undefined;
}

function makeRow(id, itemName) {
    var attrs = { 'item-name': itemName };
    return {
        id: id,
        getAttribute: function(name) { return attrs[name]; }
    };
}

function ingestModelRow(itemID, item, opts) {
    opts = opts || {};
    dashItems[itemID] = {
        name: item,
        format: '',
        mu: '',
        label: opts.label || '',
        srcName: opts.srcName || ''
    };
}

function ingestPanelValue(panelKey, item, colGroup, entries) {
    var itemKey = (item || '').toLowerCase();
    var key = colGroup ? itemKey + ':' + colGroup.toLowerCase() : itemKey;
    if (!dashPanelValues[panelKey]) dashPanelValues[panelKey] = {};
    var bucket = dashPanelValues[panelKey];
    bucket[key] = (bucket[key] || []).concat(entries);
}

function reset() {
    dashItems = {};
    dashValues = {};
    dashPanelValues = {};
    dashFormulas = {};
}

// =========================================================================
// Test 1: panelQuery without RGcolumnsID — row picks up value by item name.
// =========================================================================
console.log('\nTest 1: panelQuery row without RGcolumnsID, no formula -> fallback to item name');
reset();
ingestModelRow('100', 'Выручка');
// Panel scoped values bucket keyed by itemKey only (no colGroup).
ingestPanelValue('fp1', 'Выручка', '', [
    { date: '20240101', val: '1234', 'Метка': '' }
]);
var row1 = makeRow('100', 'Выручка');
var v1 = resolveRgCellValue(row1, 'Факт', '20240101', '20241231', 'fp1');
assert(v1 === '1234', 'rg cell value comes from itemName-only bucket: ' + v1);

// =========================================================================
// Test 2: panelQuery with RGcolumnsID — direct match wins (regression).
// =========================================================================
console.log('\nTest 2: panelQuery row with matching RGcolumnsID -> uses item:col bucket');
reset();
ingestModelRow('101', 'Выручка');
ingestPanelValue('fp2', 'Выручка', 'Факт', [
    { date: '20240101', val: '500', 'Метка': '' }
]);
ingestPanelValue('fp2', 'Выручка', '', [
    { date: '20240101', val: '9999', 'Метка': '' }
]);
var row2 = makeRow('101', 'Выручка');
var v2 = resolveRgCellValue(row2, 'Факт', '20240101', '20241231', 'fp2');
assert(v2 === '500', 'item:col bucket takes precedence over plain item bucket: ' + v2);

// =========================================================================
// Test 3: panelQuery present + row has formula -> fallback NOT applied.
// =========================================================================
console.log('\nTest 3: row with formula -> fallback is bypassed');
reset();
ingestModelRow('102', 'Доход');
ingestPanelValue('fp3', 'Доход', '', [
    { date: '20240101', val: '777', 'Метка': '' }
]);
dashFormulas['102'] = '[Other Item]'; // alias formula, not matching anything
var row3 = makeRow('102', 'Доход');
var v3 = resolveRgCellValue(row3, 'Факт', '20240101', '20241231', 'fp3');
assert(v3 === '0', 'formula alias takes its own path (no item fallback): ' + v3);

// =========================================================================
// Test 4: no panelQuery -> fallback NOT applied (regular dashValues case).
// =========================================================================
console.log('\nTest 4: panel without panelQuery -> fallback is bypassed');
reset();
ingestModelRow('103', 'Выручка');
// dashValues only, no dashPanelValues at all.
dashValues['выручка'] = [{ date: '20240101', val: '111', 'Метка': '' }];
var row4 = makeRow('103', 'Выручка');
var v4 = resolveRgCellValue(row4, 'Факт', '20240101', '20241231', 'fp4');
assert(v4 === undefined,
    'plain dashValues panels keep prior behaviour (cell stays empty): ' + v4);

// =========================================================================
// Test 5: itemSrcName overrides item-name for the fallback lookup.
// =========================================================================
console.log('\nTest 5: itemSrcName drives the fallback key');
reset();
ingestModelRow('104', 'Прибыль чистая', { srcName: 'Net Profit' });
ingestPanelValue('fp5', 'Net Profit', '', [
    { date: '20240101', val: '88', 'Метка': '' }
]);
// On purpose: nothing stored under the visible name.
var row5 = makeRow('104', 'Прибыль чистая');
var v5 = resolveRgCellValue(row5, 'Факт', '20240101', '20241231', 'fp5');
assert(v5 === '88', 'fallback key prefers itemSrcName over item-name: ' + v5);

// =========================================================================
// Test 6: Метка filter on the fallback path.
// =========================================================================
console.log('\nTest 6: row label (Метка) filters the fallback bucket');
reset();
ingestModelRow('105', 'Выручка', { label: 'поступление' });
ingestPanelValue('fp6', 'Выручка', '', [
    { date: '20240101', val: '10', 'Метка': 'поступление' },
    { date: '20240101', val: '99', 'Метка': 'маржинальная' }
]);
var row6 = makeRow('105', 'Выручка');
var v6 = resolveRgCellValue(row6, 'Факт', '20240101', '20241231', 'fp6');
assert(v6 === '10', 'only entries with matching Метка contribute: ' + v6);

// =========================================================================
// Test 7: empty panel bucket exists but row not found -> still undefined.
// =========================================================================
console.log('\nTest 7: panelQuery present, row name absent -> undefined');
reset();
ingestModelRow('106', 'Расходы');
dashPanelValues['fp7'] = {}; // panel-query bucket exists, but no Расходы entry
var row7 = makeRow('106', 'Расходы');
var v7 = resolveRgCellValue(row7, 'Факт', '20240101', '20241231', 'fp7');
assert(v7 === undefined, 'missing item in bucket stays undefined: ' + v7);

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
