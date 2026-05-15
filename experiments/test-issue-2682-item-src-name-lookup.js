// Test: itemSrcName is used in place of item when looking up data in the
// query (issue #2682). The visible item-name on the row stays unchanged —
// only the lookup key flips to the alternative source name.

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passed++; }
    else { console.error('  FAIL: ' + msg); failed++; }
}

// ─── Minimal stubs mirroring dash.js shape ──────────────────────────────

let dashItems = {};
let dashValues = {};
let dashValueItemIds = {};

function dashGetFloat(v) {
    var f = parseFloat(String(v).replace(',', '.'));
    return isNaN(f) ? 0 : f;
}
function dashNormalizeVal(_item, val) {
    var v = val || '';
    if (typeof val === 'object' && val !== null) v = val[0].val;
    return String(v).replace(/ /g, '').replace(/,/g, '.');
}
function dashGetVal(item, fr, to) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item;
    if (!dashValues[key]) return;
    for (i in dashValues[key]) {
        if (!fr || (dashValues[key][i].date >= fr && dashValues[key][i].date <= to)) {
            valids = true;
            acc += dashGetFloat(dashValues[key][i].val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

// ─── The bit under test ─────────────────────────────────────────────────
// Copy of dashRowLookupName from js/dash.js. The whole point of the
// helper is to centralise the srcName ?? item-name decision.

function dashRowLookupName(row) {
    if (!row) return '';
    var meta = dashItems[row.id];
    return (meta && meta.srcName) || row.getAttribute('item-name') || '';
}

// Minimal row shim
function makeRow(id, itemName) {
    var attrs = { 'item-name': itemName };
    return {
        id: id,
        getAttribute: function(name) { return attrs[name]; }
    };
}

// Simulates what dashGetModel does when ingesting a Дэшборд row.
function ingestModelRow(itemID, item, itemSrcName) {
    dashItems[itemID] = {
        name: item,
        format: '',
        mu: '',
        label: '',
        srcName: itemSrcName || ''
    };
}

// Simulates dashGetSrc storing Дэшборд.ЗначенияЗаПериод rows. Source data
// is keyed by the source-side `item` field, lowercased.
function ingestSrcRow(item, value, valueItemID) {
    var key = (item || '').toLowerCase();
    dashValues[key] = value;
    if (valueItemID) dashValueItemIds[key] = valueItemID;
}

function reset() {
    dashItems = {};
    dashValues = {};
    dashValueItemIds = {};
}

// =========================================================================
// Test 1: srcName empty — falls back to the visible item-name (regression).
// =========================================================================
console.log('\nTest 1: itemSrcName empty -> use item-name attribute');
reset();
ingestModelRow('42', 'Выручка', '');
ingestSrcRow('Выручка', [{ date: '2024-01-01', val: '1000' }], 'V42');
var row = makeRow('42', 'Выручка');
var key = dashRowLookupName(row);
assert(key === 'Выручка', 'lookup key falls back to item-name: ' + key);
var v = dashGetVal(key, '2024-01-01', '2024-12-31');
assert(v === '1000', 'data is found via the fallback key: ' + v);
assert((dashValueItemIds[(key || '').toLowerCase()] || '') === 'V42',
    'valueItemId lookup uses the same fallback key');

// =========================================================================
// Test 2: srcName filled — overrides the visible item-name for lookups.
// =========================================================================
console.log('\nTest 2: itemSrcName filled -> lookups use the alternative name');
reset();
// Row displays as "Прибыль чистая" but source data is keyed by "Net Profit".
ingestModelRow('43', 'Прибыль чистая', 'Net Profit');
ingestSrcRow('Net Profit', [{ date: '2024-06-01', val: '500' }], 'V43');
// Note: no data is stored under the visible name on purpose.
ingestSrcRow('Прибыль чистая', [], '');
row = makeRow('43', 'Прибыль чистая');
key = dashRowLookupName(row);
assert(key === 'Net Profit',
    'lookup key prefers itemSrcName over item-name: ' + key);
v = dashGetVal(key, '2024-01-01', '2024-12-31');
assert(v === '500', 'data is found via the alternative key: ' + v);
assert(row.getAttribute('item-name') === 'Прибыль чистая',
    'the row\'s visible item-name is untouched (still "Прибыль чистая")');
assert((dashValueItemIds[(key || '').toLowerCase()] || '') === 'V43',
    'valueItemId lookup also flips to the alternative key');

// =========================================================================
// Test 3: row missing from dashItems — degrades to the visible item-name.
// =========================================================================
console.log('\nTest 3: dashItems missing entry -> use item-name attribute');
reset();
ingestSrcRow('Wage', [{ date: '2024-03-01', val: '7' }]);
row = makeRow('99', 'Wage');
key = dashRowLookupName(row);
assert(key === 'Wage', 'lookup key falls back to item-name when no metadata: ' + key);
v = dashGetVal(key);
assert(v === '7', 'data still resolves through the fallback path: ' + v);

// =========================================================================
// Test 4: null row — returns empty string, no crash.
// =========================================================================
console.log('\nTest 4: null row -> empty string');
assert(dashRowLookupName(null) === '', 'null row returns empty string');
assert(dashRowLookupName(undefined) === '', 'undefined row returns empty string');

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
