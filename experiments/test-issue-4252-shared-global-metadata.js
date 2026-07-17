/**
 * Issue #4252: a page with several `data-integram-table` components fired one
 * identical `/metadata` request per table (6 tables → 6 × 14.9 kB). The global
 * metadata is the same for every table in a database, so it must be fetched
 * ONCE and shared across all IntegramTable instances on the page.
 *
 * This test loads the REAL built bundle (js/integram-table.js) and drives the
 * real loadGlobalMetadata()/fetchMetadata()/clearSharedGlobalMetadata() across
 * several instances, counting how many /metadata requests actually hit the wire.
 *
 * Run: node experiments/test-issue-4252-shared-global-metadata.js
 */

const assert = require('assert');

global.window = {
    location: { hostname: 'example.test', pathname: '/crm/', search: '' }
};
global.document = { querySelectorAll: () => [], addEventListener: () => {} };

const IntegramTable = require('../js/integram-table.js');

const METADATA = [
    { id: '988', up: '0', type: '3', val: 'Строка', granted: 'WRITE', reqs: [] },
    { id: '997', up: '0', type: '8', val: 'Панель', granted: 'WRITE', reqs: [
        { num: 1, id: '8019', val: 'Примечание', orig: '35', type: '12' }
    ] }
];

function jsonResponse(body) {
    return { ok: true, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body) };
}

// Fetch mock: records every URL so we can count /metadata hits.
let calls = [];
global.fetch = async function (url) {
    const u = String(url);
    calls.push(u);
    // Tiny async delay so concurrent callers genuinely overlap in-flight.
    await new Promise(r => setTimeout(r, 10));
    if (/\/metadata$/.test(u)) return jsonResponse(METADATA);
    if (/\/metadata\/\d+$/.test(u)) {
        // Per-type metadata endpoint — reaching here means the shared cache MISSED.
        const id = u.match(/\/metadata\/(\d+)$/)[1];
        return jsonResponse(METADATA.find(m => m.id === id) || {});
    }
    throw new Error('Unexpected fetch URL: ' + u);
};

function makeInstance(apiUrl) {
    const t = Object.create(IntegramTable.prototype);
    Object.assign(t, {
        options: { apiUrl },
        columns: [],
        globalMetadata: null,
        globalMetadataPromise: null,
        metadataCache: {},
        metadataFetchPromises: {}
    });
    return t;
}

function resetSharedCache() {
    IntegramTable._sharedGlobalMetadata = {};
    IntegramTable._sharedGlobalMetadataPromises = {};
    calls = [];
}

function metadataCalls() {
    return calls.filter(u => /\/metadata$/.test(u)).length;
}

