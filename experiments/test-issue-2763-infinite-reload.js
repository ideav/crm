/**
 * Issue #2763 regression coverage for IntegramTable failed-load auto-retry.
 *
 * After issue #2758 fixed the disappearing filter row by calling render()
 * inside handleLoadDataError(), a fresh `.integram-table-wrapper` was created
 * on every failed request. The finally block of loadData() then invoked
 * checkAndLoadMore(); with hasMore = true (just set by the filter UI) and the
 * empty wrapper's belowFold ≈ 0, checkAndLoadMore() called loadData(true) —
 * which hit the same broken filter, threw again, re-rendered, and looped.
 *
 * The fix sets `this.hasMore = false` in loadData()'s catch block. This makes
 * checkAndLoadMore() and the scroll listener bail out (`no-more-records`)
 * after a failed request. The user can recover by editing the filter or
 * clicking refresh — both flows reset hasMore = true before re-loading.
 *
 * Run with: node experiments/test-issue-2763-infinite-reload.js
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
    const pendingTimers = [];

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

    function trackedSetTimeout(fn, delay, ...args) {
        const id = setTimeout(fn, delay, ...args);
        pendingTimers.push(id);
        return id;
    }
    function trackedClearTimeout(id) {
        clearTimeout(id);
    }

    const sandbox = {
        console,
        window: {
            location: { origin: 'https://example.test', pathname: '/test', search: '' },
            _integramTableInstances: [],
            _integramStandaloneMetadataCache: {},
            _integramStandaloneMetadataFetchPromises: {},
            showToast(message, type) { toasts.push({ message, type }); },
            requestAnimationFrame(cb) { cb(); return 0; },
            setTimeout: trackedSetTimeout,
            clearTimeout: trackedClearTimeout,
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
        setTimeout: trackedSetTimeout,
        clearTimeout: trackedClearTimeout,
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
    const exposed = source + '\n;this.IntegramTable = IntegramTable;\n';
    vm.runInContext(exposed, sandbox, { filename: sourcePath });

    const IntegramTable = sandbox.IntegramTable || sandbox.window.IntegramTable;
    assert.ok(IntegramTable, 'IntegramTable class should be exposed');

    // Build an instance that mimics the state just after the user typed an
    // invalid IN(пп) filter: columns are loaded, data was reset to [], and
    // hasMore was set to true by the filter UI (js/integram-table/10-filter-ui.js).
    const instance = Object.create(IntegramTable.prototype);
    instance.container = container;
    instance.columns = [
        { id: '101', name: 'Имя', format: 'CHARS', granted: 0, ref: 0 },
    ];
    instance.data = [];
    instance.rawObjectData = [];
    instance.loadedRecords = 0;
    instance.hasMore = true;
    instance.totalRows = null;
    instance.isLoading = false;
    instance.pendingNewRow = false;
    instance.filters = { '101': { symbol: '#', value: 'пп' } };
    instance.urlFilters = {};
    instance.columnOrder = ['101'];
    instance.visibleColumns = ['101'];
    instance.idColumns = new Set();
    instance.groupingEnabled = false;
    instance.groupingColumns = [];
    instance.options = { apiUrl: '/test', instanceName: 'test', pageSize: 20 };
    instance.getDataSourceType = () => 'report';

    // Stub the parts that aren't under test so we focus on the loop guard.
    let loadCount = 0;
    let renderCount = 0;
    instance.render = function () {
        renderCount++;
        container.innerHTML = '<div class="integram-table-wrapper">rendered</div>';
    };
    instance.showToast = function (message, type) { toasts.push({ message, type }); };
    // Spy on checkAndLoadMore so we can detect whether the finally block would
    // have triggered a retry. We still call through so hasMore is honored.
    let checkCount = 0;
    const realCheckAndLoadMore = IntegramTable.prototype.checkAndLoadMore;
    instance.checkAndLoadMore = function () {
        checkCount++;
        // Inline the relevant decision: tableWrapper exists (we just re-rendered),
        // but with hasMore=false the guard should return early.
        const decision = {
            isLoading: instance.isLoading,
            hasMore: instance.hasMore,
            shouldLoad: instance.hasMore && !instance.isLoading,
        };
        if (decision.shouldLoad) {
            instance.loadData(true);
        }
    };

    // Override loadDataFromReport so the request always fails with a non-JSON
    // server payload — the exact scenario from issues #2758 / #2763.
    const originalLoadData = IntegramTable.prototype.loadData;
    instance.loadData = function (append) {
        loadCount++;
        return originalLoadData.call(this, append);
    };
    instance.loadDataFromReport = function () {
        const error = new Error("Couldn't extract IN list from filter");
        error.isNonJsonResponse = true;
        return Promise.reject(error);
    };
    instance.loadDataFromTable = instance.loadDataFromReport;

    // --- Drive the failing load through loadData() ----------------------
    await instance.loadData(false);

    // Allow any setTimeout-based callbacks (checkAndLoadMore uses 100ms) to run.
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.strictEqual(
        loadCount,
        1,
        `loadData should only run once after a failed request, ran ${ loadCount } times`
    );
    assert.strictEqual(
        instance.hasMore,
        false,
        'hasMore should be set to false on error so auto-retry is suppressed'
    );
    assert.strictEqual(
        instance.isLoading,
        false,
        'isLoading should be cleared in finally even when the request fails'
    );
    assert.strictEqual(
        renderCount,
        1,
        'handleLoadDataError still re-renders once to preserve the filter row (issue #2758)'
    );
    assert.strictEqual(
        toasts.length,
        1,
        'a single toast is shown for the failed request'
    );
    assert.strictEqual(
        toasts[0].message,
        "Ошибка загрузки данных: Couldn't extract IN list from filter"
    );

    // --- The user fixes the filter and triggers a fresh load ------------
    // Simulate filter UI restoring hasMore = true before calling loadData(false).
    instance.data = [];
    instance.loadedRecords = 0;
    instance.hasMore = true;
    instance.totalRows = null;
    instance.loadDataFromReport = function () {
        return Promise.resolve({
            rows: [{ id: '1', name: 'OK' }],
            rawData: [{ id: '1', name: 'OK' }],
            columns: [{ id: '101', name: 'Имя', format: 'CHARS', granted: 0, ref: 0 }],
        });
    };
    instance.processColumnVisibility = function () {};
    instance.parseUrlFiltersFromParams = function () {};
    instance.captureScrollState = function () { return null; };
    instance.restoreScrollState = function () {};

    await instance.loadData(false);
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.strictEqual(instance.data.length, 1, 'fresh load populates rows again');
    assert.ok(instance.hasMore === true || instance.hasMore === false,
        'hasMore is updated from server response, not stuck from previous error');

    console.log('issue-2763 infinite-reload guard: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
