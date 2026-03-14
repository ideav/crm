/**
 * Test script to validate issue #933 fix:
 * .edit-icon not shown on hover for first column cells with DATETIME format.
 *
 * Root cause: In renderCell(), the switch(format) block was using `cellClass = 'xxx-cell'`
 * (assignment) which overwrote the `editable-cell` class added earlier.
 * Fix: Changed to `cellClass += ' xxx-cell'` (append) so both classes are preserved.
 */

// Simulate the cellClass logic in renderCell()

function simulateCellClassBefore(isEditable, format) {
    // Bug: old code - assignment overwrites editable-cell
    let cellClass = '';
    if (isEditable) {
        cellClass += ' editable-cell';
    }
    switch (format) {
        case 'NUMBER':
        case 'SIGNED':
            cellClass = 'number-cell'; // BUG: overwrites editable-cell
            break;
        case 'BOOLEAN':
            cellClass = 'boolean-cell'; // BUG
            break;
        case 'DATE':
            cellClass = 'date-cell'; // BUG
            break;
        case 'DATETIME':
            cellClass = 'datetime-cell'; // BUG
            break;
        case 'MEMO':
            cellClass = 'memo-cell'; // BUG
            break;
        case 'PWD':
            cellClass = 'pwd-cell'; // BUG
            break;
        case 'FILE':
            cellClass = 'file-cell'; // BUG
            break;
    }
    return cellClass.trim();
}

function simulateCellClassAfter(isEditable, format) {
    // Fix: append instead of assign
    let cellClass = '';
    if (isEditable) {
        cellClass += ' editable-cell';
    }
    switch (format) {
        case 'NUMBER':
        case 'SIGNED':
            cellClass += ' number-cell';
            break;
        case 'BOOLEAN':
            cellClass += ' boolean-cell';
            break;
        case 'DATE':
            cellClass += ' date-cell';
            break;
        case 'DATETIME':
            cellClass += ' datetime-cell';
            break;
        case 'MEMO':
            cellClass += ' memo-cell';
            break;
        case 'PWD':
            cellClass += ' pwd-cell';
            break;
        case 'FILE':
            cellClass += ' file-cell';
            break;
    }
    return cellClass.trim();
}

function hasClass(classStr, className) {
    return classStr.split(' ').includes(className);
}

let passed = 0;
let failed = 0;

function test(name, actual, expected) {
    if (actual === expected) {
        console.log(`✓ PASS: ${name}`);
        passed++;
    } else {
        console.log(`✗ FAIL: ${name}`);
        console.log(`  Expected: "${expected}"`);
        console.log(`  Got:      "${actual}"`);
        failed++;
    }
}

console.log('=== Issue #933: edit-icon missing on DATETIME cells ===\n');

// Test the BUG (before fix)
console.log('--- Before fix (demonstrating the bug) ---');
const formatsToTest = ['DATETIME', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN', 'MEMO', 'PWD', 'FILE'];

for (const fmt of formatsToTest) {
    const classes = simulateCellClassBefore(true, fmt);
    const hasEditable = hasClass(classes, 'editable-cell');
    // These should all FAIL (demonstrating the bug)
    test(`[BUG] isEditable=true, format=${fmt}: should have editable-cell (but doesn't)`,
        hasEditable, false); // false because the bug means it's missing
}

console.log('\n--- After fix ---');

// Test the FIX
for (const fmt of formatsToTest) {
    const classes = simulateCellClassAfter(true, fmt);
    const hasEditable = hasClass(classes, 'editable-cell');
    test(`isEditable=true, format=${fmt}: has editable-cell`, hasEditable, true);
}

// Test non-editable cells still work
console.log('\n--- Non-editable cells (should NOT have editable-cell) ---');
for (const fmt of ['DATETIME', 'DATE', 'SHORT']) {
    const classes = simulateCellClassAfter(false, fmt);
    const hasEditable = hasClass(classes, 'editable-cell');
    test(`isEditable=false, format=${fmt}: no editable-cell`, hasEditable, false);
}

// Test SHORT format (no special case in switch, so cellClass stays as-is)
console.log('\n--- SHORT format (no switch case) ---');
const shortEditable = simulateCellClassAfter(true, 'SHORT');
test('isEditable=true, format=SHORT: has editable-cell', hasClass(shortEditable, 'editable-cell'), true);

// Test the specific scenario from issue #933
console.log('\n--- Issue #933 exact scenario ---');
// Column: DATETIME, editable (first column of table data source)
const issueCellClasses = simulateCellClassAfter(true, 'DATETIME');
test('issue #933: DATETIME editable cell has editable-cell class', hasClass(issueCellClasses, 'editable-cell'), true);
test('issue #933: DATETIME editable cell has datetime-cell class', hasClass(issueCellClasses, 'datetime-cell'), true);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
    process.exit(1);
}
