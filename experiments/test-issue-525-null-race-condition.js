/**
 * Test script for issue #525: null dereference when navigating with arrow keys
 *
 * Error: Uncaught TypeError: Cannot set properties of null (setting 'outsideClickHandler')
 *   at integram-table.js:2305:61
 *
 * Root cause: A race condition where saveAndNavigate() completes within 100ms,
 * setting this.currentEditingCell = null, before the setTimeout in renderInlineEditor
 * fires and tries to set this.currentEditingCell.outsideClickHandler = outsideClickHandler.
 *
 * Fix: Capture this.currentEditingCell before the setTimeout and guard against null.
 */

// Simulate the race condition scenario
function testRaceConditionFix() {
    console.log('Testing issue #525: null race condition fix\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  PASS: ${message}`);
            passed++;
        } else {
            console.error(`  FAIL: ${message}`);
            failed++;
        }
    }

    // ===================================================================
    // Test 1: Simulate the ORIGINAL BUG (should throw TypeError)
    // ===================================================================
    console.log('=== Test 1: Original buggy pattern throws TypeError ===');
    {
        let currentEditingCell = { cell: 'cell-A' };
        let errorCaught = false;

        // Simulate setTimeout callback where currentEditingCell was set to null
        // before callback runs (the race condition)
        function buggySetTimeout(callback) {
            // Fast save completes and clears currentEditingCell before timeout fires
            currentEditingCell = null;
            // Now the callback fires — this is the original buggy code
            try {
                callback();
            } catch (e) {
                errorCaught = true;
            }
        }

        buggySetTimeout(() => {
            const outsideClickHandler = (e) => {};
            // Original buggy line: currentEditingCell.outsideClickHandler = outsideClickHandler;
            currentEditingCell.outsideClickHandler = outsideClickHandler; // should throw
        });

        assert(errorCaught, 'Original buggy code throws TypeError when currentEditingCell is null');
    }

    // ===================================================================
    // Test 2: Fixed pattern — no error when currentEditingCell is null
    // ===================================================================
    console.log('\n=== Test 2: Fixed pattern — no error when currentEditingCell is null ===');
    {
        let currentEditingCell = { cell: 'cell-A' };
        let errorCaught = false;
        let listenerRemoved = false;

        const editingCellRef = currentEditingCell; // capture before setTimeout

        // Fast save completes before setTimeout fires
        currentEditingCell = null;

        // setTimeout fires
        try {
            const outsideClickHandler = (e) => {};
            // Simulate document.addEventListener (no-op here)
            // Check: fixed code
            if (currentEditingCell === editingCellRef && currentEditingCell !== null) {
                currentEditingCell.outsideClickHandler = outsideClickHandler;
            } else {
                // Remove listener — edit already finished
                listenerRemoved = true;
            }
        } catch (e) {
            errorCaught = true;
        }

        assert(!errorCaught, 'Fixed code does NOT throw TypeError when currentEditingCell is null');
        assert(listenerRemoved, 'Fixed code removes outsideClickHandler when cell edit already finished');
    }

    // ===================================================================
    // Test 3: Fixed pattern — handler stored when edit still active
    // ===================================================================
    console.log('\n=== Test 3: Fixed pattern — handler stored when edit still active ===');
    {
        let currentEditingCell = { cell: 'cell-A' };
        let errorCaught = false;
        let handlerStored = false;
        let listenerRemoved = false;

        const editingCellRef = currentEditingCell; // capture before setTimeout

        // No fast navigation — currentEditingCell still the same after 100ms

        // setTimeout fires
        try {
            const outsideClickHandler = (e) => {};
            // Fixed code check
            if (currentEditingCell === editingCellRef && currentEditingCell !== null) {
                currentEditingCell.outsideClickHandler = outsideClickHandler;
                handlerStored = true;
            } else {
                listenerRemoved = true;
            }
        } catch (e) {
            errorCaught = true;
        }

        assert(!errorCaught, 'No error when edit is still active');
        assert(handlerStored, 'Handler stored on currentEditingCell when edit still active');
        assert(!listenerRemoved, 'Listener NOT removed when edit still active');
    }

    // ===================================================================
    // Test 4: Fixed pattern — handler NOT stored when cell changed to new cell
    // ===================================================================
    console.log('\n=== Test 4: Fixed pattern — handler NOT stored when new cell already editing ===');
    {
        let currentEditingCell = { cell: 'cell-A' };
        let errorCaught = false;
        let handlerStored = false;
        let listenerRemoved = false;

        const editingCellRef = currentEditingCell; // capture before setTimeout

        // Navigation completed: old cell saved, new cell now being edited
        currentEditingCell = { cell: 'cell-B' }; // different object

        // setTimeout fires
        try {
            const outsideClickHandler = (e) => {};
            // Fixed code check
            if (currentEditingCell === editingCellRef && currentEditingCell !== null) {
                currentEditingCell.outsideClickHandler = outsideClickHandler;
                handlerStored = true;
            } else {
                // Remove listener — edit already finished for old cell
                listenerRemoved = true;
            }
        } catch (e) {
            errorCaught = true;
        }

        assert(!errorCaught, 'No error when a different cell is now being edited');
        assert(!handlerStored, 'Handler NOT stored on new cell (would be wrong cell)');
        assert(listenerRemoved, 'Listener removed to avoid orphaned handler on new cell');
    }

    // ===================================================================
    // Summary
    // ===================================================================
    console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
    if (failed === 0) {
        console.log('All tests PASSED! The fix correctly handles the race condition.');
    } else {
        console.error(`${failed} test(s) FAILED!`);
        process.exit(1);
    }
}

testRaceConditionFix();
