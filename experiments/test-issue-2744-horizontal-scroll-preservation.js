/**
 * Test for issue #2744: after auto-scroll triggers a paginated load, the
 * horizontal scroll position of a wide .integram-table-container must NOT
 * snap back to 0.
 *
 * The synchronous scrollLeft restore was already in place from issue #2129,
 * but three follow-up problems still allowed the table to drift back to 0:
 *
 *   1. The sticky scrollbar element is re-created by innerHTML on every render
 *      and starts at scrollLeft=0. The next time it fired a scroll event it
 *      would snap the table back to scrollLeft=0 via syncFromSticky.
 *   2. Layout shifts that fire AFTER restoreScrollState (ResizeObserver, font/
 *      image load, etc.) could clamp scrollLeft back to 0 if they happened
 *      before the new <tbody> rows had been laid out.
 *   3. loadGlobalMetadata() and loadParentInfo() both call render() asynchronously
 *      without any scroll preservation at all.
 *
 * This test exercises all three paths against the real integram-table.js code.
 */

const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

function createScrollContainer(scrollTop, scrollLeft, scrollWidth = 2400, clientWidth = 800) {
    return {
        scrollTop,
        scrollLeft,
        clientHeight: 320,
        scrollHeight: 1200,
        scrollWidth,
        clientWidth,
        getBoundingClientRect: () => ({ bottom: 500 })
    };
}

function createStickyScrollbar() {
    return { scrollLeft: 0 };
}

function setupGlobals(stickyScrollbar) {
    global.window = {
        scrollY: 0,
        scrollX: 0,
        innerHeight: 800,
        scrollTo: () => {
            throw new Error('window scroll should not be used when table container exists');
        },
        requestAnimationFrame: (cb) => { queueMicrotask(cb); },
        INTEGRAM_DEBUG: false
    };
    global.document = {
        documentElement: { scrollHeight: 1200 },
        querySelector: () => null,
        getElementById: (id) => {
            if (id === 'test-table-sticky-scrollbar') return stickyScrollbar;
            return null;
        }
    };
}

function buildTable(scrollContainer) {
    const table = Object.create(IntegramTable.prototype);
    table._scrollContainer = scrollContainer;
    table.container = {
        id: 'test-table',
        querySelector: (selector) => {
            if (selector === '.integram-table-container') return table._scrollContainer;
            return null;
        }
    };
    return table;
}

async function testAppendPathPreservesScroll() {
    const sticky = createStickyScrollbar();
    setupGlobals(sticky);

    const table = buildTable(createScrollContainer(420, 853));
    table.isLoading = false;
    table.hasMore = true;
    table.pendingNewRow = null;
    table.data = [[1], [2], [3]];
    table.rawObjectData = [];
    table.loadedRecords = 3;
    table.totalRows = null;
    table.options = { pageSize: 3, onDataLoad: null };
    table.columns = [{ id: 'name' }];
    table.columnOrder = ['name'];
    table.visibleColumns = ['name'];
    table.idColumns = new Set();
    table.urlFilters = {};
    table.groupingEnabled = false;
    table.groupingColumns = [];
    table.getDataSourceType = () => 'report';
    table.loadDataFromReport = async () => ({
        rows: [[4], [5]],
        rawData: [],
        columns: [{ id: 'name' }]
    });
    table.processColumnVisibility = () => {};
    table.parseUrlFiltersFromParams = () => {};
    table.checkAndLoadMore = () => {};

    let renderCount = 0;
    table.render = () => {
        renderCount += 1;
        // Each render creates a fresh container + sticky scrollbar with scrollLeft=0,
        // mirroring what innerHTML replacement does in the production code.
        table._scrollContainer = createScrollContainer(0, 0);
        sticky.scrollLeft = 0;
    };

    await table.loadData(true);
    // Let the rAF re-restore (queued via microtask in this test) fire.
    await new Promise((resolve) => queueMicrotask(resolve));

    assert.strictEqual(renderCount, 1, 'append load should render exactly once');
    assert.strictEqual(table.loadedRecords, 5, 'append load should add new rows');
    assert.strictEqual(table._scrollContainer.scrollTop, 420,
        'vertical scroll offset should survive append render');
    assert.strictEqual(table._scrollContainer.scrollLeft, 853,
        'horizontal scroll offset should survive append render (issue #2744)');
    assert.strictEqual(sticky.scrollLeft, 853,
        'sticky scrollbar should be synced to the restored horizontal scroll');
    console.log('ok - append render preserves horizontal scroll and syncs sticky scrollbar');
}

