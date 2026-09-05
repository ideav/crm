/**
 * Large exports are fetched in bounded pages, table source state is restored on
 * failure, and record-level URL filters are forwarded to export requests.
 */

const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

async function testPagedReportExport() {
    const table = Object.create(IntegramTable.prototype);
    const sourceRows = Array.from({ length: 12025 }, (_, index) => [`row-${ index }`]);
    const calls = [];
    Object.assign(table, {
        options: { tableTypeId: null },
        objectTableId: null,
        getDataSourceType() { return 'report'; },
        async loadDataFromReportForExport(offset, limit) {
            calls.push({ offset, limit });
            return { rows: sourceRows.slice(offset, offset + limit) };
        }
    });

    const rows = await table.loadAllDataForExport();
    assert.strictEqual(rows.length, sourceRows.length);
    assert.deepStrictEqual(calls, [
        { offset: 0, limit: 5000 },
        { offset: 5000, limit: 5000 },
        { offset: 10000, limit: 5000 }
    ]);
    assert.strictEqual(rows[12024][0], 'row-12024');
}

async function testTableTypeRestoredAfterFailure() {
    const table = Object.create(IntegramTable.prototype);
    Object.assign(table, {
        options: { tableTypeId: null },
        objectTableId: '77',
        getDataSourceType() { return 'report'; },
        async loadDataFromTableForExport() {
            assert.strictEqual(this.options.tableTypeId, '77');
            throw new Error('network down');
        }
    });

    await assert.rejects(() => table.loadAllDataForExport(), /network down/);
    assert.strictEqual(table.options.tableTypeId, null, 'temporary table type must be restored');
}

async function testRecordFilterForwarding() {
    const table = Object.create(IntegramTable.prototype);
    let requestedUrl = '';
    Object.assign(table, {
        options: { tableTypeId: '18', parentId: '7', recordId: '42' },
        filters: {},
        sortColumn: null,
        sortDirection: null,
        getApiBase() { return '/demo'; },
        appendPageUrlParams() {},
        isJsonDataArrayFormat() { return false; },
        async fetchJson(url) {
            requestedUrl = String(url);
            return [];
        }
    });

    await table.loadDataFromTableForExport(0, 5000);
    const parsed = new URL(requestedUrl, 'https://example.test');
    assert.strictEqual(parsed.searchParams.get('LIMIT'), '0,5000');
    assert.strictEqual(parsed.searchParams.get('F_U'), '7');
    assert.strictEqual(parsed.searchParams.get('F_I'), '42');
}

Promise.resolve()
    .then(testPagedReportExport)
    .then(testTableTypeRestoredAfterFailure)
    .then(testRecordFilterForwarding)
    .then(() => console.log('PASS export uses bounded pages and preserves request state'))
    .catch(error => {
        console.error('FAIL export pagination:', error);
        process.exit(1);
    });