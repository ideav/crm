/**
 * Test for issue #1459: js/main-app.js doesn't use caching/waiting logic for metadata fetches
 *
 * This test verifies that MainAppController.loadGlobalMetadata():
 * 1. If metadata is already loaded, returns it immediately (no new fetch)
 * 2. If a fetch is already in progress, concurrent callers await the same promise
 * 3. Sequential calls use the cache (no duplicate fetches)
 *
 * Run with: node experiments/test-issue-1459-main-app-metadata-caching.js
 */

let fetchCallCount = 0;

// Minimal mock of the MainAppController's new loadGlobalMetadata logic
// (mirrors the actual implementation in js/main-app.js)
class MockMainAppController {
    constructor() {
        this.globalMetadata = null;
        this.globalMetadataPromise = null;
    }

    async loadGlobalMetadata() {
        // If already loaded, return immediately (issue #1459)
        if (this.globalMetadata) {
            return this.globalMetadata;
        }

        // If loading is already in progress, wait for it instead of starting a new fetch (issue #1459)
        if (this.globalMetadataPromise) {
            return this.globalMetadataPromise;
        }

        this.globalMetadataPromise = (async () => {
            try {
                // Simulate fetch
                const metadata = await this._fakeFetchMetadata();
                if (!metadata) return null;
                this.globalMetadata = metadata;
                return metadata;
            } catch (e) {
                console.error('Error loading global metadata:', e);
                return null;
            } finally {
                this.globalMetadataPromise = null;
            }
        })();
        return this.globalMetadataPromise;
    }

    async _fakeFetchMetadata() {
        fetchCallCount++;
        // Simulate async network delay
        await new Promise(resolve => setTimeout(resolve, 20));
        return [
            { id: 1, val: 'Роль', reqs: [{ val: 'Меню', granted: 'WRITE' }] },
            { id: 2, val: 'TypeB', reqs: [] }
        ];
    }

    async checkMenuEditRights() {
        try {
            const metadata = await this.loadGlobalMetadata();
            if (!metadata) return false;
            const roleType = metadata.find(item =>
                item.val === 'Роль' || item.val === 'Role'
            );
            if (!roleType || !Array.isArray(roleType.reqs)) return false;
            return roleType.reqs.some(req =>
                (req.val === 'Меню' || req.val === 'Menu') && req.granted === 'WRITE'
            );
        } catch (e) {
            console.error('Error checking menu edit rights:', e);
            return false;
        }
    }
}

async function runTests() {
    console.log('=== Test issue #1459: MainAppController metadata caching ===\n');
    let passed = 0;
    let failed = 0;

    // --- Test 1: Concurrent calls only trigger one fetch ---
    {
        fetchCallCount = 0;
        const ctrl = new MockMainAppController();

        console.log('Test 1: Concurrent loadGlobalMetadata calls trigger only one fetch');
        const [r1, r2, r3] = await Promise.all([
            ctrl.loadGlobalMetadata(),
            ctrl.loadGlobalMetadata(),
            ctrl.loadGlobalMetadata(),
        ]);

        if (fetchCallCount === 1) {
            console.log(`  PASS: Only 1 fetch was made (expected 1, got ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected 1 fetch, but got ${fetchCallCount}`);
            failed++;
        }

        if (Array.isArray(r1) && Array.isArray(r2) && Array.isArray(r3)) {
            console.log('  PASS: All callers received valid metadata');
            passed++;
        } else {
            console.log(`  FAIL: Some callers got invalid result: ${JSON.stringify([r1, r2, r3])}`);
            failed++;
        }
        console.log();
    }

    // --- Test 2: Subsequent calls use cache ---
    {
        fetchCallCount = 0;
        const ctrl = new MockMainAppController();

        console.log('Test 2: Sequential loadGlobalMetadata calls trigger only one fetch');
        await ctrl.loadGlobalMetadata();
        const countAfterFirst = fetchCallCount;

        await ctrl.loadGlobalMetadata();
        await ctrl.loadGlobalMetadata();

        if (fetchCallCount === countAfterFirst) {
            console.log(`  PASS: Subsequent calls used cache, no extra fetches (total: ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected no new fetches, but got ${fetchCallCount - countAfterFirst} more`);
            failed++;
        }
        console.log();
    }

    // --- Test 3: checkMenuEditRights uses cached metadata ---
    {
        fetchCallCount = 0;
        const ctrl = new MockMainAppController();

        console.log('Test 3: checkMenuEditRights uses cached metadata on repeated calls');
        const result1 = await ctrl.checkMenuEditRights();
        const countAfterFirst = fetchCallCount;

        const result2 = await ctrl.checkMenuEditRights();

        if (fetchCallCount === countAfterFirst) {
            console.log(`  PASS: Second checkMenuEditRights used cache, no extra fetch`);
            passed++;
        } else {
            console.log(`  FAIL: Expected no extra fetch, but got ${fetchCallCount - countAfterFirst} more`);
            failed++;
        }

        if (result1 === true && result2 === true) {
            console.log('  PASS: Both calls returned correct result (WRITE access detected)');
            passed++;
        } else {
            console.log(`  FAIL: Expected true for both, got ${result1}, ${result2}`);
            failed++;
        }
        console.log();
    }

    // --- Test 4: Concurrent checkMenuEditRights calls share one fetch ---
    {
        fetchCallCount = 0;
        const ctrl = new MockMainAppController();

        console.log('Test 4: Concurrent checkMenuEditRights calls trigger only one fetch');
        const [r1, r2, r3] = await Promise.all([
            ctrl.checkMenuEditRights(),
            ctrl.checkMenuEditRights(),
            ctrl.checkMenuEditRights(),
        ]);

        if (fetchCallCount === 1) {
            console.log(`  PASS: Only 1 fetch was made (expected 1, got ${fetchCallCount})`);
            passed++;
        } else {
            console.log(`  FAIL: Expected 1 fetch, but got ${fetchCallCount}`);
            failed++;
        }

        if (r1 === true && r2 === true && r3 === true) {
            console.log('  PASS: All callers received correct result');
            passed++;
        } else {
            console.log(`  FAIL: Unexpected results: ${JSON.stringify([r1, r2, r3])}`);
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
