/**
 * Test for issue #789: Double metadata fetch due to race condition
 *
 * The issue: In init(), loadGlobalMetadata() and loadData() are both called
 * without await. They run concurrently. When loadData() → loadDataFromTable()
 * → fetchMetadata() runs, this.globalMetadata is still null because the
 * /metadata fetch hasn't completed yet, causing a fallback to /metadata/{id}.
 *
 * The fix: Store the loadGlobalMetadata() promise so fetchMetadata() can await
 * it before falling back to a direct /metadata/{id} fetch.
 */

// Simulate the race condition (before fix)
async function simulateBeforeFix() {
    const calls = [];

    // Simulate the IntegramTable behavior before fix
    const obj = {
        globalMetadata: null,
        // globalMetadataPromise: null  // Not stored before fix

        async loadGlobalMetadata() {
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 50));
            calls.push('/metadata');
            this.globalMetadata = [{ id: 18, val: 'Table 18' }];
        },

        async fetchMetadata(typeId) {
            // Before fix: only checks globalMetadata, doesn't wait for promise
            if (this.globalMetadata) {
                const item = this.globalMetadata.find(i => i.id === typeId || i.id === Number(typeId));
                if (item) return item;
            }
            // Falls through to direct fetch
            calls.push(`/metadata/${typeId}`);
            await new Promise(resolve => setTimeout(resolve, 10));
            return { id: typeId, val: `Table ${typeId}` };
        },

        async loadDataFromTable() {
            const metadata = await this.fetchMetadata(18);
            return metadata;
        },

        async loadData() {
            return await this.loadDataFromTable();
        },

        init() {
            this.loadGlobalMetadata();  // NOT stored, runs concurrently
            this.loadData();
        }
    };

    // Run both concurrently (simulating init())
    await Promise.all([
        obj.loadGlobalMetadata(),
        obj.loadData()
    ]);

    return calls;
}

// Simulate the fix (after fix)
async function simulateAfterFix() {
    const calls = [];

    const obj = {
        globalMetadata: null,
        globalMetadataPromise: null,  // Added in fix

        async loadGlobalMetadata() {
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 50));
            calls.push('/metadata');
            this.globalMetadata = [{ id: 18, val: 'Table 18' }];
        },

        async fetchMetadata(typeId) {
            // Check globalMetadata directly
            if (this.globalMetadata) {
                const item = this.globalMetadata.find(i => i.id === typeId || i.id === Number(typeId));
                if (item) return item;
            }

            // After fix: await the promise if globalMetadata is still loading
            if (this.globalMetadataPromise) {
                await this.globalMetadataPromise;
                if (this.globalMetadata) {
                    const item = this.globalMetadata.find(i => i.id === typeId || i.id === Number(typeId));
                    if (item) return item;
                }
            }

            // Falls through to direct fetch (only if globalMetadata didn't have it)
            calls.push(`/metadata/${typeId}`);
            await new Promise(resolve => setTimeout(resolve, 10));
            return { id: typeId, val: `Table ${typeId}` };
        },

        async loadDataFromTable() {
            const metadata = await this.fetchMetadata(18);
            return metadata;
        },

        async loadData() {
            return await this.loadDataFromTable();
        },

        init() {
            // After fix: store the promise
            this.globalMetadataPromise = this.loadGlobalMetadata();
            this.loadData();
        }
    };

    // Run both concurrently (simulating init())
    obj.globalMetadataPromise = obj.loadGlobalMetadata();
    await obj.loadData();
    await obj.globalMetadataPromise;

    return calls;
}

async function main() {
    console.log('=== Before fix ===');
    const callsBefore = await simulateBeforeFix();
    console.log('Network calls:', callsBefore);
    console.log('Expected: ["/metadata", "/metadata/18"] - DOUBLE FETCH!');

    console.log('\n=== After fix ===');
    const callsAfter = await simulateAfterFix();
    console.log('Network calls:', callsAfter);
    console.log('Expected: ["/metadata"] - SINGLE FETCH!');

    const beforeDoubles = callsBefore.filter(c => c.includes('/18')).length > 0;
    const afterSingle = callsAfter.filter(c => c.includes('/18')).length === 0;

    console.log('\n=== Results ===');
    console.log('Before fix has double fetch:', beforeDoubles ? 'YES (bug confirmed)' : 'NO');
    console.log('After fix avoids double fetch:', afterSingle ? 'YES (fix works)' : 'NO (fix failed)');
}

main().catch(console.error);
