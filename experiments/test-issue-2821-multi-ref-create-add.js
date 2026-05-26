/**
 * Test for issue #2821: editing a multi-select field and adding a value via the
 * "+" (create) button creates the record in the dictionary but does NOT add it
 * to the row ("Запись успешно создана" is shown, yet the cell stays unchanged).
 *
 * Root cause: the multi-reference inline editor's outside-click handler did not
 * ignore clicks inside the reference creation modal. That modal is appended to
 * <body>, so any click in it (filling a field, pressing "Сохранить") is "outside"
 * the cell. The handler therefore ran cancelInlineEdit(), which sets
 * currentEditingCell = null. By the time saveRecordForReference() finished and
 * reached the block that adds the new item to selectedItems + saveMultiReferenceEdit(),
 * currentEditingCell was already null, so the value was never written to the row.
 *
 * The single-reference editor already guarded against this (issue #875); the fix
 * mirrors that guard in the multi-reference editor's outside-click handler.
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

// Minimal DOM-ish element stub supporting closest() against an ancestor chain.
function makeEl(attrs = {}, parent = null) {
    return {
        attrs,
        parent,
        contains(other) {
            let n = other;
            while (n) {
                if (n === this) return true;
                n = n.parent;
            }
            return false;
        },
        closest(selector) {
            // Supports the two selectors used by the handler:
            //   [data-is-reference-create="true"]  and  .edit-form-overlay
            let n = this;
            while (n) {
                if (selector === '[data-is-reference-create="true"]' &&
                    n.attrs && n.attrs['data-is-reference-create'] === 'true') return n;
                if (selector === '.edit-form-overlay' &&
                    n.attrs && n.attrs.className === 'edit-form-overlay') return n;
                n = n.parent;
            }
            return null;
        }
    };
}

// The OLD (buggy) outside-click handler — no modal guard.
function oldHandler(state, cell, e) {
    if (!cell.contains(e.target)) {
        state.currentEditingCell = null; // cancelInlineEdit() effect
        return 'cancelled';
    }
    return 'kept';
}

// The NEW (fixed) outside-click handler — guards against clicks in the create modal.
function newHandler(state, cell, e) {
    const refModal = e.target.closest('[data-is-reference-create="true"]');
    const refOverlay = e.target.closest('.edit-form-overlay');
    if (refModal || refOverlay) {
        return 'kept'; // ignore clicks inside the reference creation modal
    }
    if (!cell.contains(e.target)) {
        state.currentEditingCell = null; // cancelInlineEdit() effect
        return 'cancelled';
    }
    return 'kept';
}

// Simulate the post-creation block in saveRecordForReference() for multi-reference.
function applyCreatedRecord(state, createdId, createdValue) {
    if (state.currentEditingCell && createdId) {
        if (state.currentEditingCell.isMultiReference) {
            if (!state.currentEditingCell.selectedItems.find(s => s.id === String(createdId))) {
                state.currentEditingCell.selectedItems.push({ id: String(createdId), text: createdValue });
            }
            return 'added';
        }
        return 'single-saved';
    }
    return 'lost'; // currentEditingCell was null → value never added to the row
}

// ─── Build a scene: a multi-ref cell plus a create modal appended to <body> ───
function buildScene() {
    const body = makeEl({ tag: 'body' });
    const cell = makeEl({ tag: 'td' }, body);
    const overlay = makeEl({ className: 'edit-form-overlay' }, body);
    const modal = makeEl({ 'data-is-reference-create': 'true' }, body);
    const saveButton = makeEl({ tag: 'button' }, modal); // "Сохранить" inside the modal
    const state = {
        currentEditingCell: {
            cell,
            isMultiReference: true,
            selectedItems: [{ id: '1', text: 'Alpha' }],
        },
    };
    return { state, cell, overlay, modal, saveButton };
}

// ─── Test 1: OLD handler loses the edit when "Сохранить" in the modal is clicked ──
{
    const { state, cell, saveButton } = buildScene();
    oldHandler(state, cell, { target: saveButton });
    const result = applyCreatedRecord(state, 42, 'Beta');
    assert(state.currentEditingCell === null, 'OLD: clicking modal Save nulls currentEditingCell (bug)');
    assert(result === 'lost', 'OLD: created value is lost, never added to the row (reproduces #2821)');
}

// ─── Test 2: NEW handler keeps the edit and adds the created value to the row ──
{
    const { state, cell, saveButton } = buildScene();
    newHandler(state, cell, { target: saveButton });
    assert(state.currentEditingCell !== null, 'NEW: clicking modal Save keeps currentEditingCell');
    const result = applyCreatedRecord(state, 42, 'Beta');
    assert(result === 'added', 'NEW: created value is added to selectedItems');
    assert(
        state.currentEditingCell.selectedItems.some(s => s.id === '42' && s.text === 'Beta'),
        'NEW: row now contains the newly created value "Beta"'
    );
}

// ─── Test 3: NEW handler also ignores clicks on the modal overlay ──────────────
{
    const { state, cell, overlay } = buildScene();
    newHandler(state, cell, { target: overlay });
    assert(state.currentEditingCell !== null, 'NEW: clicking the modal overlay keeps currentEditingCell');
}

// ─── Test 4: NEW handler still cancels on a genuine outside click ──────────────
{
    const { state, cell } = buildScene();
    const elsewhere = makeEl({ tag: 'div' }, makeEl({ tag: 'body' })); // not the cell, not the modal
    const result = newHandler(state, cell, { target: elsewhere });
    assert(result === 'cancelled', 'NEW: a real outside click still cancels the editor');
    assert(state.currentEditingCell === null, 'NEW: currentEditingCell cleared on genuine outside click');
}

// ─── Test 5: NEW handler keeps the editor when clicking inside the cell ────────
{
    const { state, cell } = buildScene();
    const inner = makeEl({ tag: 'span' }, cell);
    const result = newHandler(state, cell, { target: inner });
    assert(result === 'kept', 'NEW: clicking inside the cell keeps the editor');
    assert(state.currentEditingCell !== null, 'NEW: currentEditingCell preserved on in-cell click');
}

console.log(allPassed ? '\n✓ All tests passed' : '\n✗ Some tests failed');
process.exit(allPassed ? 0 : 1);
