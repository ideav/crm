/**
 * Test for issue #2072: sticky column header clone misbehaves during infinite scroll.
 *
 * Two bugs reported:
 *
 * Bug 1 ("navigation panel doesn't hide"): After infinite scroll triggers render(),
 * attachStickyHeader() is called again. Stale setTimeout callbacks from the previous
 * attachStickyHeader() closure can still fire with references to detached DOM elements.
 * The stale buildClone() creates a clone from detached nodes and shows it at position
 * top:0px (behind the navbar), and since this replaces inst._stickyTheadClone, the
 * clone stays visible even when scrolled back to the top.
 *
 * Bug 2 ("header pushed under navigation panel"): Same stale timeout issue. The stale
 * updateStickyThead() in the timeout callback uses old header.getBoundingClientRect()
 * on a detached element (returns zeros), and syncClone() sets clone.style.top = '0px',
 * pushing the clone to the top of the viewport — behind the navbar and table header.
 *
 * Root cause: When the header sticky state transitions (false→true or true→false),
 * attachStickyHeader() schedules `setTimeout(buildClone + updateStickyThead, 160)` to
 * rebuild the clone after the CSS transition. If render() + attachStickyHeader() is called
 * again within those 160ms (due to infinite scroll), the stale timeout callback fires
 * later and corrupts inst._stickyTheadClone using stale, detached DOM references.
 *
 * Fix: add a per-call cancellation token (stickyGeneration) to attachStickyHeader().
 * Each closure checks the token before executing; if the token has advanced (a newer
 * attachStickyHeader() was called), the closure exits early without making any changes.
 */

'use strict';

const window = {};

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) { console.log(`  PASS: ${message}`); passed++; }
    else { console.error(`  FAIL: ${message}`); failed++; }
}

// ---- Minimal DOM mocks ----
function makeEl(tag, className) {
    const style = {};
    const classList = new Set();
    const listeners = {};
    let _rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const el = {
        tagName: tag.toUpperCase(),
        className: className || '',
        dataset: {},
        style,
        _listeners: listeners,
        classList: {
            contains: (c) => classList.has(c),
            toggle: (c, force) => {
                if (force === undefined) { classList.has(c) ? classList.delete(c) : classList.add(c); }
                else { force ? classList.add(c) : classList.delete(c); }
                return classList.has(c);
            },
            add: (c) => classList.add(c),
            remove: (c) => classList.delete(c),
        },
        getBoundingClientRect: () => ({ ..._rect }),
        setRect(r) { _rect = { top: r.top||0, bottom: r.bottom||0, left: r.left||0, right: r.right||0, width: r.width||0, height: r.height||0 }; },
        addEventListener(event, fn) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (listeners[event]) listeners[event] = listeners[event].filter(f => f !== fn);
        },
        dispatchEvent(event) {
            const fns = listeners[event.type] || [];
            fns.forEach(fn => fn(event));
        },
        scrollLeft: 0,
        _appended: [],
        appendChild(child) { this._appended.push(child); return child; },
        cloneNode() { return makeEl(tag, className); },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        remove() {},
    };
    return el;
}

// ---- Layout constants ----
const NAVBAR_HEIGHT = 46;
const APP_CONTENT_TOP = NAVBAR_HEIGHT;  // 46
const APP_CONTENT_PADDING = 12;
const HEADER_HEIGHT_NORMAL = 55;   // full height (non-sticky)
const HEADER_HEIGHT_COMPACT = 25;  // compact height (sticky class)
const THEAD_HEIGHT = 36;

