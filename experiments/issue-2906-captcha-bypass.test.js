// Verification of the captcha-bypass logic from issue #2906 (start.html).
// Loads the real js/app.js in a sandbox with stubbed document/window/fetch and
// exercises hasValidAuthToken() against several cookie/xsrf scenarios.
//
// Rule: if any idb_* cookie holds a token whose GET xsrf check succeeds for a
// non-guest user, the captcha is bypassed. Tokens that fail validation are
// deleted from the cookies; guest tokens never bypass the captcha.
//
// Run with: node experiments/issue-2906-captcha-bypass.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// Minimal cookie jar that backs a mutable document.cookie (get returns the
// "a=1; b=2" string; set with "name=; expires=..1970.." deletes the cookie).
function makeCookieJar(initial) {
    const jar = Object.assign({}, initial);
    return {
        get cookie() {
            return Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
        },
        set cookie(str) {
            const [pair] = str.split(';');
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            if (/expires=Thu, 01 Jan 1970/i.test(str) || value === '') {
                delete jar[name];
            } else {
                jar[name] = value;
            }
        },
        _jar: jar,
    };
}

// Build a sandbox, run app.js inside it, and return the populated context.
function makeSandbox(cookies, xsrfResponder) {
    const cookieJar = makeCookieJar(cookies);
    const documentStub = {
        addEventListener() {},          // swallow DOMContentLoaded so init() never runs
        getElementById() { return null; },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        createElement() { return { classList: { add() {} }, style: {}, addEventListener() {} }; },
        get cookie() { return cookieJar.cookie; },
        set cookie(v) { cookieJar.cookie = v; },
        documentElement: { setAttribute() {} },
        body: { appendChild() {} },
    };
    const ctx = {
        document: documentStub,
        window: { location: { hostname: 'example.com', origin: 'https://example.com', search: '' }, localStorage: null },
        localStorage: { getItem() { return null; }, setItem() {} },
        console,
        setTimeout,
        URLSearchParams,
        fetch: async (url) => xsrfResponder(url),
        _cookieJar: cookieJar,
    };
    ctx.window.localStorage = ctx.localStorage;
    vm.createContext(ctx);
    vm.runInContext(appSrc, ctx);
    return ctx;
}

// xsrf responder factory: maps db name -> { ok, body } describing the response.
function responderFrom(map) {
    return async (url) => {
        const m = /\/([^/]+)\/xsrf/.exec(url);
        const db = m ? m[1] : '';
        const entry = map[db];
        if (!entry || entry.network === false) {
            throw new Error('network error');
        }
        return {
            ok: entry.ok !== false,
            status: entry.status || (entry.ok === false ? 401 : 200),
            json: async () => entry.body,
        };
    };
}

let failures = 0;
function assert(cond, name, extra) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!cond) { failures++; if (extra) console.log('  ', extra); }
}

async function run() {
    // 1) A single valid, non-guest token bypasses the captcha.
    {
        const ctx = makeSandbox(
            { idb_acme: 'tok-acme' },
            responderFrom({ acme: { ok: true, body: { _xsrf: 'x1', user: 'alice' } } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === true, 'valid non-guest token => bypass');
        assert(ctx._cookieJar._jar.idb_acme === 'tok-acme', 'valid token kept in cookies');
    }

    // 2) Only a guest token => no bypass (guest must still see the captcha).
    {
        const ctx = makeSandbox(
            { idb_demo: 'tok-demo' },
            responderFrom({ demo: { ok: true, body: { _xsrf: 'x2', user: 'guest' } } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'guest token => no bypass');
    }

    // 3) An invalid token (HTTP 401) => deleted from cookies, no bypass.
    {
        const ctx = makeSandbox(
            { idb_stale: 'tok-stale' },
            responderFrom({ stale: { ok: false, status: 401 } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'invalid token => no bypass');
        assert(ctx._cookieJar._jar.idb_stale === undefined, 'invalid token deleted from cookies');
    }

    // 4) A 200 response without _xsrf => treated as invalid, deleted, no bypass.
    {
        const ctx = makeSandbox(
            { idb_empty: 'tok-empty' },
            responderFrom({ empty: { ok: true, body: { error: 'nope' } } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'no _xsrf in body => no bypass');
        assert(ctx._cookieJar._jar.idb_empty === undefined, 'token without _xsrf deleted');
    }

    // 5) Mixed: invalid token is deleted, valid one kept, overall bypass = true.
    {
        const ctx = makeSandbox(
            { idb_bad: 'tok-bad', idb_good: 'tok-good' },
            responderFrom({
                bad: { ok: false, status: 401 },
                good: { ok: true, body: { _xsrf: 'x5', user: 'bob' } },
            })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === true, 'mixed tokens => bypass when one is valid');
        assert(ctx._cookieJar._jar.idb_bad === undefined, 'invalid token deleted in mixed case');
        assert(ctx._cookieJar._jar.idb_good === 'tok-good', 'valid token kept in mixed case');
    }

    // 6) No idb_* cookies => no bypass.
    {
        const ctx = makeSandbox({ other: '1' }, responderFrom({}));
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'no idb_* cookies => no bypass');
    }

    // 7) Network error during check => token deleted, no bypass.
    {
        const ctx = makeSandbox(
            { idb_neterr: 'tok-net' },
            responderFrom({ neterr: { network: false } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'network error => no bypass');
        assert(ctx._cookieJar._jar.idb_neterr === undefined, 'token deleted on network error');
    }

    console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
}

run();
