/**
 * Test for issue #2824: deleting a column and immediately re-creating it shows an
 * empty "Настройки колонок таблицы" (column settings) form instead of the columns.
 *
 * Root cause: loadData() returns an immediate no-op when this.isLoading is true.
 * The column delete path (refreshCurrentTableAfterDelete) and the column-edit save
 * path both call closeColumnSettings() — which fires an un-awaited loadData(false)
 * when _columnSettingsChanged is true — right before doing `await this.loadData(...)`.
 * The awaited call short-circuits because a load is already in flight, so the code
 * (and the reopened column-settings modal) runs while this.columns is still [].
 *
 * This test exercises the REAL loadData() implementation. It clears columns (as the
 * delete/save paths do), starts a background refresh (as closeColumnSettings does),
 * then awaits a second loadData(false). After the await, columns MUST be rebuilt.
 *
 * Run with: node experiments/test-issue-2824-column-settings-empty-race.js
 */

const assert = require('assert');

global.window = { location: { search: '' }, requestAnimationFrame: null };
global.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
};

const IntegramTable = require('../js/integram-table.js');

function makeTable() {
    const table = Object.create(IntegramTable.prototype);
    let loadCalls = 0;
    Object.assign(table, {
        isLoading: false,
        hasMore: false,
        pendingNewRow: false,
        columns: [],
        data: [],
        rawObjectData: [],
        loadedRecords: 0,
        totalRows: null,
        visibleColumns: [],
        columnOrder: [],
        idColumns: new Set(),
        urlFilters: {},
        filters: {},
        groupingEnabled: false,
        groupingColumns: [],
        options: { pageSize: 20 },
        sortColumn: null,
        sortDirection: null,
        // Stubs for the bits loadData() touches that we don't care about here
        beginRequest() {},
        endRequest() {},
        getDataSourceType() { return 'table'; },
        processColumnVisibility() {},
        processGroupedData() {},
        parseUrlFiltersFromParams() {},
        render() {},
        captureScrollState() { return null; },
        restoreScrollState() {},
        checkAndLoadMore() {},
        handleLoadDataError(err) { throw err; },
        // Slow loader that rebuilds the two columns (Марка + Синоним), like the server would
        async loadDataFromTable() {
            loadCalls += 1;
            await new Promise(resolve => setTimeout(resolve, 25));
            const columns = [
                { id: '100', name: 'Марка' },
                { id: '101', name: 'Синоним' }
            ];
            this.columns = columns;
            return { columns, rows: [], rawData: [] };
        },
        _loadCallCount() { return loadCalls; }
    });
    return table;
}

async function run() {
    const table = makeTable();

    // Sanity: a single awaited refresh rebuilds columns.
    await table.loadData(false);
    assert.strictEqual(table.columns.length, 2, 'baseline: awaited loadData should rebuild columns');

    // Reproduce the race that produces the empty column-settings form.
    // 1. Column delete / save path clears columns.
    table.columns = [];
    // 2. closeColumnSettings() fires an un-awaited refresh when _columnSettingsChanged.
    const backgroundRefresh = table.loadData(false);
    // 3. refreshCurrentTableAfterDelete / save path awaits its own reload.
    await table.loadData(false);

    // After the awaited reload returns, the column-settings modal is (re)built from
    // this.columns. It MUST contain the rebuilt columns — otherwise the form is empty.
    assert.strictEqual(
        table.columns.length,
        2,
        'after awaiting loadData(false), columns must be rebuilt (issue #2824: empty column-settings form)'
    );

    await backgroundRefresh;
    assert.strictEqual(table.columns.length, 2, 'columns remain after the background refresh resolves');

    // Now mirror refreshCurrentTableAfterDelete() exactly, using the REAL
    // closeColumnSettings(): with _columnSettingsChanged = true it fires an
    // un-awaited loadData(false), and the delete path then awaits its own reload.
    const table2 = makeTable();
    await table2.loadData(false); // initial load -> 2 columns

    table2._columnSettingsChanged = true; // user had toggled/created a column earlier
    table2.columns = [];                  // refreshCurrentTableAfterDelete clears columns
    table2.closeColumnSettings();         // fires loadData(false) because _columnSettingsChanged
    await table2.loadData(false);         // the awaited reload the delete path relies on

    assert.strictEqual(
        table2.columns.length,
        2,
        'refreshCurrentTableAfterDelete: columns must be rebuilt after the awaited reload (issue #2824)'
    );
    assert.strictEqual(
        table2._columnSettingsChanged,
        false,
        'closeColumnSettings() should reset the changed flag'
    );

    console.log('PASS issue-2824: awaited loadData waits for in-flight refresh; columns rebuilt, no empty form');
}

run().catch((error) => {
    console.error('FAIL issue-2824:', error.message);
    process.exit(1);
});