// ---- Build a fresh DOM for each test ----
function buildDOM() {
    const appContent = makeEl('div', 'app-content');
    appContent.setRect({ top: APP_CONTENT_TOP, bottom: APP_CONTENT_TOP + 800, left: 200, right: 1440, width: 1240, height: 800 });

    const header = makeEl('div', 'integram-table-header');
    const headerNaturalTop = APP_CONTENT_TOP + APP_CONTENT_PADDING;      // 58
    const headerNaturalBottom = headerNaturalTop + HEADER_HEIGHT_NORMAL;  // 113
    header.setRect({ top: headerNaturalTop, bottom: headerNaturalBottom, left: 200, right: 1440, width: 1240, height: HEADER_HEIGHT_NORMAL });

    const th1 = makeEl('th');
    const th2 = makeEl('th');
    const theadNaturalTop = headerNaturalBottom;  // 113
    th1.setRect({ top: theadNaturalTop, bottom: theadNaturalTop + THEAD_HEIGHT, left: 200, right: 500, width: 300, height: THEAD_HEIGHT });
    th2.setRect({ top: theadNaturalTop, bottom: theadNaturalTop + THEAD_HEIGHT, left: 500, right: 800, width: 300, height: THEAD_HEIGHT });

    const theadRow = makeEl('tr');
    theadRow.querySelectorAll = (sel) => sel.includes('th') ? [th1, th2] : [];
    theadRow.setRect({ top: theadNaturalTop, bottom: theadNaturalTop + THEAD_HEIGHT, left: 200, right: 1440, width: 1240, height: THEAD_HEIGHT });

    const tableContainer = makeEl('div', 'integram-table-container');
    tableContainer.setRect({ top: theadNaturalTop + THEAD_HEIGHT, bottom: APP_CONTENT_TOP + 2000, left: 200, right: 1440, width: 1240, height: 1875 });

    const table = makeEl('table', 'integram-table compact');
    table.scrollWidth = 2000;

    const tableWrapper = makeEl('div', 'integram-table-wrapper');
    tableWrapper.querySelector = (sel) => {
        if (sel === '.integram-table-header') return header;
        if (sel === '.integram-table thead tr') return theadRow;
        if (sel === '.integram-table .filter-row') return null;
        if (sel === '.integram-table') return table;
        return null;
    };

    const containerEl = makeEl('div', 'tasks-table');
    containerEl.querySelector = (sel) => {
        if (sel === '.integram-table-wrapper') return tableWrapper;
        if (sel === '.integram-table-header') return header;
        if (sel === '.integram-table-container') return tableContainer;
        return null;
    };

    return { appContent, header, headerNaturalTop, headerNaturalBottom, theadRow, tableContainer, table, tableWrapper, containerEl };
}

// ---- Callbacks tracking ----
let rafCallbacks = [];
let timeoutCallbacks = [];
const mockRAF = (cb) => { rafCallbacks.push(cb); };
const mockSetTimeout = (cb, delay) => { timeoutCallbacks.push({ cb, delay }); };

function fireAllRAF() { const cbs = rafCallbacks.splice(0); cbs.forEach(cb => cb()); }
function fireAllTimeouts() { const cbs = timeoutCallbacks.splice(0); cbs.forEach(({ cb }) => cb()); }

// ---- Global mock document ----
const appendedToBody = [];
const mockDocument = {
    body: {
        appendChild(el) {
            appendedToBody.push(el);
            el.remove = () => { const i = appendedToBody.indexOf(el); if (i >= 0) appendedToBody.splice(i, 1); };
            return el;
        }
    },
    createElement(tag) { return makeEl(tag); },
};

