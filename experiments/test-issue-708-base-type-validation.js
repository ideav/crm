/**
 * Test for issue #708: Fix for edit form error when typeId is a base type
 *
 * Problem: When opening edit form, if typeId is a base type (2-17),
 * the API request /metadata/{typeId} returns "Invalid Term id {typeId}" error.
 *
 * Solution:
 * 1. Added isBaseType(typeId) helper method to check if typeId is a base type (2-17)
 * 2. In renderCell(), before showing edit icon, check if typeId is base type and fall back to objectTableId
 * 3. In openEditForm(), validate typeId and show error if it's a base type
 */

// Mock IntegramTable class with the fix
class IntegramTableMock {
    constructor() {
        this.objectTableId = 22; // Example: "Запрос" table
        this.options = { tableTypeId: null };
    }

    /**
     * Check if a type ID is a base (primitive) type (issue #708)
     * Base types (2-17) don't have metadata and cannot be used for edit forms
     * @param {string|number} typeId - Type ID to check
     * @returns {boolean} True if typeId is a base type
     */
    isBaseType(typeId) {
        const id = parseInt(typeId, 10);
        // Base types are IDs 2-17 (primitives like string, number, date, etc.)
        return !isNaN(id) && id >= 2 && id <= 17;
    }
}

// Test cases
function runTests() {
    const table = new IntegramTableMock();
    let passed = 0;
    let failed = 0;

    function test(name, result, expected) {
        if (result === expected) {
            console.log(`✓ ${name}`);
            passed++;
        } else {
            console.log(`✗ ${name}: expected ${expected}, got ${result}`);
            failed++;
        }
    }

    console.log('=== Testing isBaseType() method ===\n');

    // Test base types (should return true)
    test('isBaseType(2) - HTML', table.isBaseType(2), true);
    test('isBaseType(3) - Short string', table.isBaseType(3), true);
    test('isBaseType(4) - DateTime', table.isBaseType(4), true);
    test('isBaseType(5) - Grant', table.isBaseType(5), true);
    test('isBaseType(6) - Password', table.isBaseType(6), true);
    test('isBaseType(7) - Button', table.isBaseType(7), true);
    test('isBaseType(8) - Chars', table.isBaseType(8), true);
    test('isBaseType(9) - Date', table.isBaseType(9), true);
    test('isBaseType(10) - File', table.isBaseType(10), true);
    test('isBaseType(11) - Boolean', table.isBaseType(11), true);
    test('isBaseType(12) - Memo', table.isBaseType(12), true);
    test('isBaseType(13) - Integer', table.isBaseType(13), true);
    test('isBaseType(14) - Decimal', table.isBaseType(14), true);
    test('isBaseType(15) - Unknown base type', table.isBaseType(15), true);
    test('isBaseType(16) - Report column', table.isBaseType(16), true);
    test('isBaseType(17) - Path', table.isBaseType(17), true);

    // Test non-base types (should return false)
    test('isBaseType(1) - Below range', table.isBaseType(1), false);
    test('isBaseType(18) - First non-base type', table.isBaseType(18), false);
    test('isBaseType(22) - Запрос table type', table.isBaseType(22), false);
    test('isBaseType(100) - Large type ID', table.isBaseType(100), false);
    test('isBaseType(1000) - Very large type ID', table.isBaseType(1000), false);

    // Test string inputs
    test('isBaseType("3") - String base type', table.isBaseType("3"), true);
    test('isBaseType("22") - String non-base type', table.isBaseType("22"), false);

    // Test edge cases
    test('isBaseType(0) - Zero', table.isBaseType(0), false);
    test('isBaseType(-1) - Negative', table.isBaseType(-1), false);
    test('isBaseType("") - Empty string', table.isBaseType(""), false);
    test('isBaseType(null) - Null', table.isBaseType(null), false);
    test('isBaseType(undefined) - Undefined', table.isBaseType(undefined), false);
    test('isBaseType("abc") - Non-numeric string', table.isBaseType("abc"), false);

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

    // Test the fix scenario from the issue
    console.log('\n=== Testing the issue #708 scenario ===\n');

    // Scenario: Column has type=3 (base type), orig is undefined
    const column = { type: "3", orig: undefined };
    let typeId = column.orig || column.type || '';
    console.log(`Initial typeId from column: ${typeId}`);

    // Apply fix: if typeId is base type, fall back to objectTableId
    if (typeId && table.isBaseType(typeId)) {
        const fallbackTypeId = table.objectTableId;
        console.log(`typeId ${typeId} is a base type, falling back to objectTableId: ${fallbackTypeId}`);
        typeId = fallbackTypeId;
    }

    test('Fixed typeId should be objectTableId (22)', typeId, 22);
    test('Fixed typeId should not be a base type', table.isBaseType(typeId), false);

    return { passed, failed };
}

// Run tests
const results = runTests();
process.exit(results.failed > 0 ? 1 : 0);
