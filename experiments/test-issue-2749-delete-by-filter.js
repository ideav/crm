/*
 * Test for issues #2749 + #3260: js/integram-table/23-bulk-export.js
 *
 * "Удалить по фильтру" deletes every record matching the current filter.
 *
 * #2749 first implemented this by fetching all matching ids client-side and
 * deleting them in chunks via /_m_del_batch. On large tables that meant loading
 * up to 1,000,000 rows, which exhausted PHP memory (#3260). #3260 switches the
 * delete to the server-side _m_del_select path: the server SELECTs and deletes
 * matching rows in one request, returning {deleted:N} — no row payload fetched.
 *
 * This test verifies the #3260 behaviour:
 *   1. fetchFilterMatchCount() hits /object/{id}/?JSON_OBJ&_count=1 with the
 *      current filters/parent forwarded (the confirm popup count).
 *   2. bulkDeleteByFilter() sends ONE POST to /object/{id}/?JSON carrying
 *      _m_del_select=1 + the same filter — NOT a 1,000,000-row export, NOT
 *      _m_del_batch, NOT per-record _m_del/{id}.
 *   3. The {deleted:N} count is surfaced to the user and the table reloads.
 *   4. A server error (JSON {error} or non-JSON body) is shown, not swallowed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
            if (depth === 0) return moduleSource.slice(match.index + 1, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

const methodSources = [
    extractMethod('bulkDeleteByFilter'),
    extractMethod('fetchFilterMatchCount'),
    extractMethod('appendCurrentFilters'),
].join('\n');

const Host = new Function('fetchRef', 'documentRef', `
    const fetch = (...args) => fetchRef(...args);
    const document = new Proxy({}, { get(_, prop) { return documentRef()[prop]; } });
    const xsrf = 'XSRFTOKEN';
    class Host {
        constructor(opts) { Object.assign(this, opts); }
        getApiBase() { return this._apiBase; }
        applyFilter(params, column, filter) {
            if (filter.type === '=') params.set('F_' + column.id, filter.value);
            else if (filter.type === '^') params.set('FR_' + column.id, filter.value);
        }
        appendPageUrlParams() {}
        escapeHtml(s) { return String(s); }
        showToast(msg, level) { (this.toasts = this.toasts || []).push({ msg, level }); }
        loadData() { this.reloadCalls = (this.reloadCalls || 0) + 1; return Promise.resolve(); }
        loadDataFromTableForExport() { this.exportCalled = true; return Promise.resolve({ rawData: [] }); }
        ${methodSources}
    }
    return Host;
`)(
    (...args) => global.fetch(...args),
    () => global.document
);

function defaultDocument() {
    const errorsNode = { style: {}, innerHTML: '', appendChild() {} };
    return {
        _errorsNode: errorsNode,
        body: { insertAdjacentHTML() {} },
        getElementById() {
            return {
                querySelector(sel) {
                    if (sel === '.bulk-delete-errors') return errorsNode;
                    return { style: {}, textContent: '', innerHTML: '', appendChild() {} };
                },
                remove() {},
            };
        },
        createElement() { return { className: '', style: {}, textContent: '', addEventListener() {} }; },
    };
}

function jsonResponse(status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, async text() { return text; }, async json() { return JSON.parse(text); } };
}

const API = 'https://example.test/db';

async function testFetchFilterMatchCount() {
    global.document = defaultDocument();
    const calls = [];
    global.fetch = async (url) => {
        calls.push(url);
        const m = url.match(/^https:\/\/example\.test\/db\/object\/3596\/\?JSON_OBJ&(.+)$/);
        assert.ok(m, `unexpected count url ${url}`);
        const qs = new URLSearchParams(m[1]);
        assert.strictEqual(qs.get('_count'), '1');
        assert.strictEqual(qs.get('F_3597'), 'foo');
        assert.strictEqual(qs.get('F_U'), '999');
        return jsonResponse(200, { count: 7 });
    };
    const tbl = new Host({
        _apiBase: API, objectTableId: '3596',
        columns: [{ id: '3597' }], filters: { '3597': { type: '=', value: 'foo' } },
        options: { parentId: '999' },
    });
    const count = await tbl.fetchFilterMatchCount();
    assert.strictEqual(count, 7);
    assert.strictEqual(calls.length, 1);
    console.log('PASS fetchFilterMatchCount forwards filters + parent to the _count endpoint');
}

async function testBulkDeleteUsesServerSideSelect() {
    // #3260: ONE POST to /object/{id}/?JSON with _m_del_select=1 + filter.
    // No 1M export, no _m_del_batch, no per-record _m_del.
    global.document = defaultDocument();
    let delCall = null;
    global.fetch = async (url, init) => {
        if (/\/_m_del_batch\//.test(url)) throw new Error('_m_del_batch must NOT be used (#3260)');
        if (/\/_m_del\/\d+/.test(url)) throw new Error('per-record _m_del must NOT be used');
        if (/object\/3596\/\?JSON$/.test(url) && init && init.method === 'POST') {
            delCall = { url, body: new URLSearchParams(init.body) };
            return jsonResponse(200, { deleted: 22462 });
        }
        throw new Error(`Unexpected fetch ${url}`);
    };
    const tbl = new Host({
        _apiBase: API, objectTableId: '3596',
        columns: [{ id: '3597' }], filters: { '3597': { type: '=', value: 'foo' } },
        options: {},
        selectedRows: new Set(), data: [], rawObjectData: [], loadedRecords: 0, hasMore: true, totalRows: null,
    });
    await tbl.bulkDeleteByFilter();

    assert.ok(delCall, 'a server-side delete request must be sent');
    assert.strictEqual(delCall.body.get('_m_del_select'), '1', '_m_del_select trigger must be present');
    assert.strictEqual(delCall.body.get('F_3597'), 'foo', 'the current filter must be forwarded');
    assert.strictEqual(delCall.body.get('JSON'), '1', 'JSON flag makes the server answer JSON, not a redirect');
    assert.strictEqual(delCall.body.get('_xsrf'), 'XSRFTOKEN', 'xsrf must be sent');
    assert.strictEqual(tbl.exportCalled, undefined, 'must NOT fetch all rows for export (no OOM)');
    const toast = (tbl.toasts || []).find(t => t.level === 'success');
    assert.ok(toast && /22462/.test(toast.msg), 'deleted count must be reported to the user');
    assert.strictEqual(tbl.reloadCalls, 1, 'table reloads once after delete');
    console.log('PASS bulkDeleteByFilter deletes server-side via _m_del_select (one request, no export)');
}

async function testBulkDeleteSurfacesServerError() {
    global.document = defaultDocument();
    global.fetch = async (url, init) => {
        if (/object\/3596\/\?JSON$/.test(url) && init.method === 'POST')
            return jsonResponse(403, { error: 'У вас нет прав на массовое удаление' });
        throw new Error(`Unexpected fetch ${url}`);
    };
    const tbl = new Host({
        _apiBase: API, objectTableId: '3596', columns: [], filters: {}, options: {},
        selectedRows: new Set(), data: [], rawObjectData: [], loadedRecords: 0, hasMore: true, totalRows: null,
    });
    await tbl.bulkDeleteByFilter();
    const errHtml = global.document._errorsNode.innerHTML;
    assert.ok(/нет прав на массовое удаление/.test(errHtml), 'server error must be shown to the user');
    assert.ok(!(tbl.toasts || []).some(t => t.level === 'success'), 'no success toast on error');
    console.log('PASS bulkDeleteByFilter surfaces a server-side delete error');
}

(async function run() {
    await testFetchFilterMatchCount();
    await testBulkDeleteUsesServerSideSelect();
    await testBulkDeleteSurfacesServerError();
    console.log('\nAll issue #2749/#3260 tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
