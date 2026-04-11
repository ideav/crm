/**
 * Test for issue #1455: when loading metadata, check if already loaded or loading in progress
 *
 * This test verifies that:
 * 1. If metadata is already loaded (in cache), no new fetch is triggered
 * 2. If a fetch for the same typeId is already in progress, concurrent callers await the same promise
 * 3. The same fetch promise is not triggered multiple times
 *
 * Run with: node experiments/test-issue-1455-metadata-loading-dedup.js
 */

let fetchCallCount = 0;
let fetchCallLog = [];

// Minimal mock of the IntegramTable class's metadata fetch logic
// (mirrors the actual implementation in js/integram-table.js)
class MockIntegramTable {
    constructor() {
        this.metadataCache = {};
        this.metadataFetchPromises = {};
        this.globalMetadata = null;
        this.globalMetadataPromise = null;
    }

    getApiBase() { return 'http://localhost/api'; }

    async loadGlobalMetadata() {
        // If already loaded, return immediately (issue #1455)
        if (this.globalMetadata) {
            return;
        }

        // If loading is already in progress, wait for it (issue #1455)
        if (this.globalMetadataPromise) {
            return this.globalMetadataPromise;
        }

        try {
            const metadata = await this._fakeFetch('metadata', null);
            this.globalMetadata = metadata;
        } catch (error) {
            console.error('Error loading global metadata:', error);
        }
    }

    async fetchMetadata(typeId) {
        // Check globalMetadata first
        if (this.globalMetadata) {
            const cachedItem = this.globalMetadata.find(item => item.id === typeId || item.id === Number(typeId));
            if (cachedItem) {
                return cachedItem;
            }
        }

        // Await globalMetadataPromise if loading
        if (this.globalMetadataPromise) {
            await this.globalMetadataPromise;
            if (this.globalMetadata) {
                const cachedItem = this.globalMetadata.find(item => item.id === typeId || item.id === Number(typeId));
                if (cachedItem) {
                    return cachedItem;
                }
            }
        }

        // Check per-typeId cache (issue #1455)
        if (this.metadataCache[typeId]) {
            return this.metadataCache[typeId];
        }

        // Await in-progress fetch for same typeId (issue #1455)
        if (this.metadataFetchPromises[typeId]) {
            return this.metadataFetchPromises[typeId];
        }

        const fetchPromise = (async () => {
            try {
                const data = await this._fakeFetch('metadata', typeId);
                this.metadataCache[typeId] = data;
                return data;
            } finally {
                delete this.metadataFetchPromises[typeId];
            }
        })();
        this.metadataFetchPromises[typeId] = fetchPromise;
        return fetchPromise;
    }

    // Simulates a network fetch with a small delay
    async _fakeFetch(type, typeId) {
        const key = typeId ? `${type}/${typeId}` : type;
        fetchCallCount++;
        fetchCallLog.push(key);
        // Simulate async network delay
        await new Promise(resolve => setTimeout(resolve, 20));
        if (type === 'metadata' && typeId === null) {
            return [
                { id: 1, val: 'TypeA', reqs: [] },
                { id: 2, val: 'TypeB', reqs: [] }
            ];
        }
        return { id: Number(typeId), val: `Type${typeId}`, reqs: [] };
    }
}

