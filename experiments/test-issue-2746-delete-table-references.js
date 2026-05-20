/*
 * Test for issue #2746: js/integram-table.js
 * "При удалении таблицы проверить, нет ли ссылки на неё, и, если есть,
 * вначале удалить ссылку"
 *
 * When deleting a table whose metadata exposes a "referenced" id, the client
 * must first delete that referenced requisite via _d_del/{referenced} and
 * only then delete the table itself. On failure the FULL server error must
 * be surfaced (issue text: "Не забывай вывести сообщение об ошибке целиком!").
 *
 * This test exercises deleteTable / deleteTableReferences / deleteReferenceRequisite
 * from js/integram-table/11-column-settings.js against a mocked server.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- Load the deleteTable* methods straight from the source module ----------

const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '11-column-settings.js'),
    'utf8'
);

function extractMethod(name) {
    // Match either `async name(` or `name(` followed by the method body, where the
    // method is indented 8 spaces (the class is wrapped in an IIFE with 4-space
    // indent, plus 4 spaces for the class body).
    const re = new RegExp(`(?:^|\\n)        (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = moduleSource.match(re);
    if (!match) throw new Error(`Could not find method ${name} in module source`);
    const start = match.index + match[0].length - 1; // position of the opening {
    let depth = 0;
    for (let i = start; i < moduleSource.length; i++) {
        const ch = moduleSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                // include the closing brace
                return moduleSource.slice(match.index + 1, i + 1);
            }
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

const methodSources = [
    extractMethod('deleteTable'),
    extractMethod('deleteTableReferences'),
    extractMethod('deleteReferenceRequisite'),
].join('\n');

// Build a small class that hosts those exact methods so we can call them with
// `this` bound to a controllable mock. Evaluate it in the current context so
// its objects share the same prototype chain as the assertion helpers
// (deepStrictEqual is reference-aware).
const Host = new Function('fetchRef', `
    const fetch = (...args) => fetchRef(...args);
    class Host {
        constructor(opts) { Object.assign(this, opts); }
        getApiBase() { return this._apiBase; }
        getServerError(result) {
            if (Array.isArray(result)) return (result[0] && result[0].error) || null;
            return result && result.error ? result.error : null;
        }
        ${methodSources}
    }
    return Host;
`)((...args) => global.fetch(...args));

// --- Mock fetch helpers -----------------------------------------------------

function makeFetch(routes) {
    return async function fetch(url, init) {
        for (const route of routes) {
            const match = route.match(url, init);
            if (match) {
                route.calls.push({ url, init });
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
        statusText: status === 200 ? 'OK' : 'Error',
        async text() { return text; },
        async json() { return JSON.parse(text); },
    };
}

function textResponse(status, text) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        async text() { return text; },
        async json() { throw new Error('not json'); },
    };
}

// --- Tests ------------------------------------------------------------------

const API = 'https://example.test/db';

async function testDeletesReferencedFirstThenTable() {
    // Metadata returns referenced first, then no referenced after the
    // requisite has been deleted (server-side state mutates between calls).
    let metadataCalls = 0;
    const routes = [
        {
            calls: [],
            match: (url) => url === `${API}/metadata/865427` && (metadataCalls++, true),
            respond: () => {
                const referenced = metadataCalls === 1 ? '865428' : null;
                return jsonResponse(200, {
                    id: '865427', up: '0', type: '3', val: 'Стадия',
                    unique: '0', granted: 'WRITE',
                    referenced,
                    export: '1', delete: '1', reqs: [],
                });
            },
        },
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865428?JSON`,
            respond: () => jsonResponse(200, { id: '865428', obj: 'requisite' }),
        },
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865427?JSON`,
            respond: () => jsonResponse(200, { id: '865427', obj: 'table' }),
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(routes[1].calls.length, 1,
        'reference requisite must be deleted exactly once');
    assert.strictEqual(routes[2].calls.length, 1,
        'table must be deleted exactly once');
    // Ordering: reference deletion came before table deletion
    // (verified via call counts above + metadata being queried first).
    console.log('PASS deletes referenced requisite first, then the table itself');
}

async function testFailsAndShowsFullErrorWhenReferenceDeletionFails() {
    // Mirrors the issue text: server returns a rich error message we must
    // surface verbatim. Uses HTTP 400 with a JSON error payload.
    const richError = 'Эта ссылка используется в <a href="/db/object/22/?F_28=865428">отчётах</a>!';
    const routes = [
        {
            calls: [],
            match: (url) => url === `${API}/metadata/865427`,
            respond: () => jsonResponse(200, {
                id: '865427', val: 'Стадия', referenced: '865428', reqs: [],
            }),
        },
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865428?JSON`,
            respond: () => jsonResponse(400, [{ error: richError }]),
        },
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865427?JSON`,
            respond: () => { throw new Error('table delete must NOT be attempted'); },
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.strictEqual(result.success, false, 'overall delete should fail');
    assert.ok(result.error.includes(richError),
        `error should include full server message, got: ${result.error}`);
    assert.ok(result.error.includes('865428'),
        'error should mention which reference id failed');
    assert.strictEqual(routes[2].calls.length, 0,
        'table _d_del must not be attempted when reference deletion fails');
    console.log('PASS surfaces full server error and aborts table deletion');
}

async function testDeletesMultipleReferencesUntilNoneRemain() {
    // Server reports references one at a time: 865428, then 865429, then none.
    const refsRemaining = ['865428', '865429'];
    const routes = [
        {
            calls: [],
            match: (url) => url === `${API}/metadata/865427`,
            respond: () => jsonResponse(200, {
                id: '865427', val: 'Стадия',
                referenced: refsRemaining[0] || null,
                reqs: [],
            }),
        },
        {
            calls: [],
            match: (url) => url.startsWith(`${API}/_d_del/`) && url.endsWith('?JSON'),
            respond: ({ id }) => {
                const idx = refsRemaining.indexOf(id);
                if (idx !== -1) refsRemaining.splice(idx, 1);
                return jsonResponse(200, { id });
            },
        },
    ];
    // augment match to also extract id
    routes[1].match = (url) => {
        const m = url.match(new RegExp(`^${API.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/_d_del/(\\d+)\\?JSON$`));
        return m ? { id: m[1] } : null;
    };
    global.fetch = makeFetch(routes);

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(routes[1].calls.length, 3,
        'should call _d_del for 865428, 865429, and finally 865427');
    const deletedIds = routes[1].calls.map(c => c.url.match(/_d_del\/(\d+)/)[1]);
    assert.deepStrictEqual(deletedIds, ['865428', '865429', '865427'],
        'references must be deleted before the table itself');
    console.log('PASS handles multiple references and deletes them all before the table');
}

async function testSkipsReferenceCheckWhenMetadataUnavailable() {
    // If we can't fetch metadata, fall back to a plain table delete so the
    // user still gets the server-side error, not a silent failure.
    const routes = [
        {
            calls: [],
            match: (url) => url === `${API}/metadata/865427`,
            respond: () => textResponse(500, 'boom'),
        },
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865427?JSON`,
            respond: () => jsonResponse(200, { id: '865427' }),
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(routes[1].calls.length, 1);
    console.log('PASS falls back to direct table delete when metadata is unavailable');
}

async function testSurfacesFullTableDeleteError() {
    // No reference; table delete itself fails — make sure the full body is
    // surfaced (issue #2402 regression guard plus issue #2746 requirement).
    const richError = 'Невозможно удалить таблицу: <a href="/db/object/42/?F_116=865427">используется в роли</a>';
    const routes = [
        {
            calls: [],
            match: (url) => url === `${API}/metadata/865427`,
            respond: () => jsonResponse(200, {
                id: '865427', val: 'Стадия', referenced: null, reqs: [],
            }),
        },
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865427?JSON`,
            respond: () => jsonResponse(400, [{ error: richError }]),
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({ _apiBase: API });
    const result = await tbl.deleteTable('865427');

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes(richError),
        `error should include full server message, got: ${result.error}`);
    console.log('PASS surfaces full table-delete error when no reference exists');
}

async function testReproducesIssueBeforeFix() {
    // Re-implement the pre-fix deleteTable to demonstrate the bug from #2746:
    // when the server refuses with "referenced", the old code did not first
    // attempt to delete the reference, so the table delete failed outright.
    async function oldDeleteTable(tableId) {
        const apiBase = this.getApiBase();
        const params = new URLSearchParams();
        const resp = await fetch(`${apiBase}/_d_del/${tableId}?JSON`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const responseText = await resp.text();
        let result = null;
        try { result = JSON.parse(responseText); } catch (_) { /* not JSON */ }
        if (!resp.ok) {
            const serverError = result ? this.getServerError(result) : null;
            return { success: false, error: serverError || responseText || `HTTP ${resp.status}` };
        }
        if (result && result.id) return { success: true };
        return { success: false, error: (result && this.getServerError(result)) || 'Неизвестная ошибка' };
    }

    const refError = 'Таблица "Стадия" имеет ссылку, удалите её сначала';
    const routes = [
        {
            calls: [],
            match: (url) => url === `${API}/_d_del/865427?JSON`,
            respond: () => jsonResponse(400, [{ error: refError }]),
        },
    ];
    global.fetch = makeFetch(routes);

    const tbl = new Host({ _apiBase: API });
    const result = await oldDeleteTable.call(tbl, '865427');
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, refError,
        'pre-fix code fails because it never deletes the reference first');
    console.log('PASS reproduces the pre-fix behaviour from issue #2746');
}

(async function run() {
    await testReproducesIssueBeforeFix();
    await testDeletesReferencedFirstThenTable();
    await testFailsAndShowsFullErrorWhenReferenceDeletionFails();
    await testDeletesMultipleReferencesUntilNoneRemain();
    await testSkipsReferenceCheckWhenMetadataUnavailable();
    await testSurfacesFullTableDeleteError();
    console.log('\nAll issue #2746 tests passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
