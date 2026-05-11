/**
 * Test for issue #2526: js/integram-table.js — refresh metadata when columns
 * change while a table is in use.
 *
 * The table caches metadata (column definitions) when first opened. If another
 * user adds or removes a column on the server, subsequent data responses
 * include a different number of values in the row's `r` array than the cached
 * columns expect. The expected behavior is:
 *   1. Detect the mismatch (any row's `r.length !== columns.length`).
 *   2. Invalidate the metadata cache.
 *   3. Re-fetch metadata so columns match the fresh response.
 *
 * This test exercises the detection helper (hasRowColumnCountMismatch),
 * the cache invalidator (invalidateMetadataCache), and the end-to-end flow in
 * loadDataFromTable.
 *
 * Run with: node experiments/test-issue-2526-metadata-refresh-on-mismatch.js
 */

const fs = require('fs');
const path = require('path');

// Stub the browser globals used inside the IntegramTable class
global.window = { grants: { '1': 'WRITE' }, location: { hostname: 'localhost', pathname: '/db/' , search: '' }, _integramTableInstances: [] };
global.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    readyState: 'complete',
    addEventListener: () => {}
};
global.URLSearchParams = require('url').URLSearchParams;
global.parseIntegramAttrs = (attrs) => ({}); // attrs parser stub for buildColumnFromMetadataReq

// Load the built bundle and expose the IntegramTable class.
// The bundle uses a top-level IIFE that defines `class IntegramTable` — eval it
// in a controlled scope so we can grab the class.
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');

// The bundle wraps the class in an immediately-invoked function. We extract the
// class definition by appending an export hook.
const wrapped = source + '\nglobal.IntegramTable = IntegramTable;';
try {
    new Function(wrapped)();
} catch (e) {
    console.error('Failed to load integram-table.js:', e.message);
    process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log('  PASS:', msg);
        passed++;
    } else {
        console.log('  FAIL:', msg);
        failed++;
    }
}

// Build a stub instance without going through the constructor (it touches DOM).
function makeStub() {
    const t = Object.create(global.IntegramTable.prototype);
    t.columns = [];
    t.metadataCache = {};
    t.metadataFetchPromises = {};
    t.globalMetadata = null;
    t.globalMetadataPromise = null;
    return t;
}

console.log('=== Test issue #2526: metadata refresh on row column count mismatch ===\n');

// --- Test 1: hasRowColumnCountMismatch detects a wider row ---
{
    console.log('Test 1: detects extra column in response');
    const t = makeStub();
    t.columns = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]; // 5 cols
    const dataArray = [{ i: 1, u: 1, o: 1, r: ['a', 'b', 'c', 'd', 'e', 'f'] }];   // 6 values
    assert(t.hasRowColumnCountMismatch(dataArray) === true,
        'returns true when r is longer than columns');
}

// --- Test 2: hasRowColumnCountMismatch detects a narrower row ---
{
    console.log('Test 2: detects missing column in response');
    const t = makeStub();
    t.columns = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }];
    const dataArray = [{ i: 1, u: 1, o: 1, r: ['a', 'b', 'c'] }];
    assert(t.hasRowColumnCountMismatch(dataArray) === true,
        'returns true when r is shorter than columns');
}

// --- Test 3: hasRowColumnCountMismatch returns false on match ---
{
    console.log('Test 3: returns false when r matches columns');
    const t = makeStub();
    t.columns = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const dataArray = [
        { i: 1, u: 1, o: 1, r: ['a', 'b', 'c'] },
        { i: 2, u: 1, o: 1, r: ['d', 'e', 'f'] }
    ];
    assert(t.hasRowColumnCountMismatch(dataArray) === false,
        'returns false when row width equals column count');
}

// --- Test 4: empty array does not flag a mismatch ---
{
    console.log('Test 4: empty data array returns false');
    const t = makeStub();
    t.columns = [{ id: '1' }];
    assert(t.hasRowColumnCountMismatch([]) === false,
        'returns false for empty data');
}

// --- Test 5: no cached columns returns false (nothing to compare to) ---
{
    console.log('Test 5: no cached columns returns false');
    const t = makeStub();
    t.columns = [];
    const dataArray = [{ i: 1, u: 1, o: 1, r: ['a', 'b'] }];
    assert(t.hasRowColumnCountMismatch(dataArray) === false,
        'returns false when columns are not yet loaded');
}

