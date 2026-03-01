/**
 * Test for issue #527: When a cell is cleared and changes are saved,
 * returning to edit the cell shows the old value.
 *
 * Root cause: In updateCellDisplay(), when newValue is an empty string,
 * fullValueForEditing is also an empty string. The condition:
 *   if (fullValueForEditing) { ... }
 * evaluates to false for empty strings, so the old data-full-value
 * attribute is NOT updated/removed.
 *
 * When the user starts editing the cell again, extractCellValue() reads
 * the OLD value from cell.dataset.fullValue.
 */

// Simulate the bug
function testBug() {
    // Create a mock cell with old value
    const cell = {
        dataset: {
            fullValue: 'old value',
            row: '0',
            colId: '123'
        },
        innerHTML: 'old value',
        textContent: 'old value',
        setAttribute: function(name, value) {
            if (name === 'data-full-value') {
                this.dataset.fullValue = value;
            }
        },
        removeAttribute: function(name) {
            if (name === 'data-full-value') {
                delete this.dataset.fullValue;
            }
        },
        querySelector: function() { return null; }
    };

    console.log('=== Testing Issue #527 Bug ===\n');

    // Simulate extractCellValue (reading value before editing)
    function extractCellValue(cell) {
        if (cell.dataset.fullValue) {
            return cell.dataset.fullValue;
        }
        const cellContent = cell.textContent || '';
        return cellContent.replace(/\.\.\.$/g, '').trim();
    }

    console.log('Initial state:');
    console.log('  cell.dataset.fullValue:', JSON.stringify(cell.dataset.fullValue));
    console.log('  extractCellValue result:', JSON.stringify(extractCellValue(cell)));

    // Simulate updateCellDisplay with empty string (clearing the cell)
    // This is the BUGGY version
    function updateCellDisplayBuggy(cell, newValue) {
        let fullValueForEditing = newValue;

        // BUG: Empty string is falsy, so this condition is NOT entered
        if (fullValueForEditing) {
            cell.setAttribute('data-full-value', fullValueForEditing);
        }

        cell.innerHTML = newValue;
        cell.textContent = newValue;
    }

    console.log('\n--- After clearing cell (BUGGY version) ---');
    updateCellDisplayBuggy(cell, '');  // Clear the cell
    console.log('  cell.dataset.fullValue:', JSON.stringify(cell.dataset.fullValue));
    console.log('  cell.innerHTML:', JSON.stringify(cell.innerHTML));
    console.log('  extractCellValue result:', JSON.stringify(extractCellValue(cell)));
    console.log('  BUG: Old value still appears when re-editing!');

    // Reset for fixed version test
    cell.dataset.fullValue = 'old value';
    cell.innerHTML = 'old value';
    cell.textContent = 'old value';

    // FIXED version
    function updateCellDisplayFixed(cell, newValue) {
        let fullValueForEditing = newValue;

        // FIX: Use explicit check for string type instead of truthiness
        // Empty string is a valid value that should be stored
        if (typeof fullValueForEditing === 'string') {
            if (fullValueForEditing === '') {
                // Remove the attribute when clearing the cell
                cell.removeAttribute('data-full-value');
            } else {
                cell.setAttribute('data-full-value', fullValueForEditing);
            }
        }

        cell.innerHTML = newValue;
        cell.textContent = newValue;
    }

    console.log('\n--- After clearing cell (FIXED version) ---');
    updateCellDisplayFixed(cell, '');  // Clear the cell
    console.log('  cell.dataset.fullValue:', JSON.stringify(cell.dataset.fullValue));
    console.log('  cell.innerHTML:', JSON.stringify(cell.innerHTML));
    console.log('  extractCellValue result:', JSON.stringify(extractCellValue(cell)));
    console.log('  FIX: Cell correctly shows empty value!');

    console.log('\n=== Test Complete ===');
}

testBug();
