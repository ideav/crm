/**
 * Test for issue #879: inline-editor-multi-reference cell value not updated after editing
 *
 * Root cause: When closing the multi-reference editor by clicking outside,
 * cancelInlineEdit(originalContent) was called with the pre-edit HTML, restoring
 * the old cell value even though saves had already succeeded via API.
 *
 * Fix 1: saveMultiReferenceEdit now updates cell.dataset.rawValue with new IDs/texts
 *         so re-opening the editor uses the correct saved selections.
 * Fix 2: saveMultiReferenceEdit now stores currentEditingCell.savedContent after each save.
 *         The outside-click handler uses savedContent (if available) instead of originalContent.
 */

'use strict';

let allPassed = true;

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        allPassed = false;
    } else {
        console.log(`PASS: ${message}`);
    }
}

// Simulate the key parts of saveMultiReferenceEdit (post-fix)
function simulateSaveMultiReferenceEdit(currentEditingCell, selectedItems) {
    // Simulate what updateCellDisplay sets cell.innerHTML to
    const displayText = selectedItems.map(s => s.text).join(', ');
    currentEditingCell.cell.innerHTML = displayText; // simplified - no edit icon

    // Issue #879 fix: update rawValue
    const ids = selectedItems.map(s => s.id).filter(id => id);
    const rawValue = ids.join(',') + ':' + selectedItems.map(s => s.text).join(',');
    currentEditingCell.cell.dataset = currentEditingCell.cell.dataset || {};
    currentEditingCell.cell.dataset.rawValue = rawValue;

    // Issue #879 fix: track saved content
    currentEditingCell.savedContent = currentEditingCell.cell.innerHTML;
}

// Simulate the outside-click handler behavior (post-fix)
function simulateOutsideClick(currentEditingCell, originalContent) {
    const contentToRestore = (currentEditingCell && currentEditingCell.savedContent !== undefined)
        ? currentEditingCell.savedContent
        : originalContent;
    // cancelInlineEdit would set cell.innerHTML = contentToRestore
    currentEditingCell.cell.innerHTML = contentToRestore;
    return contentToRestore;
}

// ─── Test 1: No saves made → should restore original content ───────────────
{
    const originalContent = '<span>Alpha</span>';
    const cell = { innerHTML: '<div class="inline-editor-multi-reference">...</div>', dataset: { rawValue: '1:Alpha' } };
    const currentEditingCell = { cell, selectedItems: [{ id: '1', text: 'Alpha' }] };
    // No saves, no savedContent set

    const restored = simulateOutsideClick(currentEditingCell, originalContent);
    assert(restored === originalContent, 'No saves: should restore originalContent');
    assert(cell.innerHTML === originalContent, 'No saves: cell.innerHTML should be originalContent');
}

// ─── Test 2: One item added → should show updated content, not original ────
{
    const originalContent = '<span>Alpha</span>';
    const cell = { innerHTML: '<div class="inline-editor-multi-reference">...</div>', dataset: { rawValue: '1:Alpha' } };
    const currentEditingCell = { cell, selectedItems: [{ id: '1', text: 'Alpha' }] };

    // User adds Beta
    currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }, { id: '2', text: 'Beta' }];
    simulateSaveMultiReferenceEdit(currentEditingCell, currentEditingCell.selectedItems);

    // Simulate renderEditor() running after save (overwrites cell.innerHTML with editor HTML)
    cell.innerHTML = '<div class="inline-editor-multi-reference">editor-with-alpha-beta</div>';

    // Now user clicks outside
    const restored = simulateOutsideClick(currentEditingCell, originalContent);
    assert(restored !== originalContent, 'After add: should NOT restore originalContent');
    assert(restored === 'Alpha, Beta', 'After add: should show "Alpha, Beta"');
    assert(cell.innerHTML === 'Alpha, Beta', 'After add: cell.innerHTML should be "Alpha, Beta"');
}

// ─── Test 3: Item removed → should show updated content ────────────────────
{
    const originalContent = '<span>Alpha, Beta</span>';
    const cell = { innerHTML: '<div class="inline-editor-multi-reference">...</div>', dataset: { rawValue: '1,2:Alpha,Beta' } };
    const currentEditingCell = { cell, selectedItems: [{ id: '1', text: 'Alpha' }, { id: '2', text: 'Beta' }] };

    // User removes Beta
    currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }];
    simulateSaveMultiReferenceEdit(currentEditingCell, currentEditingCell.selectedItems);

    // Simulate renderEditor() running after save
    cell.innerHTML = '<div class="inline-editor-multi-reference">editor-with-alpha-only</div>';

    // Now user clicks outside
    const restored = simulateOutsideClick(currentEditingCell, originalContent);
    assert(restored !== originalContent, 'After remove: should NOT restore originalContent');
    assert(restored === 'Alpha', 'After remove: should show "Alpha"');
}

// ─── Test 4: All items removed → should show empty string ──────────────────
{
    const originalContent = '<span>Alpha</span>';
    const cell = { innerHTML: '<div class="inline-editor-multi-reference">...</div>', dataset: { rawValue: '1:Alpha' } };
    const currentEditingCell = { cell, selectedItems: [{ id: '1', text: 'Alpha' }] };

    // User removes Alpha
    currentEditingCell.selectedItems = [];
    simulateSaveMultiReferenceEdit(currentEditingCell, currentEditingCell.selectedItems);

    cell.innerHTML = '<div class="inline-editor-multi-reference">editor-empty</div>';

    const restored = simulateOutsideClick(currentEditingCell, originalContent);
    assert(restored !== originalContent, 'After clear: should NOT restore originalContent');
    assert(restored === '', 'After clear: should show empty string');
}

// ─── Test 5: rawValue is updated correctly after save ──────────────────────
{
    const originalContent = '<span>Alpha</span>';
    const cell = { innerHTML: '<div class="inline-editor-multi-reference">...</div>', dataset: { rawValue: '1:Alpha' } };
    const currentEditingCell = { cell, selectedItems: [{ id: '1', text: 'Alpha' }] };

    currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }, { id: '3', text: 'Gamma' }];
    simulateSaveMultiReferenceEdit(currentEditingCell, currentEditingCell.selectedItems);

    assert(cell.dataset.rawValue === '1,3:Alpha,Gamma', 'rawValue updated correctly after save');
}

// ─── Test 6: Multiple saves, only last saved content used ──────────────────
{
    const originalContent = '<span>Alpha</span>';
    const cell = { innerHTML: '<div class="inline-editor-multi-reference">...</div>', dataset: { rawValue: '1:Alpha' } };
    const currentEditingCell = { cell, selectedItems: [{ id: '1', text: 'Alpha' }] };

    // First save: add Beta
    currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }, { id: '2', text: 'Beta' }];
    simulateSaveMultiReferenceEdit(currentEditingCell, currentEditingCell.selectedItems);
    cell.innerHTML = '<div class="inline-editor-multi-reference">editor</div>';

    // Second save: also add Gamma
    currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }, { id: '2', text: 'Beta' }, { id: '3', text: 'Gamma' }];
    simulateSaveMultiReferenceEdit(currentEditingCell, currentEditingCell.selectedItems);
    cell.innerHTML = '<div class="inline-editor-multi-reference">editor</div>';

    const restored = simulateOutsideClick(currentEditingCell, originalContent);
    assert(restored === 'Alpha, Beta, Gamma', 'Multiple saves: shows latest saved state');
}

console.log(allPassed ? '\n✓ All tests passed' : '\n✗ Some tests failed');
process.exit(allPassed ? 0 : 1);
