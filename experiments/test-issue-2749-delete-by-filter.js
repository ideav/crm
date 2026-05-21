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
 *   2. bulkDeleteByFilter() sends ONE POST per chunk to /_m_del_batch/{tableId}
 *      — NOT one POST per record. For N matching records and chunk size 500
 *      it sends ceil(N/500) requests, which is the whole point of the fix.
 *   3. Per-record server errors returned in the chunk response surface in
 *      the bulk-delete errors panel.
 *   4. The legacy _m_del_select endpoint is NOT touched.
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

const API = 'https://example.test/db';

async function testFetchFilterMatchCount() {
    // The button must show how many records currently match the filter
    // BEFORE asking for confirmation. fetchFilterMatchCount() must hit
    // /object/{id}/?JSON_OBJ&_count=1 with current filters forwarded.
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
    assert.strictEqual(count, 7);
    assert.strictEqual(routes[0].calls.length, 1);

    const qs = routes[0].calls[0].match.qs;
    assert.strictEqual(qs.get('_count'), '1');
    assert.strictEqual(qs.get('F_3597'), 'foo');
    assert.strictEqual(qs.get('F_U'), '999');
    console.log('PASS fetchFilterMatchCount forwards filters and parent to the _count endpoint');
}

async function testBulkDeleteByFilterUsesBatchEndpoint() {
    // The core fix: bulkDeleteByFilter must POST chunks to /_m_del_batch/{tableId}
    // — one request per chunk, NOT one request per record. Legacy _m_del_select
    // and per-record _m_del/{id} endpoints must NOT be touched.
    global.document = defaultDocument();
    const batchCalls = [];
    const routes = [
        {
            calls: [],
            match: (url, init) => {
                const m = url.match(/^https:\/\/example\.test\/db\/_m_del_batch\/(\d+)\?JSON$/);
                return (m && init && init.method === 'POST') ? { tableId: m[1] } : null;
            },
            respond: ({ tableId }, ctx) => {
                // body should contain ids=...
                return null; // sentinel — actual respond set below
            },
        },
        {
            calls: [],
            match: (url) => url.includes('/_m_del_select') ? {} : null,
            respond: () => { throw new Error('legacy _m_del_select must NOT be used'); },
        },
        {
            calls: [],
            match: (url) => /\/_m_del\/\d+/.test(url) ? {} : null,
            respond: () => { throw new Error('per-record _m_del/{id} must NOT be used for filter delete'); },
        },
    ];
    // Replace batch respond so it parses the body and answers
    routes[0].respond = (match) => {
        const init = routes[0].calls[routes[0].calls.length - 1].init;
        const body = new URLSearchParams(init.body);
        const ids = (body.get('ids') || '').split(',').filter(Boolean).map(s => parseInt(s, 10));
        batchCalls.push({ tableId: match.tableId, ids });
        return jsonResponse(200, { deleted: ids, errors: {} });
    };
    global.fetch = makeFetch(routes);

    // 1234 records — exercises chunking (FILTER_DELETE_CHUNK = 500 in source)
    const N = 1234;
    const raw = [];
    for (let i = 1; i <= N; i++) raw.push({ i, u: 1, o: i - 1, r: ['v' + i] });

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
        _rawDataResponse: raw,
    });

    await tbl.bulkDeleteByFilter();

    // 1234 records / chunk size 500 = 3 chunks
    assert.strictEqual(routes[0].calls.length, 3, `expected 3 batch calls, got ${routes[0].calls.length}`);
    assert.strictEqual(routes[1].calls.length, 0, 'legacy _m_del_select must not be called');
    assert.strictEqual(routes[2].calls.length, 0, 'per-record _m_del/{id} must not be called');
    assert.strictEqual(batchCalls[0].ids.length, 500);
    assert.strictEqual(batchCalls[1].ids.length, 500);
    assert.strictEqual(batchCalls[2].ids.length, 234);
    assert.strictEqual(batchCalls[0].tableId, '3596', 'tableId in URL must equal objectTableId');
    // No overlap, full coverage
    const allIds = new Set([...batchCalls[0].ids, ...batchCalls[1].ids, ...batchCalls[2].ids]);
    assert.strictEqual(allIds.size, N, 'every record id must be sent exactly once');
    for (let i = 1; i <= N; i++) assert.ok(allIds.has(i), `id ${i} missing from batches`);
    assert.strictEqual(tbl.reloadCalls, 1, 'table must reload once at the end');
    console.log(`PASS bulkDeleteByFilter sends ${routes[0].calls.length} batch requests for ${N} records (was ${N} per-record requests)`);
}

