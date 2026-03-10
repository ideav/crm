/**
 * Test for issue #777: saveReferenceEdit uses _m_set instead of _m_save for first column
 * when data source is "table" (not object format).
 *
 * Root cause: In determineParentRecord(), isFirstColumn was computed as:
 *   colId === String(this.objectTableId)
 *
 * For table data source: column.id = '0' (sequential), paramId = tableId.
 * So colId = '0', but objectTableId = '18'. => isFirstColumn = false (WRONG).
 *
 * For object format data source: column.id = String(tableId), paramId = tableId.
 * So colId = '18' = objectTableId. => isFirstColumn = true (correct).
 *
 * Fix: Use colType instead of colId, since colType = paramId = tableId for both cases.
 */

// Simulates determineParentRecord logic for testing

function simulateDetermineParentRecord_OLD(colId, colType, objectTableId) {
    const isFirstColumn = colId === String(objectTableId);
    return { isFirstColumn };
}

function simulateDetermineParentRecord_FIXED(colId, colType, objectTableId) {
    // Fixed: use colType (= paramId) instead of colId
    const isFirstColumn = colType === String(objectTableId);
    return { isFirstColumn };
}

// Test cases
const testCases = [
    {
        name: 'Table data source (issue #777) - first column',
        colId: '0',         // column.id = sequential index for table source
        colType: '18',      // colType = paramId = table ID
        objectTableId: 18,
        expectedIsFirstColumn: true
    },
    {
        name: 'Table data source - requisite column',
        colId: '1',         // column.id = sequential index
        colType: '3597',    // colType = paramId = req.id
        objectTableId: 18,
        expectedIsFirstColumn: false
    },
    {
        name: 'Object format data source - first column',
        colId: '18',        // column.id = tableId for object format
        colType: '18',      // colType = paramId = tableId
        objectTableId: 18,
        expectedIsFirstColumn: true
    },
    {
        name: 'Object format data source - requisite column',
        colId: '3597',      // column.id = req.id for object format
        colType: '3597',    // colType = paramId = req.id
        objectTableId: 18,
        expectedIsFirstColumn: false
    },
];

console.log('=== Issue #777: isFirstColumn determination ===\n');

let allPassed = true;
for (const tc of testCases) {
    const oldResult = simulateDetermineParentRecord_OLD(tc.colId, tc.colType, tc.objectTableId);
    const fixedResult = simulateDetermineParentRecord_FIXED(tc.colId, tc.colType, tc.objectTableId);

    const oldCorrect = oldResult.isFirstColumn === tc.expectedIsFirstColumn;
    const fixedCorrect = fixedResult.isFirstColumn === tc.expectedIsFirstColumn;

    const status = fixedCorrect ? 'PASS' : 'FAIL';
    if (!fixedCorrect) allPassed = false;

    console.log(`Test: ${tc.name}`);
    console.log(`  colId=${tc.colId}, colType=${tc.colType}, objectTableId=${tc.objectTableId}`);
    console.log(`  Expected isFirstColumn: ${tc.expectedIsFirstColumn}`);
    console.log(`  OLD result: ${oldResult.isFirstColumn} (${oldCorrect ? 'correct' : 'WRONG - this caused the bug'})`);
    console.log(`  FIXED result: ${fixedResult.isFirstColumn} (${fixedCorrect ? 'correct' : 'WRONG'})`);
    console.log(`  Status: ${status}`);
    console.log('');
}

console.log(`=== Summary: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} ===`);

// Simulate what save URL would be used
console.log('\n=== URL selection simulation (what saveReferenceEdit uses) ===\n');

function getSaveUrl(isFirstColumn, parentRecordId, apiBase = '/ru2') {
    return isFirstColumn
        ? `${apiBase}/_m_save/${parentRecordId}?JSON`
        : `${apiBase}/_m_set/${parentRecordId}?JSON`;
}

console.log('Issue #777 scenario: table/18, first cell (colId=0, colType=18):');
const oldInfo = simulateDetermineParentRecord_OLD('0', '18', 18);
const fixedInfo = simulateDetermineParentRecord_FIXED('0', '18', 18);
console.log(`  OLD URL: ${getSaveUrl(oldInfo.isFirstColumn, 449)} <- WRONG (uses _m_set)`);
console.log(`  FIXED URL: ${getSaveUrl(fixedInfo.isFirstColumn, 449)} <- CORRECT (uses _m_save)`);