async function run() {
    let passed = 0;

    // --- Test 1: N tables on the same page → exactly ONE /metadata request ---
    {
        resetSharedCache();
        // Six tables, all in database /crm (this is the screenshot scenario).
        const tables = ['988', '997', '988', '997', '988', '997']
            .map(id => makeInstance('/crm/metadata/' + id));

        // init() would set globalMetadataPromise = loadGlobalMetadata(); mirror that,
        // and fire them concurrently (autoInitTables creates them in one tick).
        await Promise.all(tables.map(t => {
            t.globalMetadataPromise = t.loadGlobalMetadata();
            return t.globalMetadataPromise;
        }));

        assert.strictEqual(metadataCalls(), 1,
            `expected 1 /metadata request for 6 tables, got ${metadataCalls()} (${JSON.stringify(calls)})`);
        // Every instance must actually have the metadata after awaiting its own promise.
        tables.forEach((t, i) => assert.ok(Array.isArray(t.globalMetadata) && t.globalMetadata.length === 2,
            `instance ${i} did not receive globalMetadata`));
        // Shared array is reused by reference (no per-instance copies re-fetched).
        assert.ok(tables.every(t => t.globalMetadata === tables[0].globalMetadata),
            'instances should share the same globalMetadata array reference');
        console.log('PASS Test 1: 6 tables → 1 /metadata request, all instances populated');
        passed++;
    }

    // --- Test 2: a table created AFTER the fetch resolved reuses the shared copy ---
    {
        resetSharedCache();
        const first = makeInstance('/crm/metadata/988');
        first.globalMetadataPromise = first.loadGlobalMetadata();
        await first.globalMetadataPromise;
        assert.strictEqual(metadataCalls(), 1, 'first load should fetch once');

        const late = makeInstance('/crm/metadata/997');
        late.globalMetadataPromise = late.loadGlobalMetadata();
        await late.globalMetadataPromise;

        assert.strictEqual(metadataCalls(), 1,
            `late-created table must reuse cache (still 1), got ${metadataCalls()}`);
        assert.strictEqual(late.globalMetadata, first.globalMetadata, 'late table shares the cached array');
        console.log('PASS Test 2: late-created table reuses shared metadata (no new request)');
        passed++;
    }

    // --- Test 3: fetchMetadata() serves from the shared global copy, no /metadata/{id} ---
    {
        resetSharedCache();
        const t = makeInstance('/crm/metadata/988');
        t.globalMetadataPromise = t.loadGlobalMetadata();
        await t.globalMetadataPromise;
        calls = [];

        const meta = await t.fetchMetadata('997');
        assert.strictEqual(meta.id, '997', 'fetchMetadata returned wrong item');
        assert.strictEqual(calls.length, 0,
            `fetchMetadata should hit no network (served from global), got ${JSON.stringify(calls)}`);
        console.log('PASS Test 3: fetchMetadata serves from shared global metadata, zero requests');
        passed++;
    }

    // --- Test 4: different database (apiBase) keeps its own cache entry ---
    {
        resetSharedCache();
        const a = makeInstance('/crm/metadata/988');
        const b = makeInstance('/otherdb/metadata/988');
        a.globalMetadataPromise = a.loadGlobalMetadata();
        b.globalMetadataPromise = b.loadGlobalMetadata();
        await Promise.all([a.globalMetadataPromise, b.globalMetadataPromise]);

        assert.strictEqual(metadataCalls(), 2,
            `two databases → two fetches, got ${metadataCalls()} (${JSON.stringify(calls)})`);
        assert.deepStrictEqual(
            calls.filter(u => /\/metadata$/.test(u)).sort(),
            ['/crm/metadata', '/otherdb/metadata']);
        console.log('PASS Test 4: distinct databases each fetch their own metadata');
        passed++;
    }

    // --- Test 5: clearSharedGlobalMetadata() forces a fresh refetch (schema edit) ---
    {
        resetSharedCache();
        const editor = makeInstance('/crm/metadata/988');
        const sibling = makeInstance('/crm/metadata/997');
        editor.globalMetadataPromise = editor.loadGlobalMetadata();
        sibling.globalMetadataPromise = sibling.loadGlobalMetadata();
        await Promise.all([editor.globalMetadataPromise, sibling.globalMetadataPromise]);
        assert.strictEqual(metadataCalls(), 1, 'initial shared load is one request');

        // Simulate a column add/edit on `editor`: reset its instance state + shared cache.
        editor.globalMetadata = null;
        editor.globalMetadataPromise = null;
        editor.clearSharedGlobalMetadata();

        // Next load on the editor must refetch fresh, not reuse the cleared shared copy.
        editor.globalMetadataPromise = editor.loadGlobalMetadata();
        await editor.globalMetadataPromise;
        assert.strictEqual(metadataCalls(), 2,
            `after clear, editor must refetch (2 total), got ${metadataCalls()}`);
        console.log('PASS Test 5: clearSharedGlobalMetadata() forces a fresh refetch after schema edit');
        passed++;
    }

    console.log(`\n=== ${passed}/5 tests passed ===`);
}

run().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
