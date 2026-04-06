/**
 * Test script for issue #1431: Immediately release inline editor on save
 *
 * Verifies that:
 * 1. saveInlineEdit immediately hides the editor (clears currentEditingCell)
 * 2. The cell is marked with 'cell-saving' class while the API call is in progress
 * 3. Navigation to the next cell happens immediately, without waiting for the API
 * 4. On success: 'cell-saving' class is removed
 * 5. On error: 'cell-saving' class is removed and original content is restored
 */

let passCount = 0;
let failCount = 0;

function assert(condition, description) {
    if (condition) {
        console.log(`  ✓ ${description}`);
        passCount++;
    } else {
        console.error(`  ✗ ${description}`);
        failCount++;
    }
}

// Minimal mock of a cell element
function createMockCell(originalContent = 'original value') {
    const classes = new Set();
    return {
        dataset: {
            originalContent,
        },
        classList: {
            add: (cls) => classes.add(cls),
            remove: (cls) => classes.delete(cls),
            has: (cls) => classes.has(cls),
        },
        innerHTML: originalContent,
        querySelector: () => null,
    };
}

// Minimal mock of IntegramTable for testing saveInlineEdit behavior
class MockIntegramTable {
    constructor(fetchMockFn) {
        this.currentEditingCell = null;
        this.pendingCellClick = null;
        this.navigatedTo = null;
        this.toasts = [];
        this.fetchMock = fetchMockFn;
    }

    getApiBase() { return '/api'; }
    clearRequiredCellHighlights() {}
    updateCellDisplay(cell, value) { cell.innerHTML = value; }
    showToast(msg, type) { this.toasts.push({ msg, type }); }
    showWarningsModal() {}

    navigateToCell(cell) {
        this.navigatedTo = cell;
    }

    // Simplified version of saveInlineEdit matching the issue #1431 implementation
    async saveInlineEdit(newValue) {
        if (!this.currentEditingCell) return;

        const { cell, colType, parentInfo, isNewRow } = this.currentEditingCell;

        if (isNewRow && parentInfo && parentInfo.isFirstColumn) {
            return; // skip new row handling
        }

        const format = this.currentEditingCell.format;
        const originalContent = cell.dataset.originalContent;

        const optimisticDisplay = newValue;
        this.updateCellDisplay(cell, optimisticDisplay, format);

        // Mark as saving immediately
        cell.classList.add('cell-saving');

        // Clear editor state immediately
        this.clearRequiredCellHighlights(cell);
        if (this.currentEditingCell.outsideClickHandler) {
            // would remove event listener
        }
        this.currentEditingCell = null;

        // Navigate immediately
        if (this.pendingCellClick) {
            const targetCell = this.pendingCellClick;
            this.pendingCellClick = null;
            this.navigateToCell(targetCell);
        }

        // Background API save
        try {
            const result = await this.fetchMock();

            if (result.error) throw new Error(result.error);

            cell.classList.remove('cell-saving');
            this.showToast('Изменения сохранены', 'success');

        } catch (error) {
            this.showToast(`Ошибка сохранения: ${error.message}`, 'error');
            cell.classList.remove('cell-saving');
            if (typeof originalContent === 'string') {
                cell.innerHTML = originalContent;
            }
        }
    }
}

// --- Test 1: Editor is released immediately on save (success case) ---
async function testImmediateRelease() {
    console.log('\nTest 1: Editor released immediately (success)');

    let fetchResolve;
    const fetchPromise = new Promise(resolve => { fetchResolve = resolve; });

    const table = new MockIntegramTable(() => fetchPromise);
    const cell = createMockCell('old value');
    const nextCell = createMockCell('');

    table.currentEditingCell = {
        cell,
        colType: '123',
        format: 'TEXT',
        parentInfo: { parentRecordId: '42', isFirstColumn: false },
        isNewRow: false,
    };
    table.pendingCellClick = nextCell;

    // Start save (don't await yet - we want to check intermediate state)
    const savePromise = table.saveInlineEdit('new value');

    // After calling saveInlineEdit (it yields at the first await inside),
    // currentEditingCell should be null already
    // Use a microtask to check after the synchronous part runs
    await Promise.resolve(); // Let synchronous code run

    assert(table.currentEditingCell === null, 'currentEditingCell is null immediately');
    assert(cell.classList.has('cell-saving'), 'cell has cell-saving class');
    assert(cell.innerHTML === 'new value', 'cell shows new value optimistically');
    assert(table.navigatedTo === nextCell, 'navigation happened immediately');

    // Now resolve the fetch (simulate successful API response)
    fetchResolve({ ok: true });
    await savePromise;

    assert(!cell.classList.has('cell-saving'), 'cell-saving class removed after success');
    assert(cell.innerHTML === 'new value', 'cell still shows new value after success');
    assert(table.toasts.some(t => t.type === 'success'), 'success toast shown');
}

// --- Test 2: Error case restores original content ---
async function testErrorRestoresContent() {
    console.log('\nTest 2: Error restores original content');

    const table = new MockIntegramTable(() => Promise.resolve({ error: 'Server error' }));
    const cell = createMockCell('original');

    table.currentEditingCell = {
        cell,
        colType: '123',
        format: 'TEXT',
        parentInfo: { parentRecordId: '42', isFirstColumn: false },
        isNewRow: false,
    };

    await table.saveInlineEdit('new value');

    assert(!cell.classList.has('cell-saving'), 'cell-saving class removed after error');
    assert(cell.innerHTML === 'original', 'original content restored after error');
    assert(table.toasts.some(t => t.type === 'error'), 'error toast shown');
}

// --- Test 3: Navigation happens before API call completes ---
async function testNavigationBeforeApiComplete() {
    console.log('\nTest 3: Navigation before API completes');

    let fetchResolve;
    const fetchPromise = new Promise(resolve => { fetchResolve = resolve; });

    const table = new MockIntegramTable(() => fetchPromise);
    const cell = createMockCell('old');
    const nextCell = createMockCell('');

    table.currentEditingCell = {
        cell,
        colType: '123',
        format: 'TEXT',
        parentInfo: { parentRecordId: '42', isFirstColumn: false },
        isNewRow: false,
    };
    table.pendingCellClick = nextCell;

    const savePromise = table.saveInlineEdit('new');
    await Promise.resolve(); // yield

    assert(table.navigatedTo === nextCell, 'navigation happened before API call finished');
    assert(table.pendingCellClick === null, 'pendingCellClick cleared');

    fetchResolve({});
    await savePromise;
}

// Run all tests
(async () => {
    console.log('=== Issue #1431: Immediate editor release on save ===');

    await testImmediateRelease();
    await testErrorRestoresContent();
    await testNavigationBeforeApiComplete();

    console.log(`\nResults: ${passCount} passed, ${failCount} failed`);
    if (failCount > 0) process.exit(1);
})();
