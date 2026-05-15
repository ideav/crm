// Test for issue #2687.
//
// Дэшборд rows are joined into the DOM by (item + level): a second row with
// the same item/level as a previous row is treated as a duplicate. Only the
// *first* row's itemID becomes the DOM row's id — subsequent dashItems
// entries (keyed by their own itemID) never get read by dashRowLookupName.
//
// When itemSrcName is set on the duplicate row but not on the first, the
// fix introduced in #2682 didn't kick in: dashRowLookupName(row) returned
// dashItems[firstID].srcName, which was empty, and the lookup fell back to
// the visible item-name — missing the panelQuery data keyed under "Сальдо".
//
// This test simulates the dashGetModel ingestion loop the fix lives in and
// verifies that itemSrcName from any duplicate row is propagated onto the
// visible row's dashItems entry (so a later dashRowLookupName picks it up).

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passed++; }
    else { console.error('  FAIL: ' + msg); failed++; }
}

// ─── Minimal stand-ins for dashItems + dashRowLookupName ────────────────

let dashItems = {};

function dashRowLookupName(row) {
    if (!row) return '';
    var meta = dashItems[row.id];
    return (meta && meta.srcName) || row.getAttribute('item-name') || '';
}

function dashIsDuplicateModelRow(previousRow, row) {
    if (!previousRow || !row || !row.itemID) return false;
    if (previousRow.panelID && row.panelID && String(previousRow.panelID) !== String(row.panelID)) return false;
    if (String(previousRow.itemID || '') === String(row.itemID || '')) return false;
    return String(previousRow.item || '') === String(row.item || '')
        && String(previousRow.level || 1) === String(row.level || 1);
}

// ─── Subset of dashGetModel's row-processing loop, including the new fix
// from #2687. Returns the synthesized DOM rows (mirroring what would be
// added to the panel's tbody) keyed by their id.

function processModel(json) {
    var lastVisibleItemByPanel = {};
    var domRows = {};
    dashItems = {};

    // First pass: dashItems entries per itemID (mirrors the loop at the top
    // of dashGetModel).
    json.forEach(function(row) {
        dashItems[row.itemID] = {
            name: row.item,
            label: row['Метка'] || '',
            srcName: row.itemSrcName || ''
        };
    });

    // Second pass: identify duplicates, build DOM rows, apply the #2687 fix.
    json.forEach(function(row) {
        var panelKey = 'fp' + row.panelID;
        var previousItem = lastVisibleItemByPanel[panelKey];
        var isDuplicateRow = dashIsDuplicateModelRow(previousItem, row);
        var itemTargetId = isDuplicateRow ? previousItem.itemID : row.itemID;

        // The fix under test:
        if (row.itemSrcName && dashItems[itemTargetId] && !dashItems[itemTargetId].srcName)
            dashItems[itemTargetId].srcName = row.itemSrcName;

        if (row.itemID && !isDuplicateRow && !domRows[row.itemID]) {
            domRows[row.itemID] = {
                id: row.itemID,
                _attrs: { 'item-name': row.item },
                getAttribute: function(name) { return this._attrs[name]; }
            };
        }
        if (row.itemID && !isDuplicateRow) {
            lastVisibleItemByPanel[panelKey] = {
                panelID: row.panelID,
                itemID: row.itemID,
                item: row.item,
                level: row.level || 1
            };
        }
    });
    return domRows;
}

// =========================================================================
// Test 1: bug repro — first row has no itemSrcName, second does.
// =========================================================================
console.log('\nTest 1: itemSrcName carried by a duplicate row reaches the DOM row');
var json = [
    // First row owns the DOM id "A1", no itemSrcName.
    { panelID: '2069', itemID: 'A1', item: 'сальдо на конец периода', level: 1, RGcolumns: 'Факт' },
    // Duplicate of the first row, this one has itemSrcName.
    { panelID: '2069', itemID: '2096', item: 'сальдо на конец периода', level: 1, RGcolumns: 'План', itemSrcName: 'Сальдо' }
];
var rows = processModel(json);
assert(Object.keys(rows).length === 1, 'one DOM row created (duplicate skipped): ' + Object.keys(rows));
assert(rows['A1'], 'DOM row id is the first occurrence (A1)');
assert(dashItems['A1'].srcName === 'Сальдо',
    'dashItems[A1].srcName was filled from the duplicate row: ' + dashItems['A1'].srcName);