// ---- BUGGY implementation (current code, without cancellation token) ----
function attachStickyHeaderBuggy(inst, containerEl, doc, raf, st, scrollCont) {
    const tableWrap = containerEl.querySelector('.integram-table-wrapper');
    const header = containerEl.querySelector('.integram-table-header');
    const tableContainer = containerEl.querySelector('.integram-table-container');
    if (!tableWrap || !header || !tableContainer) return null;

    if (inst._stickyHeaderScrollListener) {
        (inst._stickyHeaderScrollContainer || scrollCont).removeEventListener('scroll', inst._stickyHeaderScrollListener);
    }
    if (inst._stickyTheadClone) {
        inst._stickyTheadClone.remove();
        inst._stickyTheadClone = null;
    }
    inst._stickyHeaderScrollContainer = scrollCont;

    const theadRow = tableWrap.querySelector('.integram-table thead tr');

    const buildClone = () => {
        if (inst._stickyTheadClone) inst._stickyTheadClone.remove();
        const originalThs = theadRow ? theadRow.querySelectorAll('th') : [];
        if (!originalThs.length) return;
        const clone = doc.createElement('div');
        clone.className = 'integram-sticky-thead-clone';
        clone.style.cssText = 'position:fixed;z-index:109;overflow:hidden;display:none;pointer-events:none;box-sizing:border-box;';
        const cloneTable = doc.createElement('table');
        const cloneThead = doc.createElement('thead');
        const cloneTr = doc.createElement('tr');
        originalThs.forEach(th => cloneTr.appendChild(th.cloneNode(true)));
        cloneThead.appendChild(cloneTr);
        cloneTable.appendChild(cloneThead);
        clone.appendChild(cloneTable);
        clone.querySelector = () => null;
        clone.querySelectorAll = () => [];
        doc.body.appendChild(clone);
        inst._stickyTheadClone = clone;
    };

    buildClone();

    const syncClone = () => {
        const clone = inst._stickyTheadClone;
        if (!clone) return;
        const containerRect = tableContainer.getBoundingClientRect();
        const headerBottom = header.getBoundingClientRect().bottom;
        clone.style.top = headerBottom + 'px';
        clone.style.left = containerRect.left + 'px';
        clone.style.width = containerRect.width + 'px';
    };

    let isStickyThead = false;

    const updateStickyThead = () => {
        const clone = inst._stickyTheadClone;
        if (!clone || !theadRow) return;
        const theadRect = theadRow.getBoundingClientRect();
        const headerBottom = header.getBoundingClientRect().bottom;
        const shouldBeSticky = theadRect.bottom <= headerBottom + 1;
        if (shouldBeSticky !== isStickyThead) {
            isStickyThead = shouldBeSticky;
            clone.style.display = shouldBeSticky ? 'block' : 'none';
        }
        if (isStickyThead) syncClone();
    };

    const updateStickyState = () => {
        const headerRect = header.getBoundingClientRect();
        const containerTop = scrollCont === window
            ? 0 : scrollCont.getBoundingClientRect().top;
        const isSticky = headerRect.top <= containerTop + 1;
        const wasSticky = header.classList.contains('sticky');
        if (isSticky !== wasSticky) {
            header.classList.toggle('sticky', isSticky);
            tableWrap.classList.toggle('sticky-header', isSticky);
            // BUG: this timeout can fire after render() + new attachStickyHeader()
            st(() => { buildClone(); updateStickyThead(); }, 160);
        }
        updateStickyThead();
    };

    inst._stickyHeaderScrollListener = updateStickyState;
    scrollCont.addEventListener('scroll', inst._stickyHeaderScrollListener);
    raf(updateStickyState);

    return {
        triggerScroll: () => (scrollCont._listeners.scroll || []).forEach(fn => fn({})),
        getIsStickyThead: () => isStickyThead,
    };
}

// ---- FIXED implementation (with cancellation token) ----
function attachStickyHeaderFixed(inst, containerEl, doc, raf, st, scrollCont) {
    const tableWrap = containerEl.querySelector('.integram-table-wrapper');
    const header = containerEl.querySelector('.integram-table-header');
    const tableContainer = containerEl.querySelector('.integram-table-container');
    if (!tableWrap || !header || !tableContainer) return null;

    if (inst._stickyHeaderScrollListener) {
        (inst._stickyHeaderScrollContainer || scrollCont).removeEventListener('scroll', inst._stickyHeaderScrollListener);
    }
    if (inst._stickyTheadClone) {
        inst._stickyTheadClone.remove();
        inst._stickyTheadClone = null;
    }
    inst._stickyHeaderScrollContainer = scrollCont;

    // Cancellation token: stale RAF/setTimeout callbacks bail out when generation advances.
    if (!inst._stickyGeneration) inst._stickyGeneration = 0;
    const myGeneration = ++inst._stickyGeneration;
    const isCancelled = () => inst._stickyGeneration !== myGeneration;

    const theadRow = tableWrap.querySelector('.integram-table thead tr');

    const buildClone = () => {
        if (isCancelled()) return;
        if (inst._stickyTheadClone) inst._stickyTheadClone.remove();
        const originalThs = theadRow ? theadRow.querySelectorAll('th') : [];
        if (!originalThs.length) return;
        const clone = doc.createElement('div');
        clone.className = 'integram-sticky-thead-clone';
        clone.style.cssText = 'position:fixed;z-index:109;overflow:hidden;display:none;pointer-events:none;box-sizing:border-box;';
        const cloneTable = doc.createElement('table');
        const cloneThead = doc.createElement('thead');
        const cloneTr = doc.createElement('tr');
        originalThs.forEach(th => cloneTr.appendChild(th.cloneNode(true)));
        cloneThead.appendChild(cloneTr);
        cloneTable.appendChild(cloneThead);
        clone.appendChild(cloneTable);
        clone.querySelector = () => null;
        clone.querySelectorAll = () => [];
        doc.body.appendChild(clone);
        inst._stickyTheadClone = clone;
    };

    buildClone();

    const syncClone = () => {
        if (isCancelled()) return;
        const clone = inst._stickyTheadClone;
        if (!clone) return;
        const containerRect = tableContainer.getBoundingClientRect();
        const headerBottom = header.getBoundingClientRect().bottom;
        clone.style.top = headerBottom + 'px';
        clone.style.left = containerRect.left + 'px';
        clone.style.width = containerRect.width + 'px';
    };

    let isStickyThead = false;

    const updateStickyThead = () => {
        if (isCancelled()) return;
        const clone = inst._stickyTheadClone;
        if (!clone || !theadRow) return;
        const theadRect = theadRow.getBoundingClientRect();
        const headerBottom = header.getBoundingClientRect().bottom;
        const shouldBeSticky = theadRect.bottom <= headerBottom + 1;
        if (shouldBeSticky !== isStickyThead) {
            isStickyThead = shouldBeSticky;
            clone.style.display = shouldBeSticky ? 'block' : 'none';
        }
        if (isStickyThead) syncClone();
    };

    const updateStickyState = () => {
        if (isCancelled()) return;
        const headerRect = header.getBoundingClientRect();
        const containerTop = scrollCont === window
            ? 0 : scrollCont.getBoundingClientRect().top;
        const isSticky = headerRect.top <= containerTop + 1;
        const wasSticky = header.classList.contains('sticky');
        if (isSticky !== wasSticky) {
            header.classList.toggle('sticky', isSticky);
            tableWrap.classList.toggle('sticky-header', isSticky);
            st(() => { buildClone(); updateStickyThead(); }, 160);
        }
        updateStickyThead();
    };

    inst._stickyHeaderScrollListener = updateStickyState;
    scrollCont.addEventListener('scroll', inst._stickyHeaderScrollListener);
    raf(updateStickyState);

    return {
        triggerScroll: () => (scrollCont._listeners.scroll || []).forEach(fn => fn({})),
        getIsStickyThead: () => isStickyThead,
    };
}

