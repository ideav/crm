// Verification of the token-iteration short-circuit from issue #2930 (js/app.js).
//
// Reviewer comment: «Зачем каждый раз перебирать все токены?» — hasValidAuthToken()
// used to keep calling validateToken() (a GET xsrf network request) for EVERY idb_*
// cookie even after a valid non-guest token had already been found. The decision it
// feeds (App._captchaBypass) only needs to know whether *some* valid non-guest token
// exists, so the loop must stop at the first one.
//
// This test loads the real js/app.js in a sandbox (same harness as issue #2906),
// counts how many xsrf requests hasValidAuthToken() actually issues, and asserts the
// loop short-circuits while keeping the original true/false result unchanged.
//
// Run with: node experiments/issue-2930-token-scan.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

// Minimal cookie jar backing a mutable document.cookie (see issue #2906 test).
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

// Build a sandbox, run app.js inside it, and return { ctx, calls } where calls is a
// running list of the db names that received an xsrf request, in order.
function makeSandbox(cookies, xsrfResponder) {
    const cookieJar = makeCookieJar(cookies);
    const calls = [];
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
        fetch: async (url) => {
            const m = /\/([^/]+)\/xsrf/.exec(url);
            calls.push(m ? m[1] : url);
            return xsrfResponder(url);
        },
        _cookieJar: cookieJar,
    };
    ctx.window.localStorage = ctx.localStorage;
    vm.createContext(ctx);
    vm.runInContext(appSrc, ctx);
    return { ctx, calls };
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
    if (!cond) { failures++; if (extra !== undefined) console.log('  ', extra); }
}

// document.cookie has no deterministic order, so order-independent checks where it
// matters; for short-circuit counts we use single-valid-token scenarios so the count
// is unambiguous regardless of iteration order.
async function run() {
    // 1) First (and only) token valid => exactly ONE xsrf request, bypass = true.
    {
        const { ctx, calls } = makeSandbox(
            { idb_acme: 'tok-acme' },
            responderFrom({ acme: { ok: true, body: { _xsrf: 'x1', user: 'alice' } } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === true, 'single valid token => bypass');
        assert(calls.length === 1, 'single valid token => exactly 1 xsrf request', calls);
    }

    // 2) The KEY regression: many cookies but the first checked is valid => the loop
    //    must stop immediately, NOT probe every remaining cookie.
    {
        const { ctx, calls } = makeSandbox(
            { idb_a: 't-a', idb_b: 't-b', idb_c: 't-c', idb_d: 't-d' },
            // Every db would validate, but we must never reach past the first.
            responderFrom({
                a: { ok: true, body: { _xsrf: 'x', user: 'alice' } },
                b: { ok: true, body: { _xsrf: 'x', user: 'bob' } },
                c: { ok: true, body: { _xsrf: 'x', user: 'carol' } },
                d: { ok: true, body: { _xsrf: 'x', user: 'dave' } },
            })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === true, 'four valid tokens => bypass');
        assert(calls.length === 1,
            'short-circuit: stops after first valid token (1 request, not 4)', calls);
    }

    // 3) No valid token anywhere => the loop legitimately checks ALL cookies and
    //    returns false (no short-circuit is possible, behaviour unchanged).
    {
        const { ctx, calls } = makeSandbox(
            { idb_x: 't-x', idb_y: 't-y', idb_z: 't-z' },
            responderFrom({
                x: { ok: false, status: 401 },
                y: { ok: true, body: { user: 'guest' } },
                z: { network: false },
            })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'no valid token => no bypass');
        assert(calls.length === 3, 'no valid token => all cookies probed (3 requests)', calls);
    }

    // 4) Behaviour preserved: a guest token never bypasses the captcha.
    {
        const { ctx } = makeSandbox(
            { idb_demo: 'tok-demo' },
            responderFrom({ demo: { ok: true, body: { _xsrf: 'x', user: 'guest' } } })
        );
        const bypass = await ctx.hasValidAuthToken('example.com');
        assert(bypass === false, 'guest token => no bypass (behaviour preserved)');
    }

    console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
}

run();