async function testBulkDeleteByFilterSurfacesPerRecordErrors() {
    // The server's _m_del_batch response carries {deleted, errors} per chunk.
    // Per-record errors must be reported in the bulk-delete errors panel —
    // not silently swallowed and not aggregated into a single "chunk failed".
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
                    return { style: {}, textContent: '', innerHTML: '', appendChild() {} };
                },
                remove() {},
            };
        },
        createElement() { return { className: '', style: {}, textContent: '', addEventListener() {} }; },
    };

    const routes = [
        {
            calls: [],
            match: (url, init) => /\/_m_del_batch\/\d+\?JSON$/.test(url) && init.method === 'POST' ? {} : null,
            respond: () => jsonResponse(200, {
                deleted: [101, 103],
                errors: { '102': 'Запись используется как ссылка' },
            }),
        },
    ];
    global.fetch = makeFetch(routes);

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
    assert.ok(/Beta/.test(allErrorHtml), 'error report must include the failing record value');
    assert.ok(/Запись используется как ссылка/.test(allErrorHtml),
        'error report must include the server-side error message');
    console.log('PASS bulkDeleteByFilter surfaces per-record server errors');
}

async function testBulkDeleteByFilterHandlesChunkLevelFailure() {
    // If a chunk itself fails (network error, HTTP 5xx, top-level {error}),
    // every id in that chunk must be reported — not silently lost.
    global.document = defaultDocument();
    let callCount = 0;
    const routes = [
        {
            calls: [],
            match: (url, init) => /\/_m_del_batch\/\d+\?JSON$/.test(url) && init.method === 'POST' ? {} : null,
            respond: () => {
                callCount++;
                if (callCount === 2) {
                    return jsonResponse(403, [{ error: 'forbidden' }]);
                }
                // chunk 1 + chunk 3 succeed
                const init = routes[0].calls[routes[0].calls.length - 1].init;
                const ids = new URLSearchParams(init.body).get('ids').split(',').map(Number);
                return jsonResponse(200, { deleted: ids, errors: {} });
            },
        },
    ];
    global.fetch = makeFetch(routes);

    // 3 chunks of 500 each
    const raw = [];
    for (let i = 1; i <= 1500; i++) raw.push({ i, u: 1, o: i - 1, r: ['v' + i] });

    let errorAccumulator = [];
    // Spy on what the impl puts into errorsDiv. Easier: monkey-patch escapeHtml
    // to fold every error string through us.
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
        _rawDataResponse: raw,
    });
    const origEscape = tbl.escapeHtml.bind(tbl);
    tbl.escapeHtml = (s) => { errorAccumulator.push(String(s)); return origEscape(s); };

    await tbl.bulkDeleteByFilter();

    assert.strictEqual(routes[0].calls.length, 3, 'three chunks issued');
    const joined = errorAccumulator.join('|');
    // Chunk 2 covers ids 501..1000 — at least the first and last should be there
    assert.ok(/#501\b/.test(joined), 'failed chunk start id (#501) must appear in errors');
    assert.ok(/#1000\b/.test(joined), 'failed chunk end id (#1000) must appear in errors');
    // Successful chunks (1 and 3) should NOT appear in errors
    assert.ok(!/#1\b/.test(joined), 'successful chunk ids must not appear in errors');
    assert.ok(!/#1500\b/.test(joined), 'successful chunk ids must not appear in errors');
    console.log('PASS chunk-level failures surface every id of the failed chunk');
}

async function testReproducesLegacyBehaviourBeforeFix() {
    // Before issue #2749 was filed, the legacy flow was a server-side form POST
    // to {tableId}/_m_del_select. Re-implement it locally so we can document
    // what is being replaced.
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
        if (url === `${API}/3596` && init && init.body && init.body.includes('_m_del_select=1')) {
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
    await testBulkDeleteByFilterUsesBatchEndpoint();
    await testBulkDeleteByFilterSurfacesPerRecordErrors();
    await testBulkDeleteByFilterHandlesChunkLevelFailure();
    console.log('\nAll issue #2749 tests passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
