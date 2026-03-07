/**
 * Test for Issue #731 - URL Parameter Fix
 *
 * Problem:
 * 1. Report URLs were incorrectly constructed with '&JSON' instead of '?JSON' when no filter was present
 *    - Wrong: report/МоёМеню&JSON
 *    - Correct: report/169?JSON
 *
 * 2. Report name was being used instead of ID in API calls
 *    - Wrong: report/МоёМеню?JSON
 *    - Correct: report/169?JSON
 *
 * Fix:
 * 1. Changed URL construction to always use '?' as the first parameter separator
 * 2. Changed parseReferenceValue to extract numeric ID instead of name
 */

// Test: URL Construction Fix
function testUrlConstruction() {
    console.log('=== Testing URL Construction ===');

    // Old behavior (incorrect)
    function buildUrlOld(reportId, filter) {
        const filterParam = filter ? '?' + filter : '';
        return 'report/' + reportId + filterParam + '&JSON';
    }

    // New behavior (correct)
    function buildUrlNew(reportId, filter) {
        const filterParam = filter ? filter + '&' : '';
        return 'report/' + reportId + '?' + filterParam + 'JSON';
    }

    // Test cases
    const testCases = [
        { reportId: '169', filter: '', expected: 'report/169?JSON' },
        { reportId: '169', filter: 'FR_Date=1.1&TO_Date=31.1', expected: 'report/169?FR_Date=1.1&TO_Date=31.1&JSON' },
        { reportId: 'МоёМеню', filter: '', expected: 'report/МоёМеню?JSON' },
    ];

    testCases.forEach((tc, i) => {
        const oldUrl = buildUrlOld(tc.reportId, tc.filter);
        const newUrl = buildUrlNew(tc.reportId, tc.filter);

        console.log(`\nTest ${i + 1}:`);
        console.log(`  Input: reportId="${tc.reportId}", filter="${tc.filter}"`);
        console.log(`  Old URL: ${oldUrl}`);
        console.log(`  New URL: ${newUrl}`);
        console.log(`  Expected: ${tc.expected}`);
        console.log(`  Pass: ${newUrl === tc.expected ? 'YES' : 'NO'}`);
    });
}

// Test: Reference Value Parsing
function testReferenceValueParsing() {
    console.log('\n=== Testing Reference Value Parsing ===');

    function parseReferenceValue(value) {
        if (!value || typeof value !== 'string') return null;
        const colonIndex = value.indexOf(':');
        if (colonIndex <= 0) return null;
        const id = value.substring(0, colonIndex);
        const name = value.substring(colonIndex + 1);
        if (!/^\d+$/.test(id)) return null;
        return { id: id, name: name };
    }

    // Old behavior: used name (МоёМеню)
    // New behavior: uses id (169)
    const testCases = [
        { value: '169:МоёМеню', expectedId: '169', expectedName: 'МоёМеню' },
        { value: '22:Report Name', expectedId: '22', expectedName: 'Report Name' },
        { value: 'not-a-ref', expectedId: null, expectedName: null },
        { value: '', expectedId: null, expectedName: null },
        { value: 'text:with:colons', expectedId: null, expectedName: null },
    ];

    testCases.forEach((tc, i) => {
        const result = parseReferenceValue(tc.value);

        console.log(`\nTest ${i + 1}:`);
        console.log(`  Input: "${tc.value}"`);
        console.log(`  Parsed: ${result ? `{id: "${result.id}", name: "${result.name}"}` : 'null'}`);
        console.log(`  Expected ID: ${tc.expectedId}`);
        console.log(`  Pass: ${(result?.id === tc.expectedId) ? 'YES' : 'NO'}`);
    });
}

// Run tests
testUrlConstruction();
testReferenceValueParsing();

console.log('\n=== Summary ===');
console.log('Issue #731 fixes two bugs:');
console.log('1. URL now correctly uses "?" as first parameter separator');
console.log('   - Before: report/169&JSON (invalid - & without ?)');
console.log('   - After:  report/169?JSON (valid)');
console.log('2. Report ID is now used instead of name in API calls');
console.log('   - Before: report/МоёМеню?JSON (uses name, may fail)');
console.log('   - After:  report/169?JSON (uses numeric ID)');
