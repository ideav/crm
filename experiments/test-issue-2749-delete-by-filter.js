/*
 * Test for issue #2749: js/integram-table.js
 * "Кнопка «Удалить по фильтру»: добавить кнопку, видимую только пользователям,
 *  у которых есть метаданное delete:"1", и реализовать удаление через отдельный
 *  метод (не через _m_del_select)."
 *
 * The test exercises bulkDeleteByFilter() and fetchFilterMatchCount() from
 * js/integram-table/23-bulk-export.js against a mocked server. It verifies:
 *
 *   1. fetchFilterMatchCount() hits the JSON_OBJ&_count=1 endpoint with the
 *      current filters/parent forwarded so the user sees the correct number
 *      of records before confirming.
 *   2. bulkDeleteByFilter() loads ALL matching rows (regardless of the current
 *      pagination window) and POSTs to /_m_del/{id}?JSON for each — i.e. it
 *      no longer relies on the legacy _m_del_select form endpoint.
 *   3. Records that the server refuses to delete surface as user-visible
 *      errors instead of being silently swallowed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- Load just the methods we need straight from the source module ----------

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '23-bulk-export.js'),
    'utf8'
);

function extractMethod(name) {
    const re = new RegExp(`(?:^|\\n)        (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = moduleSource.match(re);
    if (!match) throw new Error(`Could not find method ${name} in module source`);
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < moduleSource.length; i++) {
        const ch = moduleSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return moduleSource.slice(match.index + 1, i + 1);
            }
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

const methodSources = [
    extractMethod('bulkDeleteByFilter'),
    extractMethod('fetchFilterMatchCount'),
].join('\n');

// Build a minimal class hosting the methods, with `this` bound to a controllable
// mock. Stubs for `loadDataFromTableForExport`, `loadData`, `applyFilter`,
// `appendPageUrlParams`, `escapeHtml`, `sanitizeInlineMessageHtml`, and
// `showToast` are supplied below; DOM-touching helpers are made into no-ops
// so the test runs in pure Node without jsdom.
const Host = new Function('fetchRef', 'documentRef', `
    const fetch = (...args) => fetchRef(...args);
    const document = new Proxy({}, {
        get(_, prop) { return documentRef()[prop]; },
    });
    const xsrf = undefined; // typeof xsrf !== 'undefined' will be false
    class Host {
        constructor(opts) { Object.assign(this, opts); }
        getApiBase() { return this._apiBase; }
        applyFilter(params, column, filter) {
            // Mirror the FR_/F_/TO_ convention sufficient for these tests
            if (filter.type === '=') params.set('F_' + column.id, filter.value);
            else if (filter.type === '^') params.set('FR_' + column.id, filter.value);
        }
        appendPageUrlParams() {}
        escapeHtml(s) { return String(s); }
        sanitizeInlineMessageHtml(s) { return String(s); }
        showToast(msg, level) {
            (this.toasts = this.toasts || []).push({ msg, level });
        }
        loadData() {
            this.reloadCalls = (this.reloadCalls || 0) + 1;
            return Promise.resolve();
        }
        loadDataFromTableForExport(offset, limit) {
            this.loadCalls = (this.loadCalls || []);
            this.loadCalls.push({ offset, limit });
            return Promise.resolve({
                columns: this.columns,
                rows: this._rawDataResponse.map(r => r.r),
                rawData: this._rawDataResponse,
            });
        }
        ${methodSources}
    }
    return Host;
`)(
    (...args) => global.fetch(...args),
    () => global.document
);

// Provide a default document for tests that don't need to introspect DOM writes
function defaultDocument() {
    return {
        body: { insertAdjacentHTML() {} },
        getElementById() {
            return {
                querySelector() { return { style: {}, textContent: '', innerHTML: '', appendChild() {} }; },
                remove() {},
            };
        },
        createElement() {
            return { className: '', style: {}, textContent: '', addEventListener() {} };
        },
    };
}

// --- Mock fetch helpers -----------------------------------------------------

function makeFetch(routes) {
    return async function fetch(url, init) {
        for (const route of routes) {
            const match = route.match(url, init);
            if (match) {
                route.calls.push({ url, init, match });
                return route.respond(match);
            }
        }
        throw new Error(`Unexpected fetch to ${url}`);
    };
}

function jsonResponse(status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() { return text; },
        async json() { return JSON.parse(text); },
    };
}

// --- Tests ------------------------------------------------------------------

const API = 'https://example.test/db';

async function testFetchFilterMatchCount() {
    // The button must show how many records currently match the filter
    // BEFORE asking for confirmation. The new fetchFilterMatchCount() must
    // hit /object/{id}/?JSON_OBJ&_count=1 with current filters forwarded.
    global.document = defaultDocument();
    const routes = [
        {
            calls: [],
            match: (url) => {
                const m = url.match(/^https:\/\/example\.test\/db\/object\/3596\/\?JSON_OBJ&(.+)$/);
                return m ? { qs: new URLSearchParams(m[1]) } : null;
            },
            respond: () => jsonResponse(200, { count: 7 }),
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({
        _apiBase: API,
        objectTableId: '3596',
        columns: [{ id: '3597' }],
        filters: { '3597': { type: '=', value: 'foo' } },
        options: { parentId: '999' },
    });

    const count = await tbl.fetchFilterMatchCount();
    assert.strictEqual(count, 7, 'returned count must match server response');
    assert.strictEqual(routes[0].calls.length, 1);

    const qs = routes[0].calls[0].match.qs;
    assert.strictEqual(qs.get('_count'), '1', '_count=1 must be set');
    assert.strictEqual(qs.get('F_3597'), 'foo', 'current filter must be forwarded');
    assert.strictEqual(qs.get('F_U'), '999', 'parentId must be forwarded as F_U');
    console.log('PASS fetchFilterMatchCount forwards filters and parent to the _count endpoint');
}

async function testBulkDeleteByFilterCallsPerRecordEndpoint() {
    // After confirming, the new method must fetch ALL matching records via
    // the existing JSON_OBJ export path (loadDataFromTableForExport) and then
    // POST /_m_del/{id}?JSON for each one — NOT POST {tableId}/_m_del_select.
    global.document = defaultDocument();
    const deleteCalls = [];
    const routes = [
        {
            calls: [],
            match: (url, init) => {
                const m = url.match(/^https:\/\/example\.test\/db\/_m_del\/(\d+)\?JSON$/);
                if (m && init && init.method === 'POST') {
                    return { id: m[1] };
                }
                return null;
            },
            respond: ({ id }) => {
                deleteCalls.push(id);
                return jsonResponse(200, { id, deleted: true });
            },
        },
        {
            calls: [],
            match: (url) => url.includes('/_m_del_select'),
            respond: () => { throw new Error('legacy _m_del_select must NOT be used'); },
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({
        _apiBase: API,
        objectTableId: '3596',
        columns: [{ id: '3597' }],
        filters: {},
        options: { tableTypeId: '3596' },
        rawObjectData: [],
        selectedRows: new Set(),
        data: [],
        loadedRecords: 0,
        hasMore: true,
        totalRows: null,
        _rawDataResponse: [
            { i: 101, u: 1, o: 0, r: ['Alpha'] },
            { i: 102, u: 1, o: 1, r: ['Beta'] },
            { i: 103, u: 1, o: 2, r: ['Gamma'] },
        ],
    });

    await tbl.bulkDeleteByFilter();

    assert.strictEqual(routes[0].calls.length, 3, 'must POST _m_del once per matching record');
    assert.deepStrictEqual(deleteCalls.sort(), ['101', '102', '103'],
        'every matching record id must be deleted');
    assert.strictEqual(routes[1].calls.length, 0,
        'legacy _m_del_select endpoint must not be touched');
    assert.strictEqual(tbl.reloadCalls, 1, 'table must reload after deletion');
    console.log('PASS bulkDeleteByFilter posts _m_del/{id} for every match and reloads');
}

async function testBulkDeleteByFilterShowsServerErrors() {
    // If the server refuses individual records (e.g. reference checks), the
    // failing IDs must be captured as errors rather than silently dropped.
    const routes = [
        {
            calls: [],
            match: (url) => {
                const m = url.match(/^https:\/\/example\.test\/db\/_m_del\/(\d+)\?JSON$/);
                return m ? { id: m[1] } : null;
            },
            respond: ({ id }) => {
                if (id === '102') {
                    return jsonResponse(400, [{ error: 'Запись используется как ссылка' }]);
                }
                return jsonResponse(200, { id, deleted: true });
            },
        },
    ];
    global.fetch = makeFetch(routes);

    // Stub document so we can capture the rendered error HTML
    const capturedErrors = [];
    global.document = {
        body: { insertAdjacentHTML() {} },
        getElementById() {
            return {
                querySelector(sel) {
                    if (sel === '.bulk-delete-errors') {
                        return {
                            style: {},
                            set innerHTML(v) { capturedErrors.push(v); },
                            get innerHTML() { return capturedErrors[capturedErrors.length - 1] || ''; },
                            appendChild() {},
                        };
                    }
                    return {
                        style: {},
                        textContent: '',
                        innerHTML: '',
                        appendChild() {},
                    };
                },
                remove() {},
            };
        },
        createElement() { return { className: '', style: {}, textContent: '', addEventListener() {} }; },
    };

    const tbl = new Host({
        _apiBase: API,
        objectTableId: '3596',
        columns: [{ id: '3597' }],
        filters: {},
        options: {},
        rawObjectData: [],
        selectedRows: new Set(),
        data: [],
        loadedRecords: 0,
        hasMore: true,
        totalRows: null,
        _rawDataResponse: [
            { i: 101, u: 1, o: 0, r: ['Alpha'] },
            { i: 102, u: 1, o: 1, r: ['Beta'] },
            { i: 103, u: 1, o: 2, r: ['Gamma'] },
        ],
    });

    await tbl.bulkDeleteByFilter();

    const allErrorHtml = capturedErrors.join('\n');
    assert.ok(/102/.test(allErrorHtml), 'error report must include failing record id 102');
    assert.ok(/Запись используется как ссылка/.test(allErrorHtml),
        'error report must include the server-side error message');
    console.log('PASS bulkDeleteByFilter surfaces per-record server errors');
}

async function testReproducesLegacyBehaviourBeforeFix() {
    // Before the fix, deletion-by-filter was a server-side form POST to
    // {tableId}/_m_del_select that submitted the page. Re-implement it
    // locally so we can document the issue and contrast with the new flow.
    async function legacyDeleteByFilter(tableId, filterParams) {
        const params = new URLSearchParams(filterParams);
        params.set('_m_del_select', '1');
        const resp = await fetch(`${API}/${tableId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        return { ok: resp.ok };
    }

    let legacyCalled = false;
    global.fetch = async (url, init) => {
        if (url === `${API}/3596`
            && init && init.body && init.body.includes('_m_del_select=1')) {
            legacyCalled = true;
            return jsonResponse(200, { ok: true });
        }
        throw new Error(`unexpected ${url}`);
    };

    await legacyDeleteByFilter('3596', { F_3597: 'foo' });
    assert.strictEqual(legacyCalled, true,
        'the legacy flow that this PR replaces relied on _m_del_select');
    console.log('PASS reproduces the pre-fix _m_del_select flow that this issue replaces');
}

(async function run() {
    await testReproducesLegacyBehaviourBeforeFix();
    await testFetchFilterMatchCount();
    await testBulkDeleteByFilterCallsPerRecordEndpoint();
    await testBulkDeleteByFilterShowsServerErrors();
    console.log('\nAll issue #2749 tests passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
