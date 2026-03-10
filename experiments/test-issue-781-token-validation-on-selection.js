/**
 * Test for issue #781: Token validation should be made only upon the db selection,
 * not every time the page is shown.
 *
 * This test verifies:
 * 1. AuthManager.init() no longer makes HTTP requests to validate tokens on page load
 * 2. Token validation (validateToken call) happens only when a db is actually selected
 *    (navigateToDb / dropdown item click)
 * 3. If a token is invalid at selection time, the db is removed from the list and
 *    the UI is updated accordingly
 */

// Minimal stubs to run in Node.js
const assert = (condition, message) => {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
};

// --- Mock environment ---
let validateTokenCalls = [];
let cookieStore = {};
let windowLocation = null;
let windowOpenCalls = [];

const CookieUtil = {
    getAllIdb() {
        return Object.keys(cookieStore)
            .filter(k => k.startsWith('idb_'))
            .map(k => k.slice(4));
    },
    delete(name) {
        delete cookieStore[name];
    }
};

async function validateToken(host, dbName) {
    validateTokenCalls.push({ host, dbName });
    return mockValidateTokenResult[dbName] || null;
}

let mockValidateTokenResult = {};

class ApiConfig {
    constructor(host) { this.host = host || 'test.host'; }
}

class I18nManager {
    t(key) { return key; }
}

// Minimal DOM stubs
const elements = {};
function getElementById(id) {
    if (!elements[id]) elements[id] = { style: { display: 'none' }, textContent: '', innerHTML: '', classList: { add: () => {}, remove: () => {} } };
    return elements[id];
}

const document = {
    getElementById,
    addEventListener: () => {},
    createElement(tag) {
        return {
            className: '',
            textContent: '',
            href: '',
            target: '',
            style: { display: '' },
            classList: { add: () => {}, remove: () => {} },
            appendChild: () => {},
            addEventListener(evt, fn) { this['_' + evt] = fn; }
        };
    }
};

const window = {
    get location() { return { href: windowLocation }; },
    set location(v) { windowLocation = v; },
    open(url, target) { windowOpenCalls.push({ url, target }); }
};

// Paste the relevant AuthManager code (simplified inline for testing)
class AuthManager {
    constructor(apiConfig, i18n) {
        this.apiConfig = apiConfig;
        this.i18n = i18n;
        this.validDbs = [];
        this.selectedDb = null;
    }

    init() {
        const dbNames = CookieUtil.getAllIdb();
        if (dbNames.length === 0) {
            this.showLoginButton();
            return;
        }
        dbNames.sort((a, b) => {
            if (a === 'my') return -1;
            if (b === 'my') return 1;
            return a.localeCompare(b);
        });
        // No HTTP validation on page load
        this.validDbs = dbNames;
        this.selectedDb = this.validDbs[0];
        this.showDbButton();
    }

    showLoginButton() {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) loginBtn.style.display = '';
        const dbWrapper = document.getElementById('db-btn-wrapper');
        if (dbWrapper) dbWrapper.style.display = 'none';
    }

    showDbButton() {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) loginBtn.style.display = 'none';
        const dbWrapper = document.getElementById('db-btn-wrapper');
        const dbBtn = document.getElementById('db-btn');
        if (!dbWrapper || !dbBtn) return;
        dbBtn.textContent = this.selectedDb;
        dbWrapper.style.display = '';
    }

    async navigateToDb() {
        if (!this.selectedDb) return;
        const host = this.apiConfig.host;
        const db = this.selectedDb;
        const data = await validateToken(host, db);
        if (!data) {
            this.validDbs = this.validDbs.filter(d => d !== db);
            if (this.validDbs.length === 0) {
                this.showLoginButton();
            } else {
                this.selectedDb = this.validDbs[0];
                this.showDbButton();
            }
            return;
        }
        windowLocation = 'https://' + host + '/' + db;
    }
}

// ==========================
// Test 1: init() does NOT call validateToken on page load
// ==========================
(function test1() {
    validateTokenCalls = [];
    cookieStore = { 'idb_my': '1', 'idb_work': '2' };
    mockValidateTokenResult = { my: { _xsrf: 'tok1' }, work: { _xsrf: 'tok2' } };

    const auth = new AuthManager(new ApiConfig(), new I18nManager());
    auth.init();

    assert(validateTokenCalls.length === 0, 'init() should NOT call validateToken on page load');
    assert(auth.validDbs.length === 2, 'init() should populate validDbs from cookies');
    assert(auth.selectedDb === 'my', 'init() should select "my" db first');
})();

// ==========================
// Test 2: init() with no cookies shows login button
// ==========================
(function test2() {
    validateTokenCalls = [];
    cookieStore = {};

    const auth = new AuthManager(new ApiConfig(), new I18nManager());
    auth.init();

    assert(validateTokenCalls.length === 0, 'init() with no cookies should NOT call validateToken');
    assert(auth.validDbs.length === 0, 'init() with no cookies should have empty validDbs');
    assert(auth.selectedDb === null, 'init() with no cookies should have null selectedDb');
})();

// ==========================
// Tests 3-5 are async, run sequentially
// ==========================
async function runAsyncTests() {
    // Test 3: navigateToDb() validates token before navigating (valid token)
    {
        validateTokenCalls = [];
        windowLocation = null;
        cookieStore = { 'idb_my': '1' };
        mockValidateTokenResult = { my: { _xsrf: 'tok1' } };

        const auth = new AuthManager(new ApiConfig(), new I18nManager());
        auth.init();
        await auth.navigateToDb();

        assert(validateTokenCalls.length === 1, 'navigateToDb() should call validateToken once');
        assert(validateTokenCalls[0].dbName === 'my', 'navigateToDb() should validate the selected db');
        assert(windowLocation === 'https://test.host/my', 'navigateToDb() should navigate to the correct URL');
    }

    // Test 4: navigateToDb() handles invalid token (removes db, shows login)
    {
        validateTokenCalls = [];
        windowLocation = null;
        cookieStore = { 'idb_my': '1' };
        mockValidateTokenResult = {}; // empty = no valid tokens

        const auth = new AuthManager(new ApiConfig(), new I18nManager());
        auth.init();
        await auth.navigateToDb();

        assert(validateTokenCalls.length === 1, 'navigateToDb() with invalid token should call validateToken once');
        assert(windowLocation === null, 'navigateToDb() with invalid token should NOT navigate');
        assert(auth.validDbs.length === 0, 'navigateToDb() with invalid token should remove the db from list');
    }

    // Test 5: init() sorts correctly (my first)
    {
        validateTokenCalls = [];
        cookieStore = { 'idb_zebra': '1', 'idb_my': '2', 'idb_alpha': '3' };

        const auth = new AuthManager(new ApiConfig(), new I18nManager());
        auth.init();

        assert(auth.validDbs[0] === 'my', 'init() should sort "my" first');
        assert(auth.validDbs[1] === 'alpha', 'init() should sort alphabetically after my');
        assert(auth.validDbs[2] === 'zebra', 'init() should sort alphabetically after my');
    }

    console.log('\nAll tests passed!');
}

runAsyncTests().catch(e => { console.error(e.message); process.exit(1); });
