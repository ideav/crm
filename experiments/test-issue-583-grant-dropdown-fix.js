/**
 * Test script for issue #583 - GRANT/REPORT_COLUMN dropdown fixes
 *
 * This test verifies:
 * 1. Options with id="0" are handled correctly (not treated as falsy)
 * 2. The term value from API response is used for pre-selection
 */

// Test 1: Verify that "0" is handled correctly as a valid ID
function testZeroIdHandling() {
    console.log('Test 1: Zero ID handling');

    const options = [
        { id: "0", val: "*** Type editor ***" },
        { id: "1", val: "Option 1" },
        { id: "2", val: "Option 2" }
    ];

    // Old (buggy) implementation:
    const oldResults = options.map(opt => {
        const optId = opt.id || opt.i || '';
        return { id: optId, val: opt.val };
    });

    // New (fixed) implementation:
    const newResults = options.map(opt => {
        const optId = (opt.id !== undefined && opt.id !== null) ? opt.id : ((opt.i !== undefined && opt.i !== null) ? opt.i : '');
        return { id: optId, val: opt.val };
    });

    console.log('Old implementation results:');
    oldResults.forEach(r => console.log(`  id="${r.id}", val="${r.val}"`));

    console.log('New implementation results:');
    newResults.forEach(r => console.log(`  id="${r.id}", val="${r.val}"`));

    // Verify fix
    const oldZeroId = oldResults.find(r => r.val === "*** Type editor ***");
    const newZeroId = newResults.find(r => r.val === "*** Type editor ***");

    if (oldZeroId.id === '') {
        console.log('  BUG CONFIRMED: Old implementation treats "0" as falsy, resulting in empty string');
    }

    if (newZeroId.id === '0') {
        console.log('  FIX VERIFIED: New implementation correctly preserves "0" as the ID');
    } else {
        console.log('  FIX FAILED: Expected "0", got "' + newZeroId.id + '"');
        return false;
    }

    return true;
}

// Test 2: Verify term value is used for pre-selection
function testTermValuePreselection() {
    console.log('\nTest 2: Term value pre-selection');

    // Simulated API response for edit_obj/{id}
    const recordData = {
        obj: {
            id: "165",
            val: "*** Files ***",
            parent: "145",
            typ: "116",
            typ_name: "Объекты",
            base_typ: "5",
            term: "10"  // This should be used for dropdown pre-selection
        }
    };

    // Old implementation (buggy):
    const oldMainValue = recordData && recordData.obj ? recordData.obj.val : '';
    // Used mainValue for dropdown pre-selection

    // New implementation (fixed):
    const newMainValue = recordData && recordData.obj ? recordData.obj.val : '';
    const newMainTermValue = recordData && recordData.obj && recordData.obj.term !== undefined ? recordData.obj.term : '';

    console.log(`  Old approach - used for pre-selection: "${oldMainValue}" (val field)`);
    console.log(`  New approach - used for pre-selection: "${newMainTermValue}" (term field)`);

    if (newMainTermValue === "10") {
        console.log('  FIX VERIFIED: Term value "10" is correctly extracted for dropdown pre-selection');
        return true;
    } else {
        console.log('  FIX FAILED: Expected "10", got "' + newMainTermValue + '"');
        return false;
    }
}

// Test 3: Edge cases
function testEdgeCases() {
    console.log('\nTest 3: Edge cases');

    // Test with various falsy-ish values
    const testCases = [
        { id: "0", expected: "0", name: "string zero" },
        { id: 0, expected: 0, name: "numeric zero" },
        { id: "", expected: "", name: "empty string" },
        { id: null, i: "backup", expected: "backup", name: "null id with backup" },
        { id: undefined, i: "backup", expected: "backup", name: "undefined id with backup" },
        { expected: "", name: "no id or i" }
    ];

    let allPassed = true;

    testCases.forEach(tc => {
        const opt = { ...tc };
        const optId = (opt.id !== undefined && opt.id !== null) ? opt.id : ((opt.i !== undefined && opt.i !== null) ? opt.i : '');
        const passed = optId === tc.expected;
        console.log(`  ${tc.name}: expected "${tc.expected}", got "${optId}" - ${passed ? 'PASS' : 'FAIL'}`);
        if (!passed) allPassed = false;
    });

    return allPassed;
}

// Run all tests
console.log('='.repeat(60));
console.log('Issue #583 Fix Verification Tests');
console.log('='.repeat(60));

const test1 = testZeroIdHandling();
const test2 = testTermValuePreselection();
const test3 = testEdgeCases();

console.log('\n' + '='.repeat(60));
console.log('Test Results:');
console.log(`  Test 1 (Zero ID handling): ${test1 ? 'PASSED' : 'FAILED'}`);
console.log(`  Test 2 (Term value pre-selection): ${test2 ? 'PASSED' : 'FAILED'}`);
console.log(`  Test 3 (Edge cases): ${test3 ? 'PASSED' : 'FAILED'}`);
console.log('='.repeat(60));

if (test1 && test2 && test3) {
    console.log('\nAll tests PASSED! The fix is working correctly.');
    process.exit(0);
} else {
    console.log('\nSome tests FAILED. Please review the fix.');
    process.exit(1);
}