assert(dashRowLookupName(rows['A1']) === 'Сальдо',
    'dashRowLookupName flips to "Сальдо" on the visible row');

// =========================================================================
// Test 2: first row already has itemSrcName — don't get overwritten by a
// later duplicate that lacks one.
// =========================================================================
console.log('\nTest 2: first row\'s itemSrcName survives a later empty duplicate');
json = [
    { panelID: '2069', itemID: 'A1', item: 'сальдо на конец периода', level: 1, RGcolumns: 'План', itemSrcName: 'Сальдо' },
    { panelID: '2069', itemID: '2096', item: 'сальдо на конец периода', level: 1, RGcolumns: 'Факт' }
];
rows = processModel(json);
assert(dashItems['A1'].srcName === 'Сальдо',
    'first row\'s srcName preserved: ' + dashItems['A1'].srcName);
assert(dashRowLookupName(rows['A1']) === 'Сальдо',
    'lookup name remains "Сальдо"');

// =========================================================================
// Test 3: both duplicates have the SAME itemSrcName (the common case) —
// works exactly as before, the second value doesn't clobber the first.
// =========================================================================
console.log('\nTest 3: both duplicates carry the same itemSrcName');
json = [
    { panelID: '2069', itemID: 'A1', item: 'сальдо на конец периода', level: 1, RGcolumns: 'План', itemSrcName: 'Сальдо' },
    { panelID: '2069', itemID: '2096', item: 'сальдо на конец периода', level: 1, RGcolumns: 'Факт', itemSrcName: 'Сальдо' }
];
rows = processModel(json);
assert(dashItems['A1'].srcName === 'Сальдо', 'A1 has "Сальдо"');
assert(dashRowLookupName(rows['A1']) === 'Сальдо', 'lookup returns "Сальдо"');

// =========================================================================
// Test 4: no duplicates at all — fix is a no-op for a normal row.
// =========================================================================
console.log('\nTest 4: lone non-duplicate row works unchanged');
json = [
    { panelID: '2069', itemID: '2096', item: 'сальдо на конец периода', level: 1, RGcolumns: 'План', itemSrcName: 'Сальдо' }
];
rows = processModel(json);
assert(rows['2096'], 'DOM row uses the row\'s own itemID (2096)');
assert(dashItems['2096'].srcName === 'Сальдо', 'its own srcName is intact');
assert(dashRowLookupName(rows['2096']) === 'Сальдо', 'lookup returns "Сальдо"');

// =========================================================================
// Test 5: three duplicates — second is empty, third carries srcName. Visible
// row still picks up "Сальдо".
// =========================================================================
console.log('\nTest 5: srcName arrives on the third duplicate');
json = [
    { panelID: '2069', itemID: 'A1', item: 'сальдо на конец периода', level: 1, RGcolumns: 'Факт' },
    { panelID: '2069', itemID: 'A2', item: 'сальдо на конец периода', level: 1, RGcolumns: 'План' },
    { panelID: '2069', itemID: '2096', item: 'сальдо на конец периода', level: 1, RGcolumns: 'Прогноз', itemSrcName: 'Сальдо' }
];
rows = processModel(json);
assert(rows['A1'], 'DOM row is the first occurrence (A1)');
assert(dashItems['A1'].srcName === 'Сальдо',
    'srcName propagated even from the third row: ' + dashItems['A1'].srcName);

// =========================================================================
// Test 6: different items — never confused with each other.
// =========================================================================
console.log('\nTest 6: different items keep their own srcName');
json = [
    { panelID: '2069', itemID: 'X1', item: 'Выручка', level: 1, itemSrcName: 'Revenue' },
    { panelID: '2069', itemID: 'Y1', item: 'Прибыль', level: 1, itemSrcName: 'Profit' }
];
rows = processModel(json);
assert(dashItems['X1'].srcName === 'Revenue', 'X1 → Revenue');
assert(dashItems['Y1'].srcName === 'Profit', 'Y1 → Profit');

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
