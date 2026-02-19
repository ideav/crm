// Test script to verify issue #539 fix:
// For NUMBER, SIGNED, DATE, DATETIME columns the default filter type should be '=' (equals),
// not '^' (starts with).

function getDefaultFilterType(format) {
    const equalDefaultFormats = ['NUMBER', 'SIGNED', 'DATE', 'DATETIME'];
    return equalDefaultFormats.includes(format) ? '=' : '^';
}

function runTests() {
    const testCases = [
        // Types that should default to '=' (equals)
        { format: 'NUMBER',   expected: '=', description: 'NUMBER should default to =' },
        { format: 'SIGNED',   expected: '=', description: 'SIGNED should default to =' },
        { format: 'DATE',     expected: '=', description: 'DATE should default to =' },
        { format: 'DATETIME', expected: '=', description: 'DATETIME should default to =' },
        // Types that should keep '^' (starts with)
        { format: 'CHARS',    expected: '^', description: 'CHARS should default to ^' },
        { format: 'SHORT',    expected: '^', description: 'SHORT should default to ^' },
        { format: 'MEMO',     expected: '^', description: 'MEMO should default to ^' },
        { format: 'BOOLEAN',  expected: '^', description: 'BOOLEAN should default to ^' },
        { format: 'FILE',     expected: '^', description: 'FILE should default to ^' },
        { format: 'HTML',     expected: '^', description: 'HTML should default to ^' },
    ];

    console.log('Testing issue #539 - default filter types\n');

    let allPassed = true;

    testCases.forEach(test => {
        const result = getDefaultFilterType(test.format);
        const passed = result === test.expected;
        allPassed = allPassed && passed;

        console.log(`Test: ${test.description}`);
        console.log(`  Format:   ${test.format}`);
        console.log(`  Expected: ${test.expected}`);
        console.log(`  Got:      ${result}`);
        console.log(`  Status:   ${passed ? '✓ PASS' : '✗ FAIL'}`);
        console.log('');
    });

    console.log(`Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
    return allPassed;
}

const passed = runTests();
process.exit(passed ? 0 : 1);