async function runTests() {
    console.log('=== Test issue #1455: Metadata loading deduplication ===\n');
    let passed = 0;
    let failed = 0;

    // --- Test 1: Concurrent calls for same typeId only trigger one fetch ---
    {
        fetchCallCount = 0;
        fetchCallLog = [];
        const table = new MockIntegramTable();

        console.log('Test 1: Concurrent fetchMetadata calls for same typeId trigger only one fetch');

        // Fire 3 concurrent requests for the same typeId
        const [r1, r2, r3] = await Promise.all([
            table.fetchMetadata(5),
            table.fetchMetadata(5),
            table.fetchMetadata(5),
        ]);

        if (fetchCallCount === 1) {
            console.log(`  PASS: Only 1 fetch was made (expected 1, got ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected 1 fetch, but got ${fetchCallCount}`);
            failed++;
        }

        if (r1.id === 5 && r2.id === 5 && r3.id === 5) {
            console.log('  PASS: All callers received correct data');
            passed++;
        } else {
            console.log(`  FAIL: Incorrect data returned: ${JSON.stringify([r1, r2, r3])}`);
            failed++;
        }

        // Fourth call should hit the cache, not trigger another fetch
        fetchCallCount = 0;
        await table.fetchMetadata(5);
        if (fetchCallCount === 0) {
            console.log('  PASS: Subsequent call uses cache, no new fetch');
            passed++;
        } else {
            console.log(`  FAIL: Expected 0 fetches from cache, got ${fetchCallCount}`);
            failed++;
        }
        console.log();
    }

    // --- Test 2: Sequential calls for same typeId only trigger one fetch ---
    {
        fetchCallCount = 0;
        fetchCallLog = [];
        const table = new MockIntegramTable();

        console.log('Test 2: Sequential fetchMetadata calls for same typeId trigger only one fetch');
        await table.fetchMetadata(10);
        await table.fetchMetadata(10);
        await table.fetchMetadata(10);

        if (fetchCallCount === 1) {
            console.log(`  PASS: Only 1 fetch was made (expected 1, got ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected 1 fetch, but got ${fetchCallCount}`);
            failed++;
        }
        console.log();
    }

    // --- Test 3: Different typeIds each get their own fetch ---
    {
        fetchCallCount = 0;
        fetchCallLog = [];
        const table = new MockIntegramTable();

        console.log('Test 3: Different typeIds each trigger their own fetch');
        const [r1, r2, r3] = await Promise.all([
            table.fetchMetadata(1),
            table.fetchMetadata(2),
            table.fetchMetadata(3),
        ]);

        if (fetchCallCount === 3) {
            console.log(`  PASS: 3 fetches for 3 different typeIds (got ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected 3 fetches, got ${fetchCallCount}`);
            failed++;
        }
        console.log();
    }

    // --- Test 4: loadGlobalMetadata checks if already loaded ---
    {
        fetchCallCount = 0;
        fetchCallLog = [];
        const table = new MockIntegramTable();

        console.log('Test 4: loadGlobalMetadata skips fetch if already loaded');
        table.globalMetadataPromise = table.loadGlobalMetadata();
        await table.globalMetadataPromise;

        const countAfterFirst = fetchCallCount;

        // Call again - should not trigger another fetch
        await table.loadGlobalMetadata();
        await table.loadGlobalMetadata();

        if (fetchCallCount === countAfterFirst) {
            console.log(`  PASS: Subsequent loadGlobalMetadata calls did not re-fetch (count: ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected no new fetches, but got ${fetchCallCount - countAfterFirst} more`);
            failed++;
        }
        console.log();
    }

    // --- Test 5: fetchMetadata uses globalMetadata when available ---
    {
        fetchCallCount = 0;
        fetchCallLog = [];
        const table = new MockIntegramTable();

        console.log('Test 5: fetchMetadata uses globalMetadata cache, no extra fetch');
        table.globalMetadataPromise = table.loadGlobalMetadata();
        await table.globalMetadataPromise;

        fetchCallCount = 0; // Reset to check only post-globalMetadata fetches
        const meta = await table.fetchMetadata(1); // id=1 is in globalMetadata
        if (fetchCallCount === 0 && meta && meta.id === 1) {
            console.log('  PASS: fetchMetadata used globalMetadata, no extra fetch');
            passed++;
        } else {
            console.log(`  FAIL: fetchCallCount=${fetchCallCount}, meta=${JSON.stringify(meta)}`);
            failed++;
        }
        console.log();
    }

    // --- Summary ---
    console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
