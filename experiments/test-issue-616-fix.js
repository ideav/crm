/**
 * Test for issue #616 fix: Pass F_U URL parameter as up in _m_new command
 *
 * Scenario:
 * When URL has F_U > 1, the _m_new command should use that value as the parent (up) parameter
 * instead of hardcoded 1.
 *
 * Example:
 * - URL: /database/table/123?F_U=456
 * - Expected _m_new URL: /_m_new/{typeId}?JSON&up=456
 */

// Test the parentId logic used in the fix
function testParentIdLogic() {
    console.log('Testing parentId logic for issue #616 fix:\n');

    const testCases = [
        // [options.parentId, expected up value]
        { parentId: null, expected: 1, description: 'No F_U in URL' },
        { parentId: undefined, expected: 1, description: 'F_U undefined' },
        { parentId: '1', expected: 1, description: 'F_U = 1 (root)' },
        { parentId: '0', expected: 1, description: 'F_U = 0' },
        { parentId: '2', expected: '2', description: 'F_U = 2 (greater than 1)' },
        { parentId: '456', expected: '456', description: 'F_U = 456' },
        { parentId: 100, expected: 100, description: 'F_U = 100 (number type)' },
        { parentId: '', expected: 1, description: 'F_U = empty string' },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((testCase, index) => {
        // Simulating the fix logic
        const options = { parentId: testCase.parentId };
        const parentIdForNew = (options.parentId && parseInt(options.parentId) > 1) ? options.parentId : 1;

        const result = String(parentIdForNew) === String(testCase.expected);

        if (result) {
            console.log(`✓ Test ${index + 1}: ${testCase.description}`);
            console.log(`  Input parentId: ${JSON.stringify(testCase.parentId)}`);
            console.log(`  Expected up: ${testCase.expected}, Got: ${parentIdForNew}\n`);
            passed++;
        } else {
            console.log(`✗ Test ${index + 1}: ${testCase.description}`);
            console.log(`  Input parentId: ${JSON.stringify(testCase.parentId)}`);
            console.log(`  Expected up: ${testCase.expected}, Got: ${parentIdForNew}`);
            console.log(`  FAILED!\n`);
            failed++;
        }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

// Test URL generation
function testUrlGeneration() {
    console.log('\nTesting URL generation for _m_new:\n');

    const testCases = [
        { parentId: null, typeId: '123', expectedUrl: '/_m_new/123?JSON&up=1' },
        { parentId: '1', typeId: '123', expectedUrl: '/_m_new/123?JSON&up=1' },
        { parentId: '456', typeId: '123', expectedUrl: '/_m_new/123?JSON&up=456' },
        { parentId: '999', typeId: '555', expectedUrl: '/_m_new/555?JSON&up=999' },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach((testCase, index) => {
        const options = { parentId: testCase.parentId };
        const apiBase = '';  // Empty for simplicity
        const typeId = testCase.typeId;

        // Simulating the fix logic
        const parentIdForNew = (options.parentId && parseInt(options.parentId) > 1) ? options.parentId : 1;
        const url = `${apiBase}/_m_new/${typeId}?JSON&up=${parentIdForNew}`;

        const result = url === testCase.expectedUrl;

        if (result) {
            console.log(`✓ Test ${index + 1}: parentId=${JSON.stringify(testCase.parentId)}, typeId=${testCase.typeId}`);
            console.log(`  Expected: ${testCase.expectedUrl}`);
            console.log(`  Got:      ${url}\n`);
            passed++;
        } else {
            console.log(`✗ Test ${index + 1}: parentId=${JSON.stringify(testCase.parentId)}, typeId=${testCase.typeId}`);
            console.log(`  Expected: ${testCase.expectedUrl}`);
            console.log(`  Got:      ${url}`);
            console.log(`  FAILED!\n`);
            failed++;
        }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

// Run tests
console.log('='.repeat(60));
console.log('Testing issue #616 fix');
console.log('='.repeat(60) + '\n');

const test1Passed = testParentIdLogic();
const test2Passed = testUrlGeneration();

console.log('\n' + '='.repeat(60));
if (test1Passed && test2Passed) {
    console.log('All tests PASSED!');
    process.exit(0);
} else {
    console.log('Some tests FAILED!');
    process.exit(1);
}