// ============================================================
// Tests
// ============================================================

console.log('\n=== Test suite for issue #2072: sticky header clone during infinite scroll ===\n');

function simulateScrolledDown(dom) {
    const headerStuckTop = APP_CONTENT_TOP;  // 46
    const headerStuckBottom = headerStuckTop + HEADER_HEIGHT_COMPACT;  // 71
    dom.header.setRect({ top: headerStuckTop, bottom: headerStuckBottom, left: 200, right: 1440, width: 1240, height: HEADER_HEIGHT_COMPACT });
    dom.theadRow.setRect({ top: -200, bottom: -200 + THEAD_HEIGHT, left: 200, right: 1440, width: 1240, height: THEAD_HEIGHT });
}

function simulateScrolledToTop(dom) {
    dom.header.setRect({ top: dom.headerNaturalTop, bottom: dom.headerNaturalBottom, left: 200, right: 1440, width: 1240, height: HEADER_HEIGHT_NORMAL });
    dom.theadRow.setRect({ top: dom.headerNaturalBottom, bottom: dom.headerNaturalBottom + THEAD_HEIGHT, left: 200, right: 1440, width: 1240, height: THEAD_HEIGHT });
}

function detachDOM(dom) {
    // Simulate elements being removed from DOM (container.innerHTML = newHtml)
    dom.header.setRect({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    dom.theadRow.setRect({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    dom.tableContainer.setRect({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
}

// ============================================================
// BUGGY IMPLEMENTATION TESTS
// ============================================================
console.log('--- Buggy implementation (current code, no cancellation token) ---\n');

{
    const dom = buildDOM();
    const inst = {};
    rafCallbacks = [];
    timeoutCallbacks = [];
    appendedToBody.length = 0;

    console.log('Test B1: Initial load - header at natural position, not sticky');
    const ctrl1 = attachStickyHeaderBuggy(inst, dom.containerEl, mockDocument, mockRAF, mockSetTimeout, dom.appContent);
    fireAllRAF();

    assert(!dom.header.classList.contains('sticky'), 'B1: Header not sticky on initial load');
    assert(inst._stickyTheadClone !== null, 'B1: Clone created on init');

    console.log('\nTest B2: Scroll down - header just becomes sticky (state transition, setTimeout scheduled)');
    // Simulate: user just scrolled enough to trigger sticky (header at top of app-content)
    simulateScrolledDown(dom);
    ctrl1.triggerScroll();
    // Now isSticky=true, wasSticky=false → setTimeout scheduled, clone shown
    assert(dom.header.classList.contains('sticky'), 'B2: Header gets .sticky after scroll');
    assert(inst._stickyTheadClone.style.display === 'block', 'B2: Clone shown when scrolled down');
    assert(timeoutCallbacks.length === 1, 'B2: One setTimeout scheduled for clone rebuild after CSS transition');

    const expectedTop = `${APP_CONTENT_TOP + HEADER_HEIGHT_COMPACT}px`;
    assert(inst._stickyTheadClone.style.top === expectedTop, `B2: Clone top = ${expectedTop}`);

    console.log('\nTest B3 (BUG): Infinite scroll fires - render() + new attachStickyHeader() within the 160ms window');
    // Before the 160ms timeout fires, infinite scroll completes and render() is called.
    // Old DOM elements are now detached (getBCR returns zeros).
    detachDOM(dom);  // simulate container.innerHTML = newHtml

    // New DOM from render()
    const dom2 = buildDOM();
    simulateScrolledDown(dom2);

    const ctrl2 = attachStickyHeaderBuggy(inst, dom2.containerEl, mockDocument, mockRAF, mockSetTimeout, dom2.appContent);
    fireAllRAF();  // fresh RAF from ctrl2: positions correctly

    assert(inst._stickyTheadClone.style.display === 'block', 'B3: Clone visible after fresh render (correct so far)');
    const cloneTopBefore = inst._stickyTheadClone.style.top;

    // Now the STALE timeout from ctrl1 fires (160ms elapsed)
    // It runs buildClone() with old theadRow (detached, returns 0 columns)
    // and updateStickyThead() with old header (detached, getBCR returns 0)
    assert(timeoutCallbacks.length >= 1, 'B3: Stale timeout from ctrl1 is still pending');
    const staleTimeout = timeoutCallbacks[0];
    staleTimeout.cb();  // fire stale timeout

    // After stale buildClone(): theadRow.querySelectorAll('th') on detached element
    // returns empty array → buildClone() returns early (no clone built since !originalThs.length)
    // BUT inst._stickyTheadClone is still the good one from ctrl2... unless buildClone removes it first

    // After stale updateStickyThead(): uses old theadRow (rect=0) and old header (rect=0)
    // shouldBeSticky = 0 <= 1 = true → shows clone
    // syncClone(): headerBottom = old header.getBCR().bottom = 0
    //              → inst._stickyTheadClone.style.top = '0px'  ← BUG!
    const cloneTopAfterStale = inst._stickyTheadClone.style.top;
    assert(cloneTopAfterStale === '0px',
        `B3 (BUG): Stale timeout set clone.top to '0px' (pushed under navbar). Got: ${cloneTopAfterStale}`);

    console.log('\nTest B4 (BUG): After stale timeout, clone stays at wrong position (bug visible to user)');
    // The stale callback has already corrupted the clone position.
    // Even after fresh scrolling, the current scroll listener from ctrl2 would fix it on
    // the NEXT scroll event. But the user sees the clone at 0px until they scroll again.
    assert(inst._stickyTheadClone.style.top !== expectedTop,
        `B4 (BUG): Clone top is ${inst._stickyTheadClone.style.top}, NOT ${expectedTop} — positioned incorrectly`);

    console.log('\nTest B5 (BUG): Scroll back to top - does clone hide correctly after stale timeout?');
    // If stale buildClone() succeeded in replacing inst._stickyTheadClone, the current
    // ctrl2 scroll listener would hide the NEW clone on scroll-up... OR if the old clone
    // was re-shown by stale timeout, the new scroll listener would hide the wrong clone.
    // Let's see what happens.
    simulateScrolledToTop(dom2);
    ctrl2.triggerScroll();
    // With bug: if clone was rebuilt from detached DOM (empty clone), it might not hide properly
    // OR the top is '0px' which shows the clone at the wrong position
}

console.log('\n');
console.log('--- Fixed implementation (with cancellation token) ---\n');

// ============================================================
// FIXED IMPLEMENTATION TESTS
// ============================================================

{
    const dom = buildDOM();
    const inst2 = {};
    rafCallbacks = [];
    timeoutCallbacks = [];
    appendedToBody.length = 0;

    console.log('Test F1: Initial load - header not sticky');
    const ctrl1 = attachStickyHeaderFixed(inst2, dom.containerEl, mockDocument, mockRAF, mockSetTimeout, dom.appContent);
    fireAllRAF();
    assert(!dom.header.classList.contains('sticky'), 'F1: Header not sticky on load');
    assert(inst2._stickyTheadClone !== null, 'F1: Clone created');

    console.log('\nTest F2: Scroll down - header becomes sticky, setTimeout scheduled');
    simulateScrolledDown(dom);
    ctrl1.triggerScroll();
    assert(dom.header.classList.contains('sticky'), 'F2: Header gets .sticky');
    assert(inst2._stickyTheadClone.style.display === 'block', 'F2: Clone shown');
    assert(timeoutCallbacks.length === 1, 'F2: setTimeout scheduled for transition');
    const expectedTop = `${APP_CONTENT_TOP + HEADER_HEIGHT_COMPACT}px`;
    assert(inst2._stickyTheadClone.style.top === expectedTop, `F2: Clone top = ${expectedTop}`);

    console.log('\nTest F3: Infinite scroll fires within 160ms window (render + new attachStickyHeader)');
    detachDOM(dom);  // old DOM becomes detached

    const dom2 = buildDOM();
    simulateScrolledDown(dom2);

    const ctrl2 = attachStickyHeaderFixed(inst2, dom2.containerEl, mockDocument, mockRAF, mockSetTimeout, dom2.appContent);
    fireAllRAF();  // fresh RAF from ctrl2

    assert(inst2._stickyTheadClone.style.display === 'block', 'F3: Clone visible after fresh render');
    const cloneTopBefore = inst2._stickyTheadClone.style.top;

    // Fire the stale timeout from ctrl1 (now invalid due to cancelled generation)
    assert(timeoutCallbacks.length >= 1, 'F3: Stale timeout from ctrl1 still pending');
    timeoutCallbacks[0].cb();  // fire stale timeout - should bail out due to isCancelled()

    // With fix: stale buildClone() and stale updateStickyThead() both return early
    // because isCancelled() = true (generation advanced by ctrl2)
    const cloneTopAfterStale = inst2._stickyTheadClone.style.top;
    assert(cloneTopAfterStale === expectedTop,
        `F3: Stale timeout did NOT corrupt clone position (still ${cloneTopAfterStale}, expected ${expectedTop})`);
    assert(inst2._stickyTheadClone.style.display === 'block',
        'F3: Clone still visible after stale timeout (not hidden by stale updateStickyThead)');

    console.log('\nTest F4: Scroll back to top - clone hides correctly (Bug 1 fixed)');
    simulateScrolledToTop(dom2);
    ctrl2.triggerScroll();
    assert(!dom2.header.classList.contains('sticky'), 'F4: Header loses .sticky when scrolled to top');
    assert(inst2._stickyTheadClone.style.display === 'none', 'F4: Clone hidden when scrolled to top');

    console.log('\nTest F5: Multiple rapid infinite scrolls - all stale callbacks cancelled');
    const dom3 = buildDOM();
    simulateScrolledDown(dom3);
    detachDOM(dom2);

    // Trigger sticky transition on dom3 to queue another timeout
    const ctrl3 = attachStickyHeaderFixed(inst2, dom3.containerEl, mockDocument, mockRAF, mockSetTimeout, dom3.appContent);
    ctrl3.triggerScroll();  // scroll while not yet sticky → triggers sticky state change
    // Actually dom3 starts at natural position, need to trigger correctly
    // Simulate: dom3 header becomes sticky immediately via scroll
    simulateScrolledDown(dom3);
    ctrl3.triggerScroll();
    assert(dom3.header.classList.contains('sticky'), 'F5: dom3 header sticky');

    // Fire all pending timeouts (stale ones from ctrl1, ctrl2, plus fresh from ctrl3)
    timeoutCallbacks.splice(0).forEach(({ cb }) => cb());

    // Only the fresh timeout from ctrl3 should execute; stale ones bail out
    const cloneTop3 = inst2._stickyTheadClone ? inst2._stickyTheadClone.style.top : 'N/A';
    assert(cloneTop3 === expectedTop, `F5: Clone top correct after multiple stale timeouts fired: ${cloneTop3}`);

    console.log('\nTest F6: Generation counter correctly increments');
    assert(inst2._stickyGeneration === 3, `F6: _stickyGeneration = ${inst2._stickyGeneration} (3 calls)`);
}

console.log('\n============================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
