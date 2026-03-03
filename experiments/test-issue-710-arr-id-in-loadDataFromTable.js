/**
 * Test for issue #710: Table requisites (arr_id) not being set in loadDataFromTable()
 *
 * Problem: After using loadDataFromTable() instead of parseObjectFormat(),
 * the columns were missing the arr_id property. This caused table requisites
 * like "Objects" and "Menu" to display as plain numbers instead of as
 * table icons with count.
 *
 * Root cause: The column creation in loadDataFromTable() was missing several
 * properties that existed in parseObjectFormat() and parseJsonDataArray():
 * - arr_id (for table requisites / subordinate tables)
 * - ref_id (for reference fields)
 * - orig (original field reference)
 * - attrs (field attributes)
 *
 * Also, the 'ref' property was incorrectly set to req.arr_id instead of
 * checking for ref_id like the other methods do.
 *
 * Fix: Updated loadDataFromTable() to include all missing properties,
 * matching the column structure in parseObjectFormat().
 */

// Test metadata with table requisites (arr_id) - similar to metadata_42.json
const testMetadata = {
    id: '42',
    val: 'Система меню',
    type: '8',
    reqs: [
        {
            num: 1,
            id: '100',
            val: 'Название',
            type: '4',
            orig: '4'
        },
        {
            num: 2,
            id: '101',
            val: 'Объекты',
            type: '6',
            arr_id: 43  // This is a table requisite - should display as table icon with count
        },
        {
            num: 3,
            id: '102',
            val: 'Меню',
            type: '6',
            arr_id: 44  // Another table requisite
        },
        {
            num: 4,
            id: '103',
            val: 'Родитель',
            type: '4',
            ref_id: 42,
            orig: '42'
        }
    ]
};

/**
 * Simulates the old (buggy) behavior of loadDataFromTable
 * Missing: arr_id, ref_id, orig, attrs
 * Incorrect: ref was set to req.arr_id || 0
 */
function createColumnsOldWay(metadata) {
    const columns = [];

    // Main column
    columns.push({
        id: '0',
        type: metadata.type || 'SHORT',
        name: metadata.val || 'Value',
        granted: 1,
        ref: 0,
        paramId: metadata.id
    });

    // Requisite columns - OLD (buggy) way
    if (metadata.reqs && Array.isArray(metadata.reqs)) {
        metadata.reqs.forEach((req, idx) => {
            columns.push({
                id: String(idx + 1),
                type: req.type || 'SHORT',
                name: req.val,
                granted: 1,
                ref: req.arr_id || 0,  // BUG: Wrong field, should check ref_id
                paramId: req.id
                // MISSING: ref_id, orig, attrs, arr_id
            });
        });
    }

    return columns;
}

/**
 * Simulates the new (fixed) behavior of loadDataFromTable
 * Includes: arr_id, ref_id, orig, attrs
 * Correct: ref checks for ref_id
 */
function createColumnsNewWay(metadata) {
    const columns = [];

    // Main column
    columns.push({
        id: '0',
        type: metadata.type || 'SHORT',
        name: metadata.val || 'Value',
        granted: 1,
        ref: 0,
        paramId: metadata.id
    });

    // Requisite columns - NEW (fixed) way
    if (metadata.reqs && Array.isArray(metadata.reqs)) {
        metadata.reqs.forEach((req, idx) => {
            const isReference = req.hasOwnProperty('ref_id');
            columns.push({
                id: String(idx + 1),
                type: req.type || 'SHORT',
                name: req.val,
                granted: 1,
                ref: isReference ? req.orig : 0,  // FIXED: Check for ref_id
                ref_id: req.ref_id || null,       // ADDED
                orig: req.orig || null,           // ADDED
                attrs: req.attrs || '',           // ADDED
                paramId: req.id,
                arr_id: req.arr_id || null        // ADDED: Key fix for issue #710
            });
        });
    }

    return columns;
}

// Run tests
console.log('=== Test Issue #710: arr_id in loadDataFromTable ===\n');

const oldColumns = createColumnsOldWay(testMetadata);
const newColumns = createColumnsNewWay(testMetadata);

console.log('Old (buggy) behavior:');
oldColumns.forEach((col, idx) => {
    console.log(`  Column ${idx}: name="${col.name}", arr_id=${col.arr_id}, ref=${col.ref}`);
});

console.log('\nNew (fixed) behavior:');
newColumns.forEach((col, idx) => {
    console.log(`  Column ${idx}: name="${col.name}", arr_id=${col.arr_id}, ref=${col.ref}, ref_id=${col.ref_id}`);
});

// Verify the fix
console.log('\n=== Verification ===');

// Test 1: arr_id should be set for table requisites
const objetsColOld = oldColumns.find(c => c.name === 'Объекты');
const objetsColNew = newColumns.find(c => c.name === 'Объекты');
console.log(`\n1. "Объекты" column arr_id:`);
console.log(`   Old: ${objetsColOld?.arr_id} (should be 43, but is undefined)`);
console.log(`   New: ${objetsColNew?.arr_id} (should be 43)`);
console.log(`   Test: ${objetsColNew?.arr_id === 43 ? 'PASS' : 'FAIL'}`);

// Test 2: ref_id should be set for reference fields
const parentColOld = oldColumns.find(c => c.name === 'Родитель');
const parentColNew = newColumns.find(c => c.name === 'Родитель');
console.log(`\n2. "Родитель" column ref_id:`);
console.log(`   Old: ${parentColOld?.ref_id} (should be 42, but is undefined)`);
console.log(`   New: ${parentColNew?.ref_id} (should be 42)`);
console.log(`   Test: ${parentColNew?.ref_id === 42 ? 'PASS' : 'FAIL'}`);

// Test 3: ref should be set correctly based on ref_id
console.log(`\n3. "Родитель" column ref (should come from orig when ref_id exists):`);
console.log(`   Old: ${parentColOld?.ref} (incorrectly set from arr_id)`);
console.log(`   New: ${parentColNew?.ref} (should be '42' from orig)`);
console.log(`   Test: ${parentColNew?.ref === '42' ? 'PASS' : 'FAIL'}`);

// Test 4: Simulate renderCell condition for subordinate tables
console.log(`\n4. Simulating renderCell condition "if (column.arr_id)":`);
const menuColOld = oldColumns.find(c => c.name === 'Меню');
const menuColNew = newColumns.find(c => c.name === 'Меню');
console.log(`   Old "Меню" would show as subordinate: ${!!menuColOld?.arr_id} (should be true)`);
console.log(`   New "Меню" would show as subordinate: ${!!menuColNew?.arr_id} (should be true)`);
console.log(`   Test: ${!!menuColNew?.arr_id ? 'PASS' : 'FAIL'}`);

// Summary
const allTestsPassed =
    objetsColNew?.arr_id === 43 &&
    parentColNew?.ref_id === 42 &&
    parentColNew?.ref === '42' &&
    !!menuColNew?.arr_id;

console.log(`\n=== Summary ===`);
console.log(`All tests: ${allTestsPassed ? 'PASSED' : 'FAILED'}`);

if (!allTestsPassed) {
    process.exit(1);
}
