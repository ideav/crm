/**
 * Test for issue #2821: creating a new value from an inline multi-reference
 * editor created the dictionary record but did not add it to the edited row.
 *
 * Root cause: the multi-reference editor's outside-click handler treated clicks
 * inside the nested reference-create modal as outside the cell. The Save button
 * click could cancel the inline editor before the _m_new request completed, so
 * saveRecordForReference no longer had currentEditingCell to append the new ID.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`PASS: ${message}`);
        passed++;
    } else {
        console.error(`FAIL: ${message}`);
        failed++;
    }
}

function createNode({ insideCell = false, insideRefModal = false, insideOverlay = false, insideDropdown = false } = {}) {
    return {
        closest(selector) {
            if (selector === '[data-is-reference-create="true"]' && insideRefModal) {
                return { dataset: { isReferenceCreate: 'true' } };
            }
            if (selector === '.edit-form-overlay' && insideOverlay) {
                return { className: 'edit-form-overlay' };
            }
            return null;
        },
        _insideCell: insideCell,
        _insideDropdown: insideDropdown
    };
}

function createTableState() {
    const cell = {
        contains(target) {
            return !!target._insideCell;
        }
    };

    const fixedDropdown = {
        contains(target) {
            return !!target._insideDropdown;
        }
    };

    return {
        cancelCalls: 0,
        currentEditingCell: { cell, fixedDropdown },
        cancelInlineEdit() {
            this.cancelCalls++;
            this.currentEditingCell = null;
        }
    };
}

function simulateOldMultiRefOutsideClick(table, target) {
    const cell = table.currentEditingCell.cell;
    const fixedDropdown = table.currentEditingCell && table.currentEditingCell.fixedDropdown;
    if (fixedDropdown && fixedDropdown.contains(target)) {
        return;
    }
    if (!cell.contains(target)) {
        table.cancelInlineEdit('original');
    }
}

function simulateFixedMultiRefOutsideClick(table, target) {
    const cell = table.currentEditingCell.cell;
    const refModal = target.closest('[data-is-reference-create="true"]');
    const refOverlay = target.closest('.edit-form-overlay');
    if (refModal || refOverlay) {
        return;
    }
    const fixedDropdown = table.currentEditingCell && table.currentEditingCell.fixedDropdown;
    if (fixedDropdown && fixedDropdown.contains(target)) {
        return;
    }
    if (!cell.contains(target)) {
        table.cancelInlineEdit('original');
    }
}

function appendCreatedRecordIfEditorStillOpen(table, createdId, createdValue) {
    if (!table.currentEditingCell || !createdId) {
        return false;
    }
    const selectedItems = table.currentEditingCell.selectedItems || [];
    if (!selectedItems.find(s => s.id === String(createdId))) {
        selectedItems.push({ id: String(createdId), text: createdValue });
    }
    table.currentEditingCell.selectedItems = selectedItems;
    return true;
}

function readMultiReferenceEditorSource() {
    const sourcePath = path.join(__dirname, '..', 'js', 'integram-table', '07-inline-edit.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const start = source.indexOf('async renderMultiReferenceEditor');
    const end = source.indexOf('async saveMultiReferenceEdit', start);
    if (start === -1 || end === -1) {
        throw new Error('Could not locate renderMultiReferenceEditor source');
    }
    return source.slice(start, end);
}

// Old behavior: Save click in the modal cancels the inline editor first.
{
    const table = createTableState();
    table.currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }];
    const saveButtonInCreateModal = createNode({ insideRefModal: true });

    simulateOldMultiRefOutsideClick(table, saveButtonInCreateModal);
    const appended = appendCreatedRecordIfEditorStillOpen(table, '2', 'Beta');

    assert(table.currentEditingCell === null, 'old handler cancels editor on reference modal Save click');
    assert(!appended, 'old flow cannot append created value after editor was cancelled');
}

// Fixed behavior: modal clicks do not close the inline editor, so the created
// record can be appended and saved into the edited multi-reference cell.
{
    const table = createTableState();
    table.currentEditingCell.selectedItems = [{ id: '1', text: 'Alpha' }];
    const saveButtonInCreateModal = createNode({ insideRefModal: true });

    simulateFixedMultiRefOutsideClick(table, saveButtonInCreateModal);
    const appended = appendCreatedRecordIfEditorStillOpen(table, '2', 'Beta');

    assert(table.cancelCalls === 0, 'fixed handler ignores reference modal clicks');
    assert(appended, 'fixed flow appends created value while editor is still active');
    assert(
        table.currentEditingCell.selectedItems.map(item => item.id).join(',') === '1,2',
        'created value is added to selected multi-reference IDs'
    );
}

// Keep the normal outside-click behavior for real clicks outside the editor.
{
    const table = createTableState();
    const pageBackground = createNode();

    simulateFixedMultiRefOutsideClick(table, pageBackground);

    assert(table.currentEditingCell === null, 'fixed handler still cancels on ordinary outside click');
    assert(table.cancelCalls === 1, 'ordinary outside click cancels once');
}

// Clicks in the detached dropdown must still be ignored.
{
    const table = createTableState();
    const dropdownOption = createNode({ insideDropdown: true });

    simulateFixedMultiRefOutsideClick(table, dropdownOption);

    assert(table.cancelCalls === 0, 'fixed handler still ignores detached dropdown clicks');
    assert(table.currentEditingCell !== null, 'dropdown click keeps editor active');
}

// Clicks on the reference modal overlay also belong to the nested create flow.
{
    const table = createTableState();
    const overlay = createNode({ insideOverlay: true });

    simulateFixedMultiRefOutsideClick(table, overlay);

    assert(table.cancelCalls === 0, 'fixed handler ignores reference modal overlay clicks');
    assert(table.currentEditingCell !== null, 'overlay click keeps editor active');
}

// Source-level regression: the real multi-reference outside-click handler must
// ignore the nested reference-create modal just like the single-reference editor.
{
    const source = readMultiReferenceEditorSource();
    assert(
        source.includes('closest(\'[data-is-reference-create="true"]\')')
            || source.includes('closest("[data-is-reference-create=\\"true\\"]")')
            || source.includes('closest(`[data-is-reference-create="true"]`)'),
        'real multi-reference outside-click handler checks for reference-create modal clicks'
    );
    assert(
        source.includes('closest(\'.edit-form-overlay\')')
            || source.includes('closest(".edit-form-overlay")')
            || source.includes('closest(`.edit-form-overlay`)'),
        'real multi-reference outside-click handler checks for reference modal overlay clicks'
    );
}

console.log(failed === 0 ? '\nAll tests passed' : `\n${failed} test(s) failed`);
process.exit(failed === 0 ? 0 : 1);
