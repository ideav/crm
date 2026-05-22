/**
 * Issue #2758 regression coverage for IntegramTable filter error handling.
 *
 * When a filter triggers a request that returns a non-JSON body (e.g. the
 * server's "Couldn't extract ..." plaintext error for an invalid IN() list),
 * the table previously replaced its entire container with a static alert,
 * destroying the filter row so the user could not correct the bad input.
 *
 * The fix has two parts:
 *   1. fetchJson() surfaces the server's text instead of the cryptic
 *      "Unexpected token ..." JSON parse error.
 *   2. handleLoadDataError() preserves the rendered table when columns are
 *      already loaded, showing the error as a toast so filters stay editable.
 *
 * Run with: node experiments/test-issue-2758-non-json-error.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');

(async function run() {
    const sourcePath = path.join(rootDir, 'js', 'integram-table.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    const toasts = [];
    const fetches = [];
    const elements = new Map();

    function createElement(tag) {
        return {
            tagName: tag,
            className: '',
            style: {},
            dataset: {},
            children: [],
            innerHTML: '',
            textContent: '',
            classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
            setAttribute() {},
            removeAttribute() {},
            getAttribute() { return null; },
            appendChild(child) { this.children.push(child); return child; },
            removeChild(child) {
                const idx = this.children.indexOf(child);
                if (idx >= 0) this.children.splice(idx, 1);
                return child;
            },
            insertBefore(child) { this.children.push(child); return child; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            addEventListener() {},
            removeEventListener() {},
            getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
            cloneNode() { return createElement(tag); },
            remove() {},
            focus() {},
            blur() {},
            click() {},
        };
    }

    const container = createElement('div');
    container.id = 'integram-test-container';
    container.parentElement = { parentElement: { style: {} } };
    elements.set('integram-test-container', container);

    let nextFetchHandler = null;

    const sandbox = {
        console,
        window: {
            location: { origin: 'https://example.test', pathname: '/test', search: '' },
            _integramTableInstances: [],
            _integramStandaloneMetadataCache: {},
            _integramStandaloneMetadataFetchPromises: {},
            showToast(message, type) { toasts.push({ message, type }); },
            requestAnimationFrame(cb) { cb(); return 0; },
            setTimeout,
            clearTimeout,
            innerWidth: 1024,
            innerHeight: 768,
            scrollX: 0,
            scrollY: 0,
        },
        document: {
            readyState: 'loading',
            addEventListener() {},
            removeEventListener() {},
            getElementById(id) { return elements.get(id) || null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement(tag) { return createElement(tag); },
            body: createElement('body'),
            documentElement: createElement('html'),
            activeElement: null,
            cookie: '',
        },
        fetch(url, options) {
            fetches.push({ url: String(url), options });
            if (typeof nextFetchHandler === 'function') {
                return nextFetchHandler(String(url), options);
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                statusText: 'OK',
                headers: { get() { return 'application/json'; } },
                text() { return Promise.resolve('{}'); },
                json() { return Promise.resolve({}); },
            });
        },
        URLSearchParams,
        URL,
        setTimeout,
        clearTimeout,
        Promise,
        Map,
        Set,
        WeakMap,
        WeakSet,
        Symbol,
        Date,
        Math,
        JSON,
        Array,
        Object,
        Number,
        String,
        Boolean,
        Error,
        RegExp,
        Intl,
        navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'node-test' },
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox.window;

    vm.createContext(sandbox);
    // Append a small shim so the top-level class declaration becomes reachable
    // via the sandbox (vm runs the file as a script, not a module).
    const exposed = source + '\n;this.IntegramTable = IntegramTable;\n';
    vm.runInContext(exposed, sandbox, { filename: sourcePath });

    const IntegramTable = sandbox.IntegramTable || sandbox.window.IntegramTable;
    assert.ok(IntegramTable, 'IntegramTable class should be exposed');

    // Build an instance manually without running init(), which kicks off
    // network calls and full rendering we don't need for this regression.
    const instance = Object.create(IntegramTable.prototype);
    instance.container = container;
    instance.columns = [];
    instance.data = [];
    instance.filters = {};
    instance.options = { apiUrl: '/test', instanceName: 'test', pageSize: 20 };

    // --- Part 1: fetchJson surfaces non-JSON server payload ---------------
    nextFetchHandler = () => Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get() { return 'text/plain'; } },
        text() { return Promise.resolve("Couldn't extract IN list from filter"); },
    });

    let caught;
    try {
        await instance.fetchJson('/api/test');
    } catch (error) {
        caught = error;
    }
    assert.ok(caught, 'fetchJson should reject non-JSON responses');
    assert.strictEqual(
        caught.message,
        "Couldn't extract IN list from filter",
        'fetchJson surfaces the server text instead of the JSON parse error'
    );
    assert.strictEqual(caught.isNonJsonResponse, true, 'fetchJson tags the error');

    // --- Part 2: handleLoadDataError keeps filters when columns exist ----
    instance.columns = [
        { id: '101', name: 'Имя', format: 'CHARS', granted: 0, ref: 0 },
    ];
    container.innerHTML = '<div class="integram-table-wrapper">existing filter row</div>';

    let rendered = 0;
    instance.render = function () { rendered++; container.innerHTML = '<div class="integram-table-wrapper">re-rendered</div>'; };
    instance.showToast = function (message, type) { toasts.push({ message, type }); };

    instance.handleLoadDataError(new Error("Couldn't extract IN list from filter"), false);

    assert.strictEqual(rendered, 1, 'handleLoadDataError re-renders existing table');
    assert.ok(
        container.innerHTML.includes('integram-table-wrapper'),
        'container keeps the rendered table (filters stay visible)'
    );
    assert.ok(
        !container.innerHTML.includes('alert-danger'),
        'container does not get replaced with an alert when columns exist'
    );
    assert.strictEqual(toasts.length, 1, 'a toast notifies the user about the error');
    assert.strictEqual(
        toasts[0].message,
        "Ошибка загрузки данных: Couldn't extract IN list from filter"
    );
    assert.strictEqual(toasts[0].type, 'error');

    // --- Part 3: initial-load failure still shows an inline alert --------
    const freshInstance = Object.create(IntegramTable.prototype);
    const freshContainer = createElement('div');
    freshInstance.container = freshContainer;
    freshInstance.columns = [];

    freshInstance.handleLoadDataError(new Error('Server is down'), false);

    assert.ok(
        freshContainer.innerHTML.includes('alert-danger'),
        'initial load failure (no columns yet) still surfaces inline alert'
    );
    assert.ok(
        freshContainer.innerHTML.includes('Server is down'),
        'inline alert message includes the underlying error'
    );

    console.log('issue-2758 non-JSON error handling: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
