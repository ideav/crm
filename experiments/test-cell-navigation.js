/**
 * Test script for cell navigation feature (issue #518)
 *
 * This script tests the logic of the navigation helper methods
 * without requiring a browser environment.
 */

// Simulate a minimal IntegramTable instance for testing navigation logic
class MockIntegramTable {
    constructor() {
        this.currentEditingCell = null;
        this.pendingCellClick = null;
        this.container = {
            querySelectorAll: () => this.mockEditableCells
        };

        // Mock cells: 3 rows x 3 columns of editable cells
        // Each cell has data-row-index and data-col-id
        this.mockEditableCells = [];
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                this.mockEditableCells.push({
                    dataset: {
                        rowIndex: String(row),
                        colId: String(col),
                        editable: 'true'
                    },
                    row,
                    col,
                    toString: function() { return `Cell[${this.row},${this.col}]`; }
                });
            }
        }
    }

    getEditableCells() {
        return Array.from(this.container.querySelectorAll('td[data-editable="true"]'));
    }

    findNextEditableCell(currentCell) {
        const editableCells = this.getEditableCells();
        if (editableCells.length === 0) return null;

        const currentIndex = editableCells.indexOf(currentCell);
        if (currentIndex === -1) return editableCells[0];

        const nextIndex = (currentIndex + 1) % editableCells.length;
        return editableCells[nextIndex];
    }

    findPreviousEditableCell(currentCell) {
        const editableCells = this.getEditableCells();
        if (editableCells.length === 0) return null;

        const currentIndex = editableCells.indexOf(currentCell);
        if (currentIndex === -1) return editableCells[editableCells.length - 1];

        const prevIndex = (currentIndex - 1 + editableCells.length) % editableCells.length;
        return editableCells[prevIndex];
    }

    findCellAbove(currentCell) {
        const currentRowIndex = parseInt(currentCell.dataset.rowIndex);
        const currentColId = currentCell.dataset.colId;

        if (isNaN(currentRowIndex) || currentRowIndex <= 0) return null;

        const targetRowIndex = currentRowIndex - 1;
        const editableCells = this.getEditableCells();
        return editableCells.find(cell =>
            cell.dataset.rowIndex === String(targetRowIndex) &&
            cell.dataset.colId === currentColId
        ) || null;
    }

    findCellBelow(currentCell) {
        const currentRowIndex = parseInt(currentCell.dataset.rowIndex);
        const currentColId = currentCell.dataset.colId;

        if (isNaN(currentRowIndex)) return null;

        const targetRowIndex = currentRowIndex + 1;
        const editableCells = this.getEditableCells();
        return editableCells.find(cell =>
            cell.dataset.rowIndex === String(targetRowIndex) &&
            cell.dataset.colId === currentColId
        ) || null;
    }
}

// Test cases
function runTests() {
    console.log('Testing cell navigation feature (issue #518)\n');

    const table = new MockIntegramTable();
    const cells = table.getEditableCells();

    console.log('=== Test Setup ===');
    console.log(`Total editable cells: ${cells.length}`);
    console.log('Grid layout: 3 rows x 3 columns\n');

    // Test 1: findNextEditableCell
    console.log('=== Test 1: findNextEditableCell ===');
    const cell00 = cells[0]; // Row 0, Col 0
    const next1 = table.findNextEditableCell(cell00);
    console.log(`Next from ${cell00}: ${next1}`);
    console.assert(next1.row === 0 && next1.col === 1, 'Should move to Cell[0,1]');

    const cell22 = cells[8]; // Row 2, Col 2 (last cell)
    const next2 = table.findNextEditableCell(cell22);
    console.log(`Next from ${cell22}: ${next2}`);
    console.assert(next2.row === 0 && next2.col === 0, 'Should wrap to Cell[0,0]');
    console.log('PASS\n');

    // Test 2: findPreviousEditableCell
    console.log('=== Test 2: findPreviousEditableCell ===');
    const prev1 = table.findPreviousEditableCell(cell00);
    console.log(`Previous from ${cell00}: ${prev1}`);
    console.assert(prev1.row === 2 && prev1.col === 2, 'Should wrap to Cell[2,2]');

    const cell11 = cells[4]; // Row 1, Col 1
    const prev2 = table.findPreviousEditableCell(cell11);
    console.log(`Previous from ${cell11}: ${prev2}`);
    console.assert(prev2.row === 1 && prev2.col === 0, 'Should move to Cell[1,0]');
    console.log('PASS\n');

    // Test 3: findCellAbove
    console.log('=== Test 3: findCellAbove ===');
    const above1 = table.findCellAbove(cell11);
    console.log(`Above from ${cell11}: ${above1}`);
    console.assert(above1.row === 0 && above1.col === 1, 'Should move to Cell[0,1]');

    const above2 = table.findCellAbove(cell00);
    console.log(`Above from ${cell00}: ${above2}`);
    console.assert(above2 === null, 'Should return null (no cell above row 0)');
    console.log('PASS\n');

    // Test 4: findCellBelow
    console.log('=== Test 4: findCellBelow ===');
    const below1 = table.findCellBelow(cell11);
    console.log(`Below from ${cell11}: ${below1}`);
    console.assert(below1.row === 2 && below1.col === 1, 'Should move to Cell[2,1]');

    const below2 = table.findCellBelow(cell22);
    console.log(`Below from ${cell22}: ${below2}`);
    console.assert(below2 === null, 'Should return null (no cell below row 2)');
    console.log('PASS\n');

    console.log('=== All tests passed! ===');
}

runTests();
