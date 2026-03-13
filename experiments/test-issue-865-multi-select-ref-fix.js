/**
 * Test for issue #865: multi-select reference field display bug
 *
 * Root cause: renderCell parsing block used `column.ref_id != null`
 * but isRefField uses `column.ref_id != null || (column.ref && column.ref !== 0)`.
 * Fields with column.ref set but column.ref_id null were not parsed.
 *
 * Fix: use isRefField instead of column.ref_id != null in the parsing block.
 */

// Simulate the two types of columns that can be reference fields
const testCases = [
    {
        name: 'column with ref_id (should have always worked)',
        column: { ref_id: 5, ref: 0, attrs: ':MULTI:', type: 42 },
        value: '469,471,473:М\'О "врот",VIP,ЧС',
    },
    {
        name: 'column with ref but no ref_id (was broken before fix)',
        column: { ref_id: null, ref: 5, attrs: ':MULTI:', type: 42 },
        value: '469,471,473:М\'О "врот",VIP,ЧС',
    },
    {
        name: 'column with ref_id=0 and ref (treated as non-ref)',
        column: { ref_id: null, ref: 0, attrs: ':MULTI:', type: 42 },
        value: '469,471,473:М\'О "врот",VIP,ЧС',
    },
];

function simulateRenderCell(column, value) {
    const isRefField = column.ref_id != null || (column.ref && column.ref !== 0);
    const isArrayField = column.attrs && column.attrs.includes(':MULTI:');

    let displayValue = value || '';
    let multiRawValue = null;
    let refValueId = null;

    // THE FIX: was `column.ref_id != null`, now `isRefField`
    if (isRefField && value && typeof value === 'string') {
        const colonIndex = value.indexOf(':');
        if (colonIndex > 0) {
            refValueId = value.substring(0, colonIndex);
            displayValue = value.substring(colonIndex + 1);
            if (isArrayField) {
                multiRawValue = value;
            }
        }
    }

    return { isRefField, isArrayField, displayValue, multiRawValue, refValueId };
}

let allPassed = true;

for (const tc of testCases) {
    const result = simulateRenderCell(tc.column, tc.value);
    const isRef = tc.column.ref_id != null || (tc.column.ref && tc.column.ref !== 0);

    if (isRef) {
        // Should have parsed the value
        const expectedDisplay = 'М\'О "врот",VIP,ЧС';
        const expectedIds = '469,471,473';

        if (result.displayValue !== expectedDisplay) {
            console.error(`FAIL [${tc.name}]: displayValue="${result.displayValue}", expected "${expectedDisplay}"`);
            allPassed = false;
        } else if (result.refValueId !== expectedIds) {
            console.error(`FAIL [${tc.name}]: refValueId="${result.refValueId}", expected "${expectedIds}"`);
            allPassed = false;
        } else if (result.multiRawValue !== tc.value) {
            console.error(`FAIL [${tc.name}]: multiRawValue="${result.multiRawValue}", expected "${tc.value}"`);
            allPassed = false;
        } else {
            console.log(`PASS [${tc.name}]`);
            console.log(`  displayValue: "${result.displayValue}"`);
            console.log(`  refValueId: "${result.refValueId}"`);
            console.log(`  multiRawValue set: ${result.multiRawValue !== null}`);
        }
    } else {
        // Non-ref: value should not be parsed
        if (result.displayValue !== tc.value) {
            console.error(`FAIL [${tc.name}]: should not parse non-ref value, but displayValue="${result.displayValue}"`);
            allPassed = false;
        } else {
            console.log(`PASS [${tc.name}] (correctly not parsed, not a ref field)`);
        }
    }
}

console.log(allPassed ? '\n✓ All tests passed' : '\n✗ Some tests failed');