// --- Test 6: invalidateMetadataCache clears caches and columns ---
{
    console.log('Test 6: invalidateMetadataCache clears caches');
    const t = makeStub();
    t.metadataCache = { 443296: { foo: 1 } };
    t.metadataFetchPromises = { 443296: Promise.resolve() };
    t.globalMetadata = [{ id: 1 }];
    t.globalMetadataPromise = Promise.resolve();
    t.columns = [{ id: '1' }, { id: '2' }];

    t.invalidateMetadataCache();

    assert(Object.keys(t.metadataCache).length === 0, 'metadataCache cleared');
    assert(Object.keys(t.metadataFetchPromises).length === 0, 'metadataFetchPromises cleared');
    assert(t.globalMetadata === null, 'globalMetadata cleared');
    assert(t.globalMetadataPromise === null, 'globalMetadataPromise cleared');
    assert(t.columns.length === 0, 'columns cleared');
}

// --- Test 7: Issue scenario — old row had 5 cols, new row has 6 ---
{
    console.log('Test 7: real issue scenario (5-col rows then 6-col rows)');
    const t = makeStub();
    // Simulate the state after the first load: 4 reqs + main = 5 columns
    t.columns = [
        { id: '443296' }, // main "Значение GS"
        { id: '445204' }, // Дата
        { id: '445205' }, // Строка бюджета
        { id: '445206' }, // Колонка группы
        { id: '443561' }  // Обновлено
    ];
    // First request, old data, 5 values per row
    const oldData = [{ i: 445209, u: 1, o: 1, r: ['38', '31.03.2026', '2331:...', '1127:...', '74548746858'] }];
    assert(t.hasRowColumnCountMismatch(oldData) === false,
        'no mismatch when row matches cached columns');

    // Now metadata changed on the server — 6 values per row
    const newData = [{ i: 449192, u: 1, o: 1, r: ['84', '30.04.2026', '2355:...', '1126:...', '10', '1778493414'] }];
    assert(t.hasRowColumnCountMismatch(newData) === true,
        'mismatch detected when an extra value appears in the row');
}

// --- Test 8: loadDataFromTable triggers metadata re-fetch on mismatch ---
{
    console.log('Test 8: loadDataFromTable re-fetches metadata and rebuilds columns');
    (async () => {
        const t = makeStub();
        t.options = { tableTypeId: '443296', apiUrl: '/db/object/443296/?JSON_OBJ', pageSize: 20 };
        t.objectTableId = '443296';
        t.filters = {};
        t.sortColumn = null;
        t.sortDirection = null;
        t.loadedRecords = 0;
        t.groupingEnabled = false;
        t.groupingColumns = [];
        t.tableExportAllowed = false;
        t.tableGranted = 'WRITE';
        t.urlFilters = {};
        t.overriddenUrlParams = new Set();

        // Pre-populate stale 5-column metadata
        t.columns = [
            { id: '443296' }, { id: '445204' }, { id: '445205' }, { id: '445206' }, { id: '443561' }
        ];

        // Track metadata fetch invocations
        let fetchMetadataCalls = 0;
        t.fetchMetadata = async (typeId) => {
            fetchMetadataCalls++;
            // Return new 6-column metadata
            return {
                id: '443296', val: 'Значение GS', type: '8', granted: 'WRITE', export: '1',
                reqs: [
                    { num: 1, id: '445204', val: 'Дата', orig: '155', type: '9' },
                    { num: 2, id: '445205', val: 'Строка бюджета', orig: '1040', type: '3', ref: '1040', ref_id: '1041' },
                    { num: 3, id: '445206', val: 'Колонка группы', orig: '1102', type: '3', ref: '1102', ref_id: '1103' },
                    { num: 4, id: '443560', val: 'Новое поле', orig: '443560', type: '3' },
                    { num: 5, id: '443561', val: 'Обновлено', orig: '443560', type: '4' }
                ]
            };
        };

        // Stub fetch() to return a 6-column row
        global.fetch = async (url) => ({
            ok: true,
            json: async () => [{ i: 449192, u: 1, o: 1, r: ['84', '30.04.2026', '2355', '1126', '10', '1778493414'] }]
        });

        const result = await t.loadDataFromTable(false);

        assert(fetchMetadataCalls === 1,
            'fetchMetadata was called exactly once to refresh stale metadata');
        assert(t.columns.length === 6,
            `columns rebuilt to 6 entries (got ${t.columns.length})`);
        assert(result.rows.length === 1 && result.rows[0].length === 6,
            'row data uses the refreshed 6-column shape');

        console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
        process.exit(failed > 0 ? 1 : 0);
    })().catch(err => { console.error('Test 8 error:', err); process.exit(1); });
}
