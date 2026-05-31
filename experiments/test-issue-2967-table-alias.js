/**
 * Test for issue #2967: js/integram-table.js — display a table alias in the UI.
 *
 * A table is named the same as its first column. Issue #2967 adds the ability
 * to give a table an arbitrary displayed name (an "alias") stored in the first
 * column's attrs (via a self-descriptor requisite on the server). The frontend
 * must prefer that alias wherever the raw first-column name was previously used:
 *   1. tableDisplayName(metadata) resolves alias -> val -> value -> name.
 *   2. The first column's header name uses the alias when present.
 *   3. The table title is set from the alias when present.
 *   4. setTableAlias() posts to _t_alias/{tableId}.
 *
 * This test exercises the real IntegramTable methods from the built bundle, so a
 * regression in any rendering path that drops the alias is caught.
 *
 * Run with: node experiments/test-issue-2967-table-alias.js
 */

const fs = require('fs');
const path = require('path');

// Stub the browser globals used inside the IntegramTable class
global.window = { grants: { '1': 'WRITE' }, location: { hostname: 'localhost', pathname: '/db/', search: '' }, _integramTableInstances: [] };
global.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    readyState: 'complete',
    addEventListener: () => {}
};
global.URLSearchParams = require('url').URLSearchParams;
global.parseIntegramAttrs = () => ({});

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'integram-table.js'), 'utf8');
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
    if (cond) { console.log('  PASS:', msg); passed++; }
    else { console.log('  FAIL:', msg); failed++; }
}

function makeStub() {
    const t = Object.create(global.IntegramTable.prototype);
    t.columns = [];
    t.columnOrder = [];
    t.visibleColumns = [];
    t.metadataCache = {};
    t.metadataFetchPromises = {};
    t.globalMetadata = null;
    t.globalMetadataPromise = null;
    t.options = { instanceName: 'tbl', title: '' };
    t.tableGranted = 'WRITE';
    return t;
}

console.log('=== Test issue #2967: table alias display ===\n');

// --- Test 1: tableDisplayName prefers alias ---
{
    console.log('Test 1: tableDisplayName resolution order');
    const t = makeStub();
    assert(t.tableDisplayName({ alias: 'Клиенты', val: 'Клиент' }) === 'Клиенты',
        'alias wins over val');
    assert(t.tableDisplayName({ val: 'Клиент' }) === 'Клиент',
        'falls back to val when no alias');
    assert(t.tableDisplayName({ value: 'X' }) === 'X',
        'falls back to value');
    assert(t.tableDisplayName({ name: 'Y' }) === 'Y',
        'falls back to name');
    assert(t.tableDisplayName({}) === '',
        'empty metadata yields empty string');
    assert(t.tableDisplayName(null) === '',
        'null metadata yields empty string');
    assert(t.tableDisplayName({ alias: '', val: 'Клиент' }) === 'Клиент',
        'empty alias is ignored, falls through to val');
}

// parseObjectFormat fetches data, then returns { columns, rows }. Configure a
// stub that resolves the data fetch with an empty array.
function configureForParse(t) {
    t.isTableWritable = () => true;
    t.mapTypeIdToFormat = () => 'SHORT';
    t.getApiBase = () => '/db';
    t.buildColumnFromMetadataReq = (req) => ({ id: String(req.id), name: req.val });
    t.getPageUrlParams = () => new global.URLSearchParams();
    t.filters = {};
    t.sortColumn = null;
    t.sortDirection = null;
    t.groupingEnabled = false;
    t.groupingColumns = [];
    t.loadedRecords = 0;
    t.options.pageSize = 10;
    global.fetch = () => Promise.resolve({ json: () => Promise.resolve([]) });
}

// --- Test 2: parseObjectFormat sets title and first-column name from alias ---
{
    console.log('Test 2: parseObjectFormat uses alias for title + first column');
    const t = makeStub();
    configureForParse(t);

    const metadata = {
        id: '1000', type: '3', val: 'Клиент', alias: 'Клиенты',
        reqs: [{ num: 1, id: '1001', val: 'Телефон', type: '3' }]
    };
    return (async () => {
        const result = await t.parseObjectFormat(metadata);
        const cols = result.columns;
        assert(t.options.title === 'Клиенты', 'title set from alias');
        assert(Array.isArray(cols) && cols.length === 2, 'two columns built');
        assert(cols[0].name === 'Клиенты', 'first column header uses alias');
        assert(cols[0].val === 'Клиент', 'first column keeps raw val');
        assert(cols[0].alias === 'Клиенты', 'first column carries alias');
        assert(cols[1].name === 'Телефон', 'second column unaffected');

        // --- Test 3: no alias -> falls back to raw name ---
        console.log('Test 3: no alias falls back to the raw first-column name');
        const t2 = makeStub();
        configureForParse(t2);
        const result2 = await t2.parseObjectFormat({ id: '2000', type: '3', val: 'Заказ', reqs: [] });
        const cols2 = result2.columns;
        assert(t2.options.title === 'Заказ', 'title falls back to val');
        assert(cols2[0].name === 'Заказ', 'first column header falls back to val');
        assert(cols2[0].alias === '', 'first column alias empty when none set');

        // --- Test 4: setTableAlias posts to _t_alias/{tableId} ---
        console.log('Test 4: setTableAlias posts to _t_alias endpoint');
        const t3 = makeStub();
        t3.getApiBase = () => '/db';
        global.xsrf = 'TOKEN';
        let capturedUrl = null, capturedBody = null;
        global.fetch = (url, opts) => {
            capturedUrl = url;
            capturedBody = opts && opts.body;
            return Promise.resolve({ ok: true });
        };
        const res = await t3.setTableAlias('1000', 'Клиенты');
        assert(res.success === true, 'setTableAlias resolves success');
        assert(capturedUrl === '/db/_t_alias/1000?JSON', 'posts to _t_alias/{tableId}?JSON');
        assert(/val=/.test(capturedBody) && /TOKEN/.test(capturedBody), 'sends val and xsrf');

        console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
        process.exit(failed ? 1 : 0);
    })();
}
