// Test script to verify the filter fix
// This simulates the applyFilter method behavior

function testFilterFix() {
    const testCases = [
        // Test case from the issue
        {
            colId: '441',
            format: 'FR_{ T }>{ X }',
            value: '13',
            expected: '>13',
            description: 'Greater than filter (issue example)'
        },
        // Other operators
        {
            colId: '441',
            format: 'FR_{ T }<{ X }',
            value: '10',
            expected: '<10',
            description: 'Less than filter'
        },
        {
            colId: '441',
            format: 'FR_{ T }>={ X }',
            value: '5',
            expected: '>=5',
            description: 'Greater than or equal filter'
        },
        {
            colId: '441',
            format: 'FR_{ T }=<={ X }',
            value: '20',
            expected: '<=20',
            description: 'Less than or equal filter'
        },
        {
            colId: '441',
            format: 'FR_{ T }={ X }',
            value: 'test',
            expected: 'test',
            description: 'Equal filter (with =)'
        },
        {
            colId: '441',
            format: 'FR_{ T }=%{ X }%',
            value: 'search',
            expected: '%search%',
            description: 'Contains filter'
        },
        {
            colId: '441',
            format: 'FR_{ T }={ X }%',
            value: 'start',
            expected: 'start%',
            description: 'Starts with filter'
        }
    ];

    console.log('Testing filter fix...\n');

    let allPassed = true;

    testCases.forEach(test => {
        // Simulate the old (buggy) behavior
        let oldParamValue = test.format.replace('{ T }', test.colId).replace('{ X }', test.value);
        oldParamValue = oldParamValue.replace('FR_' + test.colId + '=', '');
        const oldResult = `FR_${test.colId}=${oldParamValue}`;

        // Simulate the new (fixed) behavior
        let paramValue = test.format.replace('{ T }', test.colId).replace('{ X }', test.value);
        const prefix = 'FR_' + test.colId;
        if (paramValue.startsWith(prefix)) {
            paramValue = paramValue.substring(prefix.length);
            if (paramValue.startsWith('=')) {
                paramValue = paramValue.substring(1);
            }
        }
        const newResult = `FR_${test.colId}=${paramValue}`;

        const expectedResult = `FR_${test.colId}=${test.expected}`;
        const passed = newResult === expectedResult;
        allPassed = allPassed && passed;

        console.log(`Test: ${test.description}`);
        console.log(`  Format: ${test.format}`);
        console.log(`  Old result: ${oldResult}`);
        console.log(`  New result: ${newResult}`);
        console.log(`  Expected:   ${expectedResult}`);
        console.log(`  Status: ${passed ? '✓ PASS' : '✗ FAIL'}`);
        console.log('');
    });

    console.log(`Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
    return allPassed;
}

// Run tests
testFilterFix();
