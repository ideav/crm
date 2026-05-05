const assert = require('assert');
const fs = require('fs');
const path = require('path');

global.window = {
    location: {
        pathname: '/demo/table/200',
        search: '?F_U=100'
    },
    INTEGRAM_DEBUG: false,
    testTable: {}
};
global.document = {
    activeElement: null,
    readyState: 'complete',
    querySelectorAll() {
        return [];
    }
};

const IntegramTable = require('../js/integram-table.js');

function createContainer() {
    return {
        innerHTML: '',
        querySelector() {
            return null;
        },
        querySelectorAll() {
            return [];
        }
    };
}

function createTable(overrides = {}) {
    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: {
            instanceName: 'testTable',
            parentId: '100'
        },
        settings: {
            truncateLongValues: false
        },
        columns: [],
        data: [],
        rawObjectData: [],
        objectTableId: '200',
        styleColumns: {},
        editableColumns: new Map(),
        parseAttrs() {
            return {};
        },
        getMetadataName(metadata) {
            return metadata.val || metadata.name || 'Items';
        },
        getDataSourceType() {
            return 'table';
        },
        formatSubordinateCellValue(value) {
            return this.escapeHtml(value == null ? '' : value);
        },
        highlightSearchTerm(value) {
            return value;
        },
        attachSubordinateRowDragHandlers() {},
        attachSubordinateScrollListener() {}
    }, overrides);
    return table;
}

function testModalSubordinateRows() {
    const table = createTable();
    const container = createContainer();
    const metadata = {
        val: 'Tasks',
        type: '3',
        reqs: [
            { id: '201', val: 'Status', type: '3', attrs: '' }
        ]
    };
    const rows = [
        { i: 501, u: 100, o: 1, r: ['Alpha', 'Open'] },
        { i: 502, u: 100, o: 2, r: ['Beta', 'Done'] }
    ];

    table.renderSubordinateTable(container, metadata, rows, '200', '100');

    assert(
        container.innerHTML.includes('data-row="0"'),
        'first subordinate row control cell should preserve zero-based data-row'
    );
    assert(
        container.innerHTML.includes('<span class="subordinate-row-number">1</span>'),
        'first subordinate row should render a visible one-based row number'
    );
    assert(
        container.innerHTML.includes('<span class="subordinate-row-number">2</span>'),
        'second subordinate row should render a visible one-based row number'
    );
    assert(
        /<td class="subordinate-drag-handle-td" data-row="0"><span class="subordinate-row-number">1<\/span><span class="subordinate-drag-handle"/.test(container.innerHTML),
        'row number should occupy the drag/edit control position until the control icon is shown'
    );
}

function testTableSourceSubordinateFirstColumn() {
    const table = createTable({
        columns: [
            { id: '200', name: 'Task', type: '3', paramId: '200' }
        ],
        data: [
            ['Alpha']
        ],
        rawObjectData: [
            { i: 501, u: 100, o: 1, r: ['Alpha'] }
        ],
        editableColumns: new Map([
            ['200', null]
        ])
    });

    const html = table.renderCell(table.columns[0], 'Alpha', 0, 0);

    assert(
        html.includes('data-row="0"'),
        'table-source subordinate first cell should retain zero-based data-row'
    );
    assert(
        html.includes('<span class="subordinate-row-number subordinate-row-number-with-edit-icon">1</span>'),
        'table-source subordinate first column should show row number beside the hidden edit icon'
    );
    assert(
        html.includes('class="edit-icon"'),
        'existing edit icon should still render for editable first column cells'
    );
}

function testCssRules() {
    const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'integram-table.css'), 'utf8');

    assert(
        css.includes('.subordinate-row-number'),
        'CSS should style subordinate row numbers'
    );
    assert(
        css.includes('.subordinate-table tbody tr:hover .subordinate-drag-handle-td .subordinate-row-number'),
        'CSS should hide modal subordinate row numbers when the row control icon is visible'
    );
    assert(
        css.includes('.editable-cell:hover .subordinate-row-number-with-edit-icon'),
        'CSS should hide table-source row numbers when the edit icon is visible'
    );
}

testModalSubordinateRows();
testTableSourceSubordinateFirstColumn();
testCssRules();

console.log('PASS issue-2372 subordinate row number checks');
