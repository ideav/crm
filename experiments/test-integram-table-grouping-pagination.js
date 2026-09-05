/**
 * Grouping must consume every matching row in bounded pages and keep raw record
 * IDs aligned with rows after the grouped sort changes their order.
 */

const assert = require('assert');

global.window = { location: { search: '', pathname: '/demo/report/1' }, requestAnimationFrame: null };
global.document = {
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
};

const IntegramTable = require('../js/integram-table.js');

function makeRows(count) {
    const groups = ['C', 'A', 'B'];
    return Array.from({ length: count }, (_, index) => [groups[index % groups.length], String(index)]);
}

async function run() {
    const sourceRows = makeRows(2505);
    const sourceRaw = sourceRows.map(row => ({ i: row[1], r: row }));
    const requests = [];
    let renders = 0;
    let callbacks = 0;
    const columns = [
        { id: 'group', name: 'Group', format: 'SHORT' },
        { id: 'record', name: 'Record', format: 'SHORT' }
    ];

    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        isLoading: false,
        _loadDataPromise: null,
        _loadRequestVersion: 0,
        _reloadQueued: false,
        pendingNewRow: false,
        metadataStale: false,
        columns: [],
        data: [],
        rawObjectData: [],
        selectedRows: new Set(),
        loadedRecords: 0,
        totalRows: null,
        hasMore: true,
        visibleColumns: [],
        columnOrder: [],
        idColumns: new Set(),
        urlFilters: {},
        filters: {},
        groupingEnabled: true,
        groupingColumns: ['group'],
        groupedData: [],
        options: {
            apiUrl: '/demo/report/1',
            pageSize: 20,
            title: '',
            onDataLoad() { callbacks += 1; }
        },
        sortColumn: null,
        sortDirection: null,
        beginRequest() {},
        endRequest() {},
        appendPageUrlParams() {},
        processColumnVisibility() {},
        parseUrlFiltersFromParams() {},
        parseReferenceDisplayValue(value) { return value == null ? '' : String(value); },
        captureScrollState() { return null; },
        restoreScrollState() {},
        checkAndLoadMore() {},
        render() { renders += 1; },
        async fetchJson(url) {
            const parsed = new URL(String(url), 'https://example.test');
            const [offset, limit] = parsed.searchParams.get('LIMIT').split(',').map(Number);
            requests.push({ offset, limit });
            const pageRows = sourceRows.slice(offset, offset + limit);
            const pageRaw = sourceRaw.slice(offset, offset + limit);
            // Exercise the report loader's column-to-row transformation while
            // preserving raw IDs as JSON_OBJ-like metadata for the alignment check.
            return {
                columns,
                data: [pageRows.map(row => row[0]), pageRows.map(row => row[1])],
                _rawForTest: pageRaw
            };
        }
    });

    // Preserve raw data in the shape returned by the real JSON_OBJ parser. The
    // report loader normally has no rawData, so wrap it only for this integration test.
    const realReportLoader = table.loadDataFromReport.bind(table);
    table.loadDataFromReport = async append => {
        const result = await realReportLoader(append);
        const last = requests[requests.length - 1];
        result.rawData = sourceRaw.slice(last.offset, last.offset + last.limit);
        return result;
    };

    await table.loadData(false);

    assert.deepStrictEqual(requests, [
        { offset: 0, limit: 1001 },
        { offset: 1000, limit: 1001 },
        { offset: 2000, limit: 1001 }
    ]);
    assert.strictEqual(table.data.length, 2505, 'rows beyond the former 1,000-row cap are loaded');
    assert.strictEqual(table.loadedRecords, 2505);
    assert.strictEqual(table.totalRows, 2505);
    assert.strictEqual(table.hasMore, false);
    assert.strictEqual(renders, 1, 'partial grouped pages are not rendered');
    assert.strictEqual(callbacks, 1, 'onDataLoad is called only for the complete grouped result');
    assert.strictEqual(table.groupedData.length, 2505);
    assert.strictEqual(table.groupedData[0].groupCells[0].rowspan, 835);

    for (let index = 0; index < table.data.length; index++) {
        assert.strictEqual(
            String(table.rawObjectData[index].i),
            table.data[index][1],
            `raw record ID stays aligned at sorted row ${ index }`
        );
    }

    await testMetadataObjectPagingOffset();

    console.log('PASS grouping loads all pages and preserves row identity after sorting');
}

async function testMetadataObjectPagingOffset() {
    const table = Object.create(IntegramTable.prototype);
    let requestedUrl = '';
    Object.assign(table, {
        options: { apiUrl: '/demo/metadata/18', pageSize: 20, title: '', parentId: null, recordId: null },
        groupingEnabled: true,
        groupingColumns: ['18'],
        loadedRecords: 1000,
        filters: {},
        sortColumn: null,
        sortDirection: null,
        tableGranted: 'READ',
        metadataCache: {},
        getApiBase() { return '/demo'; },
        getPageUrlParams() { return new URLSearchParams(); },
        async fetchJson(url) {
            requestedUrl = String(url);
            return [];
        }
    });

    await table.parseObjectFormat({ id: '18', type: '3', val: 'Thing', reqs: [], granted: 'READ' }, true);
    const parsed = new URL(requestedUrl, 'https://example.test');
    assert.strictEqual(parsed.searchParams.get('LIMIT'), '1000,1001');
}
run().catch(error => {
    console.error('FAIL grouping pagination:', error);
    process.exit(1);
});