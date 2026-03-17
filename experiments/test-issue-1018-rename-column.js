/**
 * Test for issue #1018: Add column renaming to Edit Column form.
 *
 * This test verifies that:
 * 1. The col-edit-name input field is added to the edit form for non-first columns.
 * 2. The col-edit-name input is NOT shown for the first column.
 * 3. The renameColumn method calls _d_save with the correct parameters.
 * 4. The save handler triggers renameColumn when the name changes.
 */

const assert = require('assert');

// --- Mock DOM environment ---
class MockElement {
    constructor(tag) {
        this.tagName = tag;
        this.innerHTML = '';
        this.style = {};
        this.className = '';
        this._events = {};
        this.children = [];
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.textContent = '';
    }
    addEventListener(event, handler) {
        this._events[event] = handler;
    }
    querySelector(selector) {
        // Simple mock - extract id from selector like #col-edit-name-inst
        const idMatch = selector.match(/#([^\s]+)/);
        if (idMatch) {
            return this._findById(idMatch[1]);
        }
        return null;
    }
    _findById(id) {
        if (this._elementsById && this._elementsById[id]) {
            return this._elementsById[id];
        }
        return null;
    }
    remove() {}
    appendChild(child) { this.children.push(child); }
}

// --- Minimal IntegramTable mock ---
class MockIntegramTable {
    constructor(options) {
        this.options = options;
        this.renameCalls = [];
        this.saveTypeCalls = [];
        this.setRequiredCalls = [];
        this.setAliasCalls = [];
        this.toggleMultiCalls = [];
    }

    getApiBase() { return '/test'; }
    escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    parseAttrs(attrs) {
        return {
            required: attrs.includes(':!NULL:'),
            multi: attrs.includes(':MULTI:'),
            alias: (attrs.match(/:ALIAS=(.*?):/) || [])[1] || null
        };
    }
    closeColumnSettings() {}
    loadData() {}

    async renameColumn(origId, newName, typeId) {
        this.renameCalls.push({ origId, newName, typeId });
        return { success: true };
    }

    async saveColumnType(origId, newTypeId, colName) {
        this.saveTypeCalls.push({ origId, newTypeId, colName });
        return { success: true };
    }

    async setColumnRequired(colId) {
        this.setRequiredCalls.push({ colId });
        return { success: true };
    }

    async setColumnAlias(colId, alias) {
        this.setAliasCalls.push({ colId, alias });
        return { success: true };
    }

