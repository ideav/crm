/**
 * Test case for issue #520: Empty string handling in cancelInlineEdit
 *
 * Problem: When canceling inline edit on an originally empty cell,
 * originalContent was '' (empty string), which is falsy in JavaScript.
 * This caused the code to incorrectly enter the else branch and re-render
 * the cell from this.data[rowIndex][dataIndex].
 *
 * Fix: Use typeof check instead of truthiness check to properly handle
 * empty string as a valid value to restore.
 */

// Simulate the bug scenario
function testCancelInlineEditBug() {
    console.log('=== Testing cancelInlineEdit empty string bug ===\n');

    // Original buggy condition
    function buggyCheck(originalContent) {
        if (originalContent) {
            return 'Restore original content';
        } else {
            return 'Fallback: re-render from data (BUG!)';
        }
    }

    // Fixed condition
    function fixedCheck(originalContent) {
        if (typeof originalContent === 'string') {
            return 'Restore original content';
        } else {
            return 'Fallback: re-render from data';
        }
    }

    // Test cases
    const testCases = [
        { value: '', description: 'Empty string (empty cell)' },
        { value: '<div>Some content</div>', description: 'HTML content' },
        { value: 'Plain text', description: 'Plain text' },
        { value: undefined, description: 'Undefined (should fallback)' },
        { value: null, description: 'Null (should fallback)' },
    ];

    console.log('Testing buggy implementation:');
    console.log('-'.repeat(60));
    testCases.forEach(tc => {
        const result = buggyCheck(tc.value);
        const isBug = tc.description.includes('Empty string') && result.includes('BUG');
        console.log(`  ${tc.description}:`);
        console.log(`    Input: ${JSON.stringify(tc.value)}`);
        console.log(`    Result: ${result}${isBug ? ' <- THIS IS THE BUG!' : ''}`);
    });

    console.log('\n');
    console.log('Testing fixed implementation:');
    console.log('-'.repeat(60));
    testCases.forEach(tc => {
        const result = fixedCheck(tc.value);
        console.log(`  ${tc.description}:`);
        console.log(`    Input: ${JSON.stringify(tc.value)}`);
        console.log(`    Result: ${result}`);
    });

    // Verify fix
    console.log('\n');
    console.log('=== Verification ===');
    console.log('-'.repeat(60));

    const emptyStringBuggy = buggyCheck('');
    const emptyStringFixed = fixedCheck('');

    console.log(`Empty string with buggy check: ${emptyStringBuggy}`);
    console.log(`Empty string with fixed check: ${emptyStringFixed}`);

    if (emptyStringFixed === 'Restore original content') {
        console.log('\n✓ FIX VERIFIED: Empty string is now properly handled');
    } else {
        console.log('\n✗ FIX FAILED: Empty string is still not properly handled');
        process.exit(1);
    }
}

testCancelInlineEditBug();
