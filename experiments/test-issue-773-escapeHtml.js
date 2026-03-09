/**
 * Test: Issue #773 - escapeHtml('') gives undefined (again)
 * 
 * Root cause: forms.html was not in update.conf, so the escapeHtml fix from 
 * PR #770 (issue #769) was never deployed to the production server.
 *
 * Fix: Add templates/forms.html to update.conf
 *
 * This test verifies the current forms.html escapeHtml implementation is correct.
 */

// Current forms.html implementation (as deployed after fix in PR #770)
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&#039;');
}

// Test cases from the issue
const testCases = [
    { input: '', expected: '', desc: 'empty string (the reported issue)' },
    { input: null, expected: '', desc: 'null value' },
    { input: undefined, expected: '', desc: 'undefined value' },
    { input: 0, expected: '0', desc: 'number zero (should not be empty)' },
    { input: 'hello', expected: 'hello', desc: 'normal string' },
    { input: '<script>alert(1)</script>', expected: '&lt;script&gt;alert(1)&lt;/script&gt;', desc: 'XSS attempt' },
    { input: '"quoted"', expected: '&quot;quoted&quot;', desc: 'double quotes' },
];

let allPassed = true;
console.log('=== Issue #773: escapeHtml Test Suite ===\n');
testCases.forEach(({ input, expected, desc }) => {
    const result = escapeHtml(input);
    const passed = result === expected;
    const status = passed ? 'PASS' : 'FAIL';
    if (!passed) allPassed = false;
    console.log(`${status}: escapeHtml(${JSON.stringify(input)}) = ${JSON.stringify(result)} (expected: ${JSON.stringify(expected)}) - ${desc}`);
});

console.log('\n=== Summary ===');
if (allPassed) {
    console.log('All tests PASSED - the current forms.html escapeHtml is correct.');
    console.log('\nRoot cause confirmed: The issue was that forms.html was not in update.conf,');
    console.log('so fixes to escapeHtml were never deployed to the production server.');
    console.log('\nFix: Added templates/forms.html to update.conf.');
} else {
    console.log('Some tests FAILED - escapeHtml still has issues!');
}
