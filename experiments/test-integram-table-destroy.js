/**
 * Lifecycle regression coverage for IntegramTable.destroy().
 * Run with: node experiments/test-integram-table-destroy.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function eventTarget(name) {
    return {
        name,
        additions: [],
        removals: [],
        addEventListener(type, handler, options) {
            this.additions.push({ type, handler, options });
        },
        removeEventListener(type, handler, options) {
            this.removals.push({ type, handler, options });
        }
    };
}

(async function run() {
    const element = Object.assign(eventTarget('container'), {
        id: 'lifecycle-table',
        dataset: {},
        innerHTML: '<div>rendered table</div>',
        querySelector() { return null; },
        querySelectorAll() { return []; },
        contains() { return false; }
    });
    const documentStub = Object.assign(eventTarget('document'), {
        readyState: 'loading',
        activeElement: null,
        documentElement: { contains() { return false; } },
        getElementById(id) { return id === element.id ? element : null; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    });
    const windowStub = Object.assign(eventTarget('window'), {
        location: { search: '', pathname: '/db/', hostname: 'localhost' },
        _integramTableInstances: []
    });
    const clearedTimers = [];
    const sandbox = {
        console,
        window: windowStub,
        document: documentStub,
        URLSearchParams,
        setTimeout() { return 1; },
        clearTimeout(id) { clearedTimers.push(id); },
        Map,
        Set,
        WeakMap,
        WeakSet,
        Promise,
        Object,
        Array,
        String,
        Number,
        Boolean,
        RegExp,
        Error,
        Date,
        Math,
        JSON
    };
    sandbox.window.window = windowStub;
    sandbox.window.document = documentStub;
    sandbox.globalThis = sandbox;
    sandbox.self = windowStub;

    const sourcePath = path.join(__dirname, '..', 'js', 'integram-table.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    vm.createContext(sandbox);
    vm.runInContext(
        source + '\nthis.IntegramTable = IntegramTable; this.itCreateModalCloseHandler = itCreateModalCloseHandler;',
        sandbox,
        { filename: sourcePath }
    );

    sandbox.IntegramTable.prototype.init = function initStub() {};
    const instance = new sandbox.IntegramTable(element.id, { instanceName: 'lifecycleTable' });
    element._integramTableInstance = instance;
    windowStub.lifecycleTable = instance;
    windowStub._integramTableInstances.push(instance, instance);
    instance._globalAliases = ['lifecycleTable'];

    const scrollTarget = eventTarget('scroll-container');
    const tableScrollTarget = eventTarget('table-scroll');
    const stickyTarget = eventTarget('sticky-scroll');
    const handlers = {
        full: () => {}, button: () => {}, cell: () => {}, scroll: () => {}, plus: () => {},
        height: () => {}, table: () => {}, sticky: () => {}, visibility: () => {},
        counterResize: () => {}, counterScroll: () => {}
    };
    Object.assign(instance, {
        _fullValueClickHandler: handlers.full,
        _tableButtonClickHandler: handlers.button,
        _cellClickHandler: handlers.cell,
        scrollListener: handlers.scroll,
        _scrollListenerContainer: scrollTarget,
        plusKeyListener: handlers.plus,
        _containerHeightResizeListener: handlers.height,
        tableScrollListener: handlers.table,
        _tableScrollElement: tableScrollTarget,
        stickyScrollListener: handlers.sticky,
        _stickyScrollbarElement: stickyTarget,
        stickyVisibilityListener: handlers.visibility,
        _stickyScrollContainer: scrollTarget,
        scrollCounterResizeListener: handlers.counterResize,
        scrollCounterScrollListener: handlers.counterScroll,
        filterTimeout: 11,
        _checkAndLoadMoreTimer: 12,
        _navigateTimer: 13,
        _refFilterOutsideClickTimer: 14
    });

    let heightObserverDisconnects = 0;
    let counterObserverDisconnects = 0;
    let resizeCleanups = 0;
    instance._containerHeightObserver = { disconnect() { heightObserverDisconnects += 1; } };
    instance.scrollCounterResizeObserver = { disconnect() { counterObserverDisconnects += 1; } };
    instance._columnResizeCleanup = () => {
        resizeCleanups += 1;
        instance._columnResizeCleanup = null;
    };

    let modalCloses = 0;
    const modal = { isConnected: true };
    sandbox.itCreateModalCloseHandler(modal, () => { modalCloses += 1; }, instance);
    assert.strictEqual(instance._modalCloseHandlers.size, 1, 'owned modal should be tracked');

    instance.columns = [{ id: '1' }];
    instance.data = [['row']];
    instance.rawObjectData = [{ i: 1 }];
    instance.groupedData = [{ row: true }];
    instance.selectedRows.add('1');
    instance.metadataCache = { 1: {} };
    instance.metadataFetchPromises = { 1: Promise.resolve() };
    instance.globalMetadata = [{ id: 1 }];
    instance.options.onCellClick = () => {};
    instance.options.onDataLoad = () => {};
    const previousVersion = instance._loadRequestVersion;

    instance.destroy();

    assert.strictEqual(instance._destroyed, true, 'instance should be marked destroyed');
    assert.strictEqual(instance._loadRequestVersion, previousVersion + 1, 'in-flight loads should be invalidated');
    assert.strictEqual(instance.container, null, 'container reference should be released');
    assert.strictEqual(element.innerHTML, '', 'generated child DOM should be cleared by default');
    assert.ok(!('_integramTableInstance' in element), 'element marker should be removed');
    assert.ok(!('lifecycleTable' in windowStub), 'owned global alias should be removed');
    assert.strictEqual(windowStub._integramTableInstances.length, 0, 'all duplicate registry entries should be removed');
    assert.deepStrictEqual(clearedTimers.sort((a, b) => a - b), [11, 12, 13, 14], 'all tracked timers should be cleared');
    assert.strictEqual(heightObserverDisconnects, 1, 'height observer should disconnect');
    assert.strictEqual(counterObserverDisconnects, 1, 'counter observer should disconnect');
    assert.strictEqual(resizeCleanups, 1, 'active column resize should clean up');
    assert.strictEqual(modalCloses, 1, 'owned modal should close');
    assert.strictEqual(element.removals.filter(item => item.type === 'click').length, 3, 'delegated container handlers should be removed');
    assert.strictEqual(tableScrollTarget.removals.length, 1, 'table scroll handler should be removed');
    assert.strictEqual(stickyTarget.removals.length, 1, 'sticky scrollbar handler should be removed');
    assert.ok(scrollTarget.removals.length >= 2, 'vertical and sticky visibility handlers should be removed');
    assert.ok(documentStub.removals.some(item => item.type === 'keydown'), 'keyboard handler should be removed');
    assert.ok(documentStub.removals.some(item => item.type === 'click'), 'outside-click handler should be removed');
    assert.ok(windowStub.removals.some(item => item.type === 'scroll' && item.options === true), 'capturing scroll handler should be removed');
    assert.strictEqual(instance.data.length, 0, 'row data should be released');
    assert.strictEqual(instance.columns.length, 0, 'column data should be released');
    assert.strictEqual(instance.globalMetadata, null, 'instance metadata should be released');
    assert.strictEqual(instance.options.onCellClick, null, 'consumer callbacks should be released');

    let destroyedLoadRan = false;
    instance._runLoadData = async () => { destroyedLoadRan = true; };
    await instance.loadData();
    assert.strictEqual(destroyedLoadRan, false, 'destroyed instances should not start new loads');
    instance.applyGlobalMetadata([{ id: 2 }]);
    assert.strictEqual(instance.globalMetadata, null, 'late metadata should be ignored');

    const removalCount = element.removals.length + documentStub.removals.length + windowStub.removals.length;
    instance.destroy();
    assert.strictEqual(
        element.removals.length + documentStub.removals.length + windowStub.removals.length,
        removalCount,
        'destroy should be idempotent'
    );

    console.log('PASS: destroy releases table lifecycle resources');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