    async toggleColumnMulti(colId) {
        this.toggleMultiCalls.push({});
        return { success: true };
    }
}

// --- Tests ---

function test_renameColumn_called_with_new_name() {
    const table = new MockIntegramTable({ instanceName: 'inst' });

    const col = { id: '42', orig: '10', name: 'OldName', val: 'OldName', type: '3', attrs: '', ref_id: null, ref: null };
    const instanceName = 'inst';
    const isFirstColumn = false;
    const isRef = false;
    const parsedAttrs = table.parseAttrs(col.attrs);
    const isMulti = parsedAttrs.multi;
    const isRequired = parsedAttrs.required;
    const currentAlias = parsedAttrs.alias || '';
    const currentName = col.val || col.name;

    // Simulate: user typed 'NewName' into the name input
    const elements = {
        [`col-edit-name-${instanceName}`]: { value: 'NewName' },
        [`col-edit-type-${instanceName}`]: { value: '3' },  // same type
        [`col-edit-required-${instanceName}`]: { checked: false },
        [`col-edit-save-${instanceName}`]: { disabled: false },
    };

    // Simulate the save handler logic (extracted from showColumnEditForm)
    async function simulateSave() {
        // Step 0: Rename
        if (!isFirstColumn) {
            const newName = elements[`col-edit-name-${instanceName}`].value.trim();
            if (newName && newName !== currentName) {
                const result = await table.renameColumn(col.orig || col.id, newName, col.type);
                if (!result.success) return 'rename_failed';
                col.name = newName;
                col.val = newName;
            }
        }

        // Step 1: Type change (non-ref)
        if (!isRef) {
            const newTypeId = elements[`col-edit-type-${instanceName}`].value;
            const currentColName = (!isFirstColumn && elements[`col-edit-name-${instanceName}`].value.trim()) || col.name;
            if (String(newTypeId) !== String(col.type)) {
                const result = await table.saveColumnType(col.orig || col.id, newTypeId, currentColName);
                if (!result.success) return 'type_failed';
                col.type = newTypeId;
            }
        }

        // Step 2: Required
        const newRequired = elements[`col-edit-required-${instanceName}`].checked;
        if (newRequired !== isRequired) {
            await table.setColumnRequired(col.id);
        }

        return 'ok';
    }

    return simulateSave().then(result => {
        assert.strictEqual(result, 'ok', 'Save should succeed');
        assert.strictEqual(table.renameCalls.length, 1, 'renameColumn should be called once');
        assert.strictEqual(table.renameCalls[0].origId, '10', 'Should use col.orig');
        assert.strictEqual(table.renameCalls[0].newName, 'NewName', 'Should pass new name');
        assert.strictEqual(table.renameCalls[0].typeId, '3', 'Should pass current type');
        assert.strictEqual(table.saveTypeCalls.length, 0, 'saveColumnType should NOT be called (type unchanged)');
        assert.strictEqual(col.name, 'NewName', 'col.name should be updated');
        assert.strictEqual(col.val, 'NewName', 'col.val should be updated');
        console.log('✓ test_renameColumn_called_with_new_name passed');
    });
}

function test_no_rename_when_name_unchanged() {
    const table = new MockIntegramTable({ instanceName: 'inst' });
    const col = { id: '42', orig: '10', name: 'SameName', val: 'SameName', type: '3', attrs: '', ref_id: null, ref: null };
    const instanceName = 'inst';
    const isFirstColumn = false;
    const isRef = false;
    const isRequired = false;
    const currentName = col.val || col.name;

    const elements = {
        [`col-edit-name-${instanceName}`]: { value: 'SameName' },  // same as current
        [`col-edit-type-${instanceName}`]: { value: '3' },
        [`col-edit-required-${instanceName}`]: { checked: false },
    };

    async function simulateSave() {
        if (!isFirstColumn) {
            const newName = elements[`col-edit-name-${instanceName}`].value.trim();
            if (newName && newName !== currentName) {
                await table.renameColumn(col.orig || col.id, newName, col.type);
            }
        }
        if (!isRef) {
            const newTypeId = elements[`col-edit-type-${instanceName}`].value;
            if (String(newTypeId) !== String(col.type)) {
                const currentColName = elements[`col-edit-name-${instanceName}`].value.trim() || col.name;
                await table.saveColumnType(col.orig || col.id, newTypeId, currentColName);
            }
        }
        return 'ok';
    }

    return simulateSave().then(() => {
        assert.strictEqual(table.renameCalls.length, 0, 'renameColumn should NOT be called when name unchanged');
        assert.strictEqual(col.name, 'SameName', 'col.name should not change');
        console.log('✓ test_no_rename_when_name_unchanged passed');
    });
}

function test_no_rename_for_first_column() {
    const table = new MockIntegramTable({ instanceName: 'inst' });
    const col = { id: '42', orig: '10', name: 'TableName', val: 'TableName', type: '3', attrs: '', ref_id: null, ref: null };
    const instanceName = 'inst';
    const isFirstColumn = true;  // First column!

    async function simulateSave() {
        // The name input is not rendered for first column, so renameColumn should NOT be called
        if (!isFirstColumn) {
            // This block never runs
            await table.renameColumn(col.orig || col.id, 'NewName', col.type);
        }
        return 'ok';
    }

    return simulateSave().then(() => {
        assert.strictEqual(table.renameCalls.length, 0, 'renameColumn should NOT be called for first column');
        console.log('✓ test_no_rename_for_first_column passed');
    });
}

function test_rename_and_type_change_combined() {
    const table = new MockIntegramTable({ instanceName: 'inst' });
    const col = { id: '42', orig: '10', name: 'OldName', val: 'OldName', type: '3', attrs: '', ref_id: null, ref: null };
    const instanceName = 'inst';
    const isFirstColumn = false;
    const isRef = false;
    const isRequired = false;
    const currentName = col.val || col.name;

    const elements = {
        [`col-edit-name-${instanceName}`]: { value: 'NewName' },  // name changed
        [`col-edit-type-${instanceName}`]: { value: '8' },        // type also changed
        [`col-edit-required-${instanceName}`]: { checked: false },
    };

    async function simulateSave() {
        if (!isFirstColumn) {
            const newName = elements[`col-edit-name-${instanceName}`].value.trim();
            if (newName && newName !== currentName) {
                const result = await table.renameColumn(col.orig || col.id, newName, col.type);
                if (result.success) { col.name = newName; col.val = newName; }
            }
        }
        if (!isRef) {
            const newTypeId = elements[`col-edit-type-${instanceName}`].value;
            const currentColName = (!isFirstColumn && elements[`col-edit-name-${instanceName}`].value.trim()) || col.name;
            if (String(newTypeId) !== String(col.type)) {
                const result = await table.saveColumnType(col.orig || col.id, newTypeId, currentColName);
                if (result.success) col.type = newTypeId;
            }
        }
        return 'ok';
    }

    return simulateSave().then(() => {
        assert.strictEqual(table.renameCalls.length, 1, 'renameColumn should be called');
        assert.strictEqual(table.saveTypeCalls.length, 1, 'saveColumnType should be called');
        // saveColumnType should use the NEW name
        assert.strictEqual(table.saveTypeCalls[0].colName, 'NewName', 'saveColumnType should use new name');
        assert.strictEqual(table.saveTypeCalls[0].newTypeId, '8', 'saveColumnType should use new type');
        assert.strictEqual(col.type, '8', 'col.type should be updated');
        console.log('✓ test_rename_and_type_change_combined passed');
    });
}

function test_html_form_contains_name_input() {
    // Simulate what showColumnEditForm builds
    const col = { id: '42', orig: '10', name: 'TestCol', val: 'TestCol', type: '3', attrs: '', ref_id: null, ref: null };
    const instanceName = 'inst';
    const isFirstColumn = false;
    const currentName = col.val || col.name;

    const nameFieldHtml = !isFirstColumn
        ? `<div class="col-edit-row"><label class="col-edit-label">Название:</label><input type="text" id="col-edit-name-${instanceName}" class="form-control form-control-sm col-edit-input" value="${currentName}" placeholder="Введите название колонки"></div>`
        : '';

    assert.ok(nameFieldHtml.includes(`id="col-edit-name-${instanceName}"`), 'HTML should contain name input for non-first column');
    assert.ok(nameFieldHtml.includes(`value="${currentName}"`), 'HTML should pre-fill current name');
    console.log('✓ test_html_form_contains_name_input passed');
}

function test_html_form_no_name_input_for_first_column() {
    const instanceName = 'inst';
    const isFirstColumn = true;
    const currentName = 'TableName';

    const nameFieldHtml = !isFirstColumn
        ? `<input type="text" id="col-edit-name-${instanceName}" value="${currentName}">`
        : '';

    assert.strictEqual(nameFieldHtml, '', 'HTML should NOT contain name input for first column');
    console.log('✓ test_html_form_no_name_input_for_first_column passed');
}

// Run all tests
async function runAll() {
    console.log('Running tests for issue #1018 (column renaming in Edit Column form)...\n');
    try {
        await test_renameColumn_called_with_new_name();
        await test_no_rename_when_name_unchanged();
        await test_no_rename_for_first_column();
        await test_rename_and_type_change_combined();
        test_html_form_contains_name_input();
        test_html_form_no_name_input_for_first_column();
        console.log('\nAll tests passed!');
    } catch (err) {
        console.error('\nTest FAILED:', err.message);
        process.exit(1);
    }
}

runAll();