async function testRestoreSurvivesLateLayoutShift() {
    const sticky = createStickyScrollbar();
    setupGlobals(sticky);

    // Pretend a late ResizeObserver fires between the synchronous restore and
    // the rAF re-restore, resetting scrollLeft to 0.
    let rafCallback = null;
    global.window.requestAnimationFrame = (cb) => { rafCallback = cb; };

    const table = buildTable(createScrollContainer(420, 853));
    table.isLoading = false;
    table.hasMore = true;
    table.pendingNewRow = null;
    table.data = [[1]];
    table.rawObjectData = [];
    table.loadedRecords = 1;
    table.totalRows = null;
    table.options = { pageSize: 3, onDataLoad: null };
    table.columns = [{ id: 'name' }];
    table.columnOrder = ['name'];
    table.visibleColumns = ['name'];
    table.idColumns = new Set();
    table.urlFilters = {};
    table.groupingEnabled = false;
    table.groupingColumns = [];
    table.getDataSourceType = () => 'report';
    table.loadDataFromReport = async () => ({
        rows: [[2]],
        rawData: [],
        columns: [{ id: 'name' }]
    });
    table.processColumnVisibility = () => {};
    table.parseUrlFiltersFromParams = () => {};
    table.checkAndLoadMore = () => {};
    table.render = () => {
        table._scrollContainer = createScrollContainer(0, 0);
        sticky.scrollLeft = 0;
    };

    await table.loadData(true);

    // Synchronous restore happened — scrollLeft should be 853.
    assert.strictEqual(table._scrollContainer.scrollLeft, 853,
        'synchronous restore should set scrollLeft to 853');

    // Simulate a late layout shift that resets scroll position.
    table._scrollContainer.scrollLeft = 0;
    sticky.scrollLeft = 0;

    // Fire the rAF re-restore.
    assert.strictEqual(typeof rafCallback, 'function',
        'append path should schedule a requestAnimationFrame re-restore');
    rafCallback();

    assert.strictEqual(table._scrollContainer.scrollLeft, 853,
        'rAF re-restore should defeat late layout shifts (issue #2744)');
    assert.strictEqual(sticky.scrollLeft, 853,
        'rAF re-restore should also re-sync the sticky scrollbar');
    console.log('ok - rAF re-restore defeats late layout shifts');
}

function testRenderPreservingScrollHelper() {
    const sticky = createStickyScrollbar();
    setupGlobals(sticky);

    const table = buildTable(createScrollContainer(120, 600));

    let rafCallback = null;
    global.window.requestAnimationFrame = (cb) => { rafCallback = cb; };

    let renderCount = 0;
    table.render = () => {
        renderCount += 1;
        table._scrollContainer = createScrollContainer(0, 0);
        sticky.scrollLeft = 0;
    };

    table.renderPreservingScroll(() => table.render());

    assert.strictEqual(renderCount, 1, 'helper should invoke the render callback exactly once');
    assert.strictEqual(table._scrollContainer.scrollLeft, 600,
        'helper should restore horizontal scroll synchronously');
    assert.strictEqual(table._scrollContainer.scrollTop, 120,
        'helper should restore vertical scroll synchronously');
    assert.strictEqual(sticky.scrollLeft, 600,
        'helper should sync the sticky scrollbar to the restored scroll');

    table._scrollContainer.scrollLeft = 0;
    sticky.scrollLeft = 0;
    assert.strictEqual(typeof rafCallback, 'function',
        'helper should schedule a requestAnimationFrame re-restore');
    rafCallback();
    assert.strictEqual(table._scrollContainer.scrollLeft, 600,
        'helper rAF re-restore should defeat late layout shifts');
    console.log('ok - renderPreservingScroll helper restores horizontal scroll twice');
}

function testLoadGlobalMetadataPreservesScroll() {
    const sticky = createStickyScrollbar();
    setupGlobals(sticky);

    let rafCalls = 0;
    global.window.requestAnimationFrame = () => { rafCalls += 1; };

    const table = buildTable(createScrollContainer(50, 410));
    table.columns = [{ id: 'name' }];
    table.globalMetadataPromise = null;
    table.globalMetadata = null;
    table.options = { apiUrl: 'http://test/report/1' };
    table.getApiBase = () => 'http://test';

    global.fetch = async () => ({
        ok: true,
        json: async () => ({ id: 1 })
    });

    let renderCount = 0;
    table.render = () => {
        renderCount += 1;
        table._scrollContainer = createScrollContainer(0, 0);
        sticky.scrollLeft = 0;
    };

    return table.loadGlobalMetadata().then(() => {
        assert.strictEqual(renderCount, 1, 'metadata path should render exactly once');
        assert.strictEqual(table._scrollContainer.scrollLeft, 410,
            'loadGlobalMetadata render must preserve horizontal scroll (issue #2744)');
        assert.strictEqual(sticky.scrollLeft, 410,
            'loadGlobalMetadata must keep the sticky scrollbar in sync');
        assert.ok(rafCalls >= 1, 'renderPreservingScroll should schedule a rAF re-restore');
        console.log('ok - loadGlobalMetadata preserves horizontal scroll');
    });
}

async function run() {
    await testAppendPathPreservesScroll();
    await testRestoreSurvivesLateLayoutShift();
    testRenderPreservingScrollHelper();
    await testLoadGlobalMetadataPreservesScroll();
    console.log('all issue #2744 horizontal-scroll-preservation tests passed');
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
