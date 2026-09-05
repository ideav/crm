/*
 * Test for issue #3037: selecting rows with .checkbox-column-cell must not
 * reset the vertically scrolled .integram-table-container to the top.
 *
 * The checkbox handlers live in attachEventListeners(). A full render replaces
 * the table container, so selection renders must go through renderPreservingScroll().
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '07-inline-edit.js'),
    'utf8'
);
const bulkExportSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '23-bulk-export.js'),
    'utf8'
);

function extractMethod(name) {
    const re = new RegExp(`(?:^|\\n)        ${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = moduleSource.match(re);
    if (!match) throw new Error(`Could not find method ${name}`);
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < moduleSource.length; i++) {
        const ch = moduleSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return moduleSource.slice(match.index + 1, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

const Host = new Function(`
    class Host {
        constructor(opts) { Object.assign(this, opts); }
        ${extractMethod('attachEventListeners')}
    }
    return Host;
`)();

class FakeCheckbox {
    constructor({ checked = false, rowIndex = null } = {}) {
        this.checked = checked;
        this.dataset = {};
        this.handlers = {};
        if (rowIndex !== null) this.dataset.rowIndex = String(rowIndex);
    }

    addEventListener(type, handler) {
        this.handlers[type] = handler;
    }

    change(checked) {
        this.checked = checked;
        this.handlers.change({ target: this });
    }
}

class FakeContainer {
    constructor({ tableContainer, selectAll, rowCheckboxes }) {
        this.tableContainer = tableContainer;
        this.selectAll = selectAll;
        this.rowCheckboxes = rowCheckboxes;
        this.handlers = {};
    }

    addEventListener(type, handler) {
        this.handlers[type] = handler;
    }

    querySelector(selector) {
        if (selector === '.row-select-all') return this.selectAll;
        if (selector === '.integram-table-container') return this.tableContainer;
        return null;
    }

    querySelectorAll(selector) {
        if (selector === '.row-select-checkbox') return this.rowCheckboxes;
        return [];
    }
}

function makeTable() {
    const tableContainer = { scrollTop: 380, scrollLeft: 42 };
    const selectAll = new FakeCheckbox();
    const rowCheckbox = new FakeCheckbox({ rowIndex: 3 });
    const container = new FakeContainer({
        tableContainer,
        selectAll,
        rowCheckboxes: [rowCheckbox],
    });

    const table = new Host({
        container,
        checkboxMode: true,
        selectedRows: new Set(),
        data: Array.from({ length: 12 }, (_, i) => [`row-${i}`]),
        rawObjectData: Array.from({ length: 12 }, (_, i) => ({ i: 'record-' + i, r: ['row-' + i] })),
        columns: [{ id: 'name' }],
        columnOrder: ['name'],
        visibleColumns: ['name'],
        editableColumns: new Set(),
        filters: {},
        currentEditingCell: null,
        options: {},
        getRowSelectionKey(rowIndex) {
            const rawItem = this.rawObjectData[rowIndex];
            return rawItem ? String(rawItem.i) : null;
        },
        getSelectableRowKeys() {
            return this.rawObjectData.map(rawItem => String(rawItem.i));
        },
        renderCalls: 0,
        preservingRenderCalls: 0,
        getScrollContainer() {
            return tableContainer;
        },
        captureScrollState() {
            return {
                isWindow: false,
                scrollTop: tableContainer.scrollTop,
                scrollLeft: tableContainer.scrollLeft,
            };
        },
        restoreScrollState(state) {
            tableContainer.scrollTop = state.scrollTop;
            tableContainer.scrollLeft = state.scrollLeft;
        },
        render() {
            this.renderCalls++;
            tableContainer.scrollTop = 0;
            tableContainer.scrollLeft = 0;
        },
        renderPreservingScroll(renderFn) {
            this.preservingRenderCalls++;
            const state = this.captureScrollState();
            renderFn();
            this.restoreScrollState(state);
        },
    });

    table.attachEventListeners();

    return { table, tableContainer, selectAll, rowCheckbox };
}

function testRowCheckboxPreservesScroll() {
    const { table, tableContainer, rowCheckbox } = makeTable();

    rowCheckbox.change(true);

    assert(table.selectedRows.has('record-3'), 'row checkbox should select the clicked record ID');

    // A sort may move the selected record to another position. Selection must
    // follow the record ID and never transfer to whatever now occupies index 3.
    [table.rawObjectData[3], table.rawObjectData[4]] = [table.rawObjectData[4], table.rawObjectData[3]];
    assert(!table.selectedRows.has(table.getRowSelectionKey(3)), 'selection must not transfer to the new row at the old index');
    assert(table.selectedRows.has(table.getRowSelectionKey(4)), 'selection must follow the same record after reorder');

    assert.strictEqual(tableContainer.scrollTop, 380, 'row checkbox must preserve vertical scroll');
    assert.strictEqual(tableContainer.scrollLeft, 42, 'row checkbox must preserve horizontal scroll');
    assert.strictEqual(table.preservingRenderCalls, 1, 'row checkbox render should preserve scroll');
}

function testSelectAllPreservesScroll() {
    const { table, tableContainer, selectAll } = makeTable();

    selectAll.change(true);

    assert.strictEqual(table.selectedRows.size, 12, 'select-all should select every loaded row');
    assert.strictEqual(tableContainer.scrollTop, 380, 'select-all must preserve vertical scroll');
    assert.strictEqual(tableContainer.scrollLeft, 42, 'select-all must preserve horizontal scroll');
    assert.strictEqual(table.preservingRenderCalls, 1, 'select-all render should preserve scroll');
}

testRowCheckboxPreservesScroll();
testSelectAllPreservesScroll();

assert(!bulkExportSource.includes('selectedIndices'),
    'bulk delete must not translate selected row positions into record IDs');
assert(bulkExportSource.includes('rawItemsById.get(String(selectedId))'),
    'bulk delete must resolve the selected stable record IDs');

console.log('PASS issue-3037 checkbox selection preserves table scroll and record identity');
