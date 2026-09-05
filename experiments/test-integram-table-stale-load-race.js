/**
 * A refresh requested while a previous load is in flight must invalidate the
 * older response, coalesce repeated refreshes, and render only the latest state.
 *
 * Run with: node experiments/test-integram-table-stale-load-race.js
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

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeTable() {
    const table = Object.create(IntegramTable.prototype);
    const requests = [];
    const renders = [];
    const errors = [];

    Object.assign(table, {
        isLoading: false,
        _loadDataPromise: null,
        _loadRequestVersion: 0,
        _reloadQueued: false,
        hasMore: true,
        pendingNewRow: false,
        metadataStale: false,
        columns: [],
        data: [],
        rawObjectData: [],
        selectedRows: new Set(),
        loadedRecords: 0,
        totalRows: null,
        visibleColumns: [],
        columnOrder: [],
        idColumns: new Set(),
        urlFilters: {},
        filters: { q: { type: '^', value: 'old' } },
        groupingEnabled: false,
        groupingColumns: [],
        options: {
            pageSize: 20,
            title: '',
            onDataLoad(json) { renders.push('callback:' + json.rows[0][0]); }
        },
        sortColumn: null,
        sortDirection: null,
        beginRequest() {},
        endRequest() {},
        getDataSourceType() { return 'report'; },
        processColumnVisibility() {},
        processGroupedData() {},
        parseUrlFiltersFromParams() {},
        captureScrollState() { return null; },
        restoreScrollState() {},
        checkAndLoadMore() {},
        render() { renders.push('render:' + (this.data[0] ? this.data[0][0] : 'empty')); },
        handleLoadDataError(error) { errors.push(error.message); },
        loadDataFromReport() {
            const request = deferred();
            request.filter = this.filters.q.value;
            requests.push(request);
            return request.promise;
        },
        _requests: requests,
        _renders: renders,
        _errors: errors
    });

    return table;
}

async function waitFor(predicate) {
    for (let i = 0; i < 20; i++) {
        if (predicate()) return;
        await new Promise(resolve => setImmediate(resolve));
    }
    throw new Error('Timed out waiting for queued load');
}

async function testStaleSuccess() {
    const table = makeTable();
    const firstLoad = table.loadData(false);
    assert.strictEqual(table._requests.length, 1);
    assert.strictEqual(table._requests[0].filter, 'old');

    table.filters.q.value = 'new';
    const latestLoad = table.loadData(false);
    table.loadData(false); // another refresh is coalesced into the same queued pass

    table._requests[0].resolve({ columns: [{ id: 'q' }], rows: [['old']] });
    await waitFor(() => table._requests.length === 2);

    assert.deepStrictEqual(table.data, [], 'stale response must not replace table data');
    assert.deepStrictEqual(table._renders, [], 'stale response must not render or call onDataLoad');
    assert.strictEqual(table._requests[1].filter, 'new');

    table._requests[1].resolve({ columns: [{ id: 'q' }], rows: [['new']] });
    await Promise.all([firstLoad, latestLoad]);

    assert.deepStrictEqual(table.data, [['new']]);
    assert.deepStrictEqual(table._renders, ['callback:new', 'render:new']);
    assert.strictEqual(table._requests.length, 2, 'repeated refreshes must be coalesced');
    assert.strictEqual(table._loadDataPromise, null);
    assert.strictEqual(table.isLoading, false);
}

async function testStaleFailure() {
    const table = makeTable();
    const firstLoad = table.loadData(false);
    table.filters.q.value = 'new';
    const latestLoad = table.loadData(false);

    table._requests[0].reject(new Error('old request failed'));
    await waitFor(() => table._requests.length === 2);
    assert.deepStrictEqual(table._errors, [], 'failure from an obsolete request must stay hidden');
    assert.strictEqual(table.hasMore, true, 'obsolete failure must not disable pagination');

    table._requests[1].resolve({ columns: [{ id: 'q' }], rows: [['new']] });
    await Promise.all([firstLoad, latestLoad]);
    assert.deepStrictEqual(table.data, [['new']]);
    assert.deepStrictEqual(table._errors, []);
}

Promise.resolve()
    .then(testStaleSuccess)
    .then(testStaleFailure)
    .then(() => console.log('PASS stale loads are discarded and latest refresh wins'))
    .catch(error => {
        console.error('FAIL stale-load race:', error);
        process.exit(1);
    });