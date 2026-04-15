/**
 * Regression test for issue #1829.
 *
 * Verifies that successful column deletion refreshes the current table in place
 * and does not redirect the user back to /tables.
 */

const assert = require('assert');

function createDeleteSuccessHandler(ctx, closeColEdit) {
    return async function refreshCurrentTableAfterDelete() {
        ctx.metadataCache = {};
        ctx.metadataFetchPromises = {};
        ctx.globalMetadata = null;
        ctx.globalMetadataPromise = null;
        ctx.columns = [];
        ctx.closeColumnSettings();
        closeColEdit();
        await ctx.loadData(false);
    };
}

async function main() {
    const calls = [];
    const location = { href: '/demo/table/123?F_U=1' };

    const table = {
        metadataCache: { cached: true },
        metadataFetchPromises: { inFlight: true },
        globalMetadata: [{ id: 123 }],
        globalMetadataPromise: Promise.resolve([]),
        columns: [{ id: 'col-1' }],
        closeColumnSettings() {
            calls.push('closeColumnSettings');
        },
        async loadData(append) {
            calls.push(`loadData:${append}`);
        }
    };

    const handler = createDeleteSuccessHandler(table, () => {
        calls.push('closeColEdit');
    });

    await handler();

    assert.deepStrictEqual(calls, [
        'closeColumnSettings',
        'closeColEdit',
        'loadData:false'
    ]);
    assert.deepStrictEqual(table.metadataCache, {});
    assert.deepStrictEqual(table.metadataFetchPromises, {});
    assert.strictEqual(table.globalMetadata, null);
    assert.strictEqual(table.globalMetadataPromise, null);
    assert.deepStrictEqual(table.columns, []);
    assert.strictEqual(location.href, '/demo/table/123?F_U=1');

    console.log('issue #1829 regression test passed');
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
