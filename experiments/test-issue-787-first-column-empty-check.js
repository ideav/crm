/**
 * Test for issue #787: When saving the first column of the table,
 * check that the new value is not empty ("").
 *
 * Root cause: In saveEdit() (inside renderInlineEditor), when the first column
 * value is cleared to "", the code passed the empty string to saveInlineEdit()
 * without validation, resulting in an empty value being saved.
 *
 * Fix: Added a check before saving: if parentInfo.isFirstColumn === true and
 * newValue === '', show an error toast and return without saving.
 */

// Simulate the save logic with and without the fix

function simulateSaveEdit_OLD(newValue, isFirstColumn, originalValue) {
    // Old behavior: no empty check for first column
    if (newValue !== originalValue) {
        return { action: 'save', value: newValue };
    } else {
        return { action: 'cancel' };
    }
}

function simulateSaveEdit_FIXED(newValue, isFirstColumn, originalValue) {
    // Fixed behavior: check for empty value in first column (issue #787)
    if (isFirstColumn && newValue === '') {
        return { action: 'error', message: 'Значение первой колонки не может быть пустым' };
    }

    if (newValue !== originalValue) {
        return { action: 'save', value: newValue };
    } else {
        return { action: 'cancel' };
    }
}

const testCases = [
    {
        name: 'First column: saving empty value (issue #787 bug)',
        newValue: '',
        isFirstColumn: true,
        originalValue: 'Some Name',
        expectedOldAction: 'save',   // BUG: saves empty
        expectedFixedAction: 'error' // FIX: shows error
    },
    {
        name: 'First column: saving valid non-empty value',
        newValue: 'New Name',
        isFirstColumn: true,
        originalValue: 'Old Name',
        expectedOldAction: 'save',
        expectedFixedAction: 'save'
    },
    {
        name: 'First column: saving same value (no change)',
        newValue: 'Same Name',
        isFirstColumn: true,
        originalValue: 'Same Name',
        expectedOldAction: 'cancel',
        expectedFixedAction: 'cancel'
    },
    {
        name: 'Requisite column: saving empty value (should be allowed)',
        newValue: '',
        isFirstColumn: false,
        originalValue: 'Some Value',
        expectedOldAction: 'save',
        expectedFixedAction: 'save'  // Requisites can be emptied
    },
    {
        name: 'First column: original empty, saving empty (no change - cancel)',
        newValue: '',
        isFirstColumn: true,
        originalValue: '',
        expectedOldAction: 'cancel',
        expectedFixedAction: 'error' // Still shows error even if no change, as empty is not allowed
    },
];

console.log('=== Issue #787: Empty value check for first column ===\n');

let allPassed = true;
for (const tc of testCases) {
    const oldResult = simulateSaveEdit_OLD(tc.newValue, tc.isFirstColumn, tc.originalValue);
    const fixedResult = simulateSaveEdit_FIXED(tc.newValue, tc.isFirstColumn, tc.originalValue);

    const oldCorrect = oldResult.action === tc.expectedOldAction;
    const fixedCorrect = fixedResult.action === tc.expectedFixedAction;

    const status = fixedCorrect ? 'PASS' : 'FAIL';
    if (!fixedCorrect) allPassed = false;

    console.log(`Test: ${tc.name}`);
    console.log(`  newValue="${tc.newValue}", isFirstColumn=${tc.isFirstColumn}, originalValue="${tc.originalValue}"`);
    console.log(`  Expected OLD action: ${tc.expectedOldAction} => got: ${oldResult.action} (${oldCorrect ? 'correct' : 'confirms bug'})`);
    console.log(`  Expected FIXED action: ${tc.expectedFixedAction} => got: ${fixedResult.action} (${fixedCorrect ? 'correct' : 'WRONG'})`);
    console.log(`  Status: ${status}`);
    console.log('');
}

console.log(`=== Summary: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} ===`);
