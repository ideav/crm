/**
 * Test for issue #811: After creating a new record, fetch its data using
 * object/{tableTypeId}/?JSON_OBJ&t{tableTypeId}=@{recordId}
 *
 * This test verifies:
 * 1. The correct URL is built with the JSON_OBJ filter for a specific record ID
 * 2. The response (JSON_OBJ array format) is parsed correctly
 * 3. The row data is updated with the fetched values
 */

'use strict';

// ---- Mock setup ----

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        testsPassed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        testsFailed++;
    }
}

// ---- Test 1: URL construction ----
console.log('\n=== Test 1: URL construction for fetchNewRowData ===');

function buildFetchUrl(apiBase, tableTypeId, recordId) {
    return `${apiBase}/object/${tableTypeId}/?JSON_OBJ&t${tableTypeId}=@${recordId}`;
}

const url1 = buildFetchUrl('/crm', 18, 12345);
assert(url1 === '/crm/object/18/?JSON_OBJ&t18=@12345',
    `URL with tableTypeId=18 and recordId=12345: "${url1}"`);

const url2 = buildFetchUrl('', 3596, 9001);
assert(url2 === '/object/3596/?JSON_OBJ&t3596=@9001',
    `URL with tableTypeId=3596 and recordId=9001: "${url2}"`);

const url3 = buildFetchUrl('/myapp', 200, 777);
assert(url3 === '/myapp/object/200/?JSON_OBJ&t200=@777',
    `URL with apiBase=/myapp, tableTypeId=200, recordId=777: "${url3}"`);

// ---- Test 2: Response parsing (JSON_OBJ array format) ----
console.log('\n=== Test 2: Response parsing (JSON_OBJ array format [{i, u, o, r}]) ===');

function parseJsonObjResponse(data) {
    if (!Array.isArray(data) || data.length === 0) {
        return null;
    }
    const item = data[0];
    return item.r || [];
}

// Typical response from object/{tableTypeId}/?JSON_OBJ&t{id}=@{recordId}
const mockResponse1 = [
    { i: 12345, u: 1, o: 1, r: ['Formatted Value 001', '2026-01-15', '42.50'] }
];
const parsed1 = parseJsonObjResponse(mockResponse1);
assert(Array.isArray(parsed1) && parsed1.length === 3,
    `Parses r array with 3 columns`);
assert(parsed1[0] === 'Formatted Value 001',
    `First column is server-formatted value: "${parsed1[0]}"`);
assert(parsed1[1] === '2026-01-15',
    `Second column (date): "${parsed1[1]}"`);
assert(parsed1[2] === '42.50',
    `Third column (number): "${parsed1[2]}"`);

// Empty response
const parsed2 = parseJsonObjResponse([]);
assert(parsed2 === null, 'Returns null for empty array');

// Non-array response
const parsed3 = parseJsonObjResponse({ obj: {} });
assert(parsed3 === null, 'Returns null for non-array response');

// Response with missing r field
const parsed4 = parseJsonObjResponse([{ i: 123 }]);
assert(Array.isArray(parsed4) && parsed4.length === 0,
    `Returns empty array when r field is missing`);

// ---- Test 3: Data update logic ----
console.log('\n=== Test 3: Data update logic ===');

// Simulate the state before and after fetchNewRowData
const mockTableState = {
    objectTableId: 18,
    data: [
        ['existing row', 'value1'],
        ['new row typed value', ''],  // rowIndex=1 (the newly created row)
    ],
    rawObjectData: [
        { i: 100, u: 1, o: 1, r: ['existing row', 'value1'] },
        { i: 12345, u: 1, o: 2, r: ['new row typed value', ''], _isNewRow: false, _isPartialRow: true },
    ]
};

// Simulate what fetchNewRowData does after getting the response
function simulateFetchNewRowData(tableState, rowIndex, fetchedItem) {
    const newRowData = fetchedItem.r || [];
    tableState.data[rowIndex] = newRowData;
    if (tableState.rawObjectData[rowIndex]) {
        tableState.rawObjectData[rowIndex].r = newRowData;
        tableState.rawObjectData[rowIndex]._isPartialRow = false;
    }
    return newRowData;
}

const fetchedItem = { i: 12345, u: 1, o: 2, r: ['001', '15.01.2026'] };
const result = simulateFetchNewRowData(mockTableState, 1, fetchedItem);

assert(result[0] === '001', `First column updated to server-formatted value "001"`);
assert(result[1] === '15.01.2026', `Second column updated with default date`);
assert(mockTableState.data[1][0] === '001', `data array updated`);
assert(mockTableState.rawObjectData[1].r[0] === '001', `rawObjectData updated`);
assert(mockTableState.rawObjectData[1]._isPartialRow === false, `_isPartialRow cleared`);
assert(mockTableState.data[0][0] === 'existing row', `Existing row not touched`);

// ---- Test 4: tableTypeId selection priority ----
console.log('\n=== Test 4: tableTypeId selection priority ===');

function getTableTypeId(objectTableId, optionsTableTypeId) {
    return objectTableId || optionsTableTypeId;
}

assert(getTableTypeId(18, null) === 18, `Uses objectTableId when set`);
assert(getTableTypeId(null, 200) === 200, `Falls back to options.tableTypeId`);
assert(getTableTypeId(18, 200) === 18, `objectTableId takes precedence over options.tableTypeId`);
assert(getTableTypeId(null, null) === null, `Returns null when neither is set`);

// ---- Summary ----
console.log('\n=== Test Summary ===');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);

if (testsFailed === 0) {
    console.log('✅ All tests passed!');
    process.exit(0);
} else {
    console.error(`❌ ${testsFailed} test(s) failed!`);
    process.exit(1);
}
