/*
 * Test for issue #2402: js/integram-table.js Выводить полный текст ошибки
 * при удалении колонки, а не просто "Ошибка удаления: HTTP 400".
 *
 * Reproduces the original bug (only "HTTP 400" surfaced) and verifies that the
 * fix returns and renders the full server error, including HTML links.
 */

const assert = require('assert');

// --- Reproduce the relevant pieces of integram-table.js -------------------

function makeTableLike() {
    return {
        getApiBase() { return 'https://example.test/db'; },
        getServerError(result) {
            if (Array.isArray(result)) {
                return (result[0] && result[0].error) || null;
            }
            return result.error || null;
        },
    };
}

// New (fixed) implementation extracted from js/integram-table.js
async function deleteColumnFixed(colId, forced) {
    const apiBase = this.getApiBase();
    try {
        const params = new URLSearchParams();
        if (forced) params.append('forced', '1');

        const resp = await fetch(`${apiBase}/_d_del_req/${colId}?JSON`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const responseText = await resp.text();
        let result = null;
        try { result = JSON.parse(responseText); } catch (_) { /* not JSON */ }
        const serverError = result ? this.getServerError(result) : null;
        if (!resp.ok) {
            const errMsg = serverError || responseText || `HTTP ${resp.status}`;
            return { success: false, error: errMsg };
        }
        if (serverError) {
            return { success: false, hasData: true, error: serverError };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Old (buggy) implementation kept for the reproduction part of the test
async function deleteColumnOld(colId, forced) {
    const apiBase = this.getApiBase();
    try {
        const params = new URLSearchParams();
        if (forced) params.append('forced', '1');

        const resp = await fetch(`${apiBase}/_d_del_req/${colId}?JSON`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
        const result = await resp.json();
        if (Array.isArray(result) && result[0] && result[0].error) {
            return { success: false, hasData: true, error: result[0].error };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// --- Mock fetch -----------------------------------------------------------

function mockFetchHttp400WithJsonError(body) {
    return async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        async text() { return JSON.stringify(body); },
        async json() { return body; },
    });
}

function mockFetchOkWithError(body) {
    return async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() { return JSON.stringify(body); },
        async json() { return body; },
    });
}

function mockFetchOkSuccess() {
    return async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        async text() { return JSON.stringify({ success: true }); },
        async json() { return { success: true }; },
    });
}

// --- Sanitizer copy from js/integram-table.js -----------------------------

function sanitizeInlineMessageHtml(html) {
    if (html === null || html === undefined) return '';
    const str = String(html);
    const placeholderPrefix = '__SAFE_ANCHOR__';
    const safeAnchors = [];
    const withAnchorPlaceholders = str.replace(
        /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a>/gi,
        (match, quote, href, text) => {
            const trimmedHref = String(href || '').trim();
            const trimmedText = String(text || '').trim();
            if (!trimmedText) return match;
            if (!/^(https?:\/\/|\/)/i.test(trimmedHref)) return match;
            if (/^\s*javascript:/i.test(trimmedHref)) return match;
            const safeHref = trimmedHref
                .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                .replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeText = trimmedText
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const anchorHtml = `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
            const placeholder = `${placeholderPrefix}${safeAnchors.length}__`;
            safeAnchors.push(anchorHtml);
            return placeholder;
        }
    );
    let escaped = withAnchorPlaceholders
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    escaped = escaped.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
    safeAnchors.forEach((anchorHtml, index) => {
        const placeholder = `${placeholderPrefix}${index}__`;
        escaped = escaped.replace(placeholder, anchorHtml);
    });
    return escaped;
}

// --- Tests ----------------------------------------------------------------

const ISSUE_BODY = [{
    error: 'Этот реквизит используется в <a href="/sportzania/object/22/?F_28=6265">отчетах</a> или <a href="/sportzania/object/42/?F_116=6265">ролях</a>!',
}];

async function testReproduceOriginalBug() {
    global.fetch = mockFetchHttp400WithJsonError(ISSUE_BODY);
    const tbl = makeTableLike();
    const result = await deleteColumnOld.call(tbl, 6265, false);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'HTTP 400',
        'Old code surfaces only "HTTP 400" (the bug from the issue)');
    console.log('PASS reproduces issue #2402: old code returns "HTTP 400"');
}

async function testFixSurfacesFullError() {
    global.fetch = mockFetchHttp400WithJsonError(ISSUE_BODY);
    const tbl = makeTableLike();
    const result = await deleteColumnFixed.call(tbl, 6265, false);
    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.error, 'HTTP 400');
    assert.ok(result.error.includes('Этот реквизит используется в'),
        'Fixed code surfaces the full server error message');
    assert.ok(result.error.includes('href="/sportzania/object/22/?F_28=6265"'));
    assert.ok(result.error.includes('href="/sportzania/object/42/?F_116=6265"'));
    console.log('PASS fix surfaces full server error message including links');
}

async function testFixStillHandlesOkResponseWithError() {
    // When server returns 200 OK but body contains an error (column has data)
    global.fetch = mockFetchOkWithError(ISSUE_BODY);
    const tbl = makeTableLike();
    const result = await deleteColumnFixed.call(tbl, 6265, false);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.hasData, true,
        'Existing hasData flow is preserved for 200 OK responses with error body');
    assert.ok(result.error.includes('Этот реквизит используется в'));
    console.log('PASS fix preserves hasData=true behavior for 200 responses with error');
}

async function testFixHandlesSuccess() {
    global.fetch = mockFetchOkSuccess();
    const tbl = makeTableLike();
    const result = await deleteColumnFixed.call(tbl, 6265, false);
    assert.strictEqual(result.success, true);
    console.log('PASS fix preserves success path');
}

async function testFixFallsBackWhenBodyMissing() {
    global.fetch = async () => ({
        ok: false, status: 500, statusText: 'Internal Server Error',
        async text() { return ''; },
        async json() { throw new Error('no body'); },
    });
    const tbl = makeTableLike();
    const result = await deleteColumnFixed.call(tbl, 6265, false);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'HTTP 500',
        'Falls back to "HTTP <status>" when response body is empty / unparseable');
    console.log('PASS fix falls back to HTTP <status> when no body is available');
}

function testSanitizerRendersErrorLinks() {
    const sanitized = sanitizeInlineMessageHtml(
        'Ошибка удаления: ' + ISSUE_BODY[0].error
    );
    assert.ok(sanitized.includes('<a href="/sportzania/object/22/?F_28=6265" target="_blank" rel="noopener noreferrer">отчетах</a>'));
    assert.ok(sanitized.includes('<a href="/sportzania/object/42/?F_116=6265" target="_blank" rel="noopener noreferrer">ролях</a>'));
    assert.ok(/<(a|br)\b/i.test(sanitized),
        'showStatus should detect safe HTML and use innerHTML so links are clickable');
    console.log('PASS sanitizer turns error message links into safe clickable anchors');
}

(async function run() {
    await testReproduceOriginalBug();
    await testFixSurfacesFullError();
    await testFixStillHandlesOkResponseWithError();
    await testFixHandlesSuccess();
    await testFixFallsBackWhenBodyMissing();
    testSanitizerRendersErrorLinks();
    console.log('\nAll issue #2402 tests passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
