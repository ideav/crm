/**
 * Test for issue #2129: infinite-scroll append must preserve the table scroll
 * offset when render() replaces .integram-table-container.
 */

const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

function createScrollContainer(scrollTop, scrollLeft) {
    return {
        scrollTop,
        scrollLeft,
        clientHeight: 320,
        scrollHeight: 1200,
        getBoundingClientRect: () => ({ bottom: 500 })
    };
}

async function runTest() {
    global.window = {
        scrollY: 0,
        scrollX: 0,
        innerHeight: 800,
        scrollTo: () => {
            throw new Error('window scroll should not be used when table container exists');
        },
        INTEGRAM_DEBUG: false
    };
    global.document = {
        documentElement: { scrollHeight: 1200 },
        querySelector: () => null
    };

    const table = Object.create(IntegramTable.prototype);
    table._scrollContainer = createScrollContainer(420, 37);
    table.container = {
        querySelector: (selector) => {
            if (selector === '.integram-table-container') return table._scrollContainer;
            return null;
        }
    };
    table.isLoading = false;
    table.hasMore = true;
    table.pendingNewRow = null;
    table.data = [[1], [2], [3]];
    table.rawObjectData = [];
    table.loadedRecords = 3;
    table.totalRows = null;
    table.options = { pageSize: 3, onDataLoad: null };
    table.columns = [{ id: 'name' }];
    table.columnOrder = ['name'];
    table.visibleColumns = ['name'];
    table.idColumns = new Set();
    table.urlFilters = {};
    table.groupingEnabled = false;
    table.groupingColumns = [];
    table.getDataSourceType = () => 'report';
    table.loadDataFromReport = async () => ({
        rows: [[4], [5]],
        rawData: [],
        columns: [{ id: 'name' }]
    });
    table.processColumnVisibility = () => {};
    table.parseUrlFiltersFromParams = () => {};
    table.checkAndLoadMore = () => {};
    table.render = () => {
        table._scrollContainer = createScrollContainer(0, 0);
    };

    await table.loadData(true);

    assert.strictEqual(table.loadedRecords, 5, 'append path should still append new rows');
    assert.strictEqual(table._scrollContainer.scrollTop, 420, 'vertical scroll offset should survive append render');
    assert.strictEqual(table._scrollContainer.scrollLeft, 37, 'horizontal scroll offset should survive append render');
    console.log('ok - append render preserves table scroll position');
}

runTest().catch(error => {
    console.error(error);
    process.exit(1);
});
