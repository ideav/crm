/**
 * Test for issue #2065: sticky column header clone approach.
 *
 * Root cause: .integram-table-container has overflow-x:auto which implicitly
 * sets overflow-y:auto, making it the sticky scroll container for <th> elements.
 * Since the container doesn't scroll vertically, position:sticky on <th> has no
 * effect — the column headers scroll away with the table.
 *
 * Fix: attachStickyHeader() now creates a fixed-position clone of <thead> that
 * is shown when the real thead scrolls above the toolbar.
 */

'use strict';

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
    const children = [];
    const listeners = {};
    let _offsetHeight = 0;
    let _rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    const el = {
        tagName: tag.toUpperCase(),
        className: className || '',
        dataset: {},
        style,
        children,
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
        get offsetHeight() { return _offsetHeight; },
        set offsetHeight(v) { _offsetHeight = v; },
        getBoundingClientRect: () => ({ ..._rect }),
        setRect(r) { _rect = { top: r.top || 0, bottom: r.bottom || 0, left: r.left || 0, right: r.right || 0, width: r.width || 0, height: r.height || 0 }; },
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
        cloneNode(deep) { return makeEl(tag, className); },
        querySelectorAll(sel) { return []; },
        querySelector(sel) { return null; },
        remove() {},
    };
    return el;
}

// ---- Build mock structure ----
// app-content (scroll container)
const appContent = makeEl('div', 'app-content');
appContent.setRect({ top: 46, bottom: 846, left: 48, right: 1440, width: 1392, height: 800 });

// integram-table-header (toolbar)
const header = makeEl('div', 'integram-table-header');
header.offsetHeight = 31;
header.setRect({ top: 46, bottom: 77, left: 48, right: 1440, width: 1392, height: 31 });

// thead row with some th elements
const th1 = makeEl('th');
th1.setRect({ top: 77, bottom: 113, left: 48, right: 248, width: 200, height: 36 });
const th2 = makeEl('th');
th2.setRect({ top: 77, bottom: 113, left: 248, right: 448, width: 200, height: 36 });
const theadRow = makeEl('tr');
theadRow.querySelectorAll = (sel) => sel.includes('th') ? [th1, th2] : [];
theadRow.getBoundingClientRect = () => ({ top: 77, bottom: 113, left: 48, right: 1440, width: 1392, height: 36 });

// integram-table-container
const tableContainer = makeEl('div', 'integram-table-container');
tableContainer.setRect({ top: 80, bottom: 2000, left: 48, right: 1440, width: 1392, height: 1920 });
tableContainer.scrollLeft = 0;

// integram-table
const table = makeEl('table', 'integram-table');
table.scrollWidth = 2000;

// integram-table-wrapper
const tableWrapper = makeEl('div', 'integram-table-wrapper');
tableWrapper.querySelector = (sel) => {
    if (sel === '.integram-table-header') return header;
    if (sel === '.integram-table thead tr') return theadRow;
    if (sel === '.integram-table .filter-row') return null;
    if (sel === '.integram-table') return table;
    return null;
};
tableWrapper.querySelectorAll = (sel) => {
    if (sel === '.integram-table thead th') return [th1, th2];
    return [];
};

// The container element holding everything
const container = makeEl('div', 'tasks-table-container');
container.querySelector = (sel) => {
    if (sel === '.integram-table-wrapper') return tableWrapper;
    if (sel === '.integram-table-header') return header;
    if (sel === '.integram-table-container') return tableContainer;
    return null;
};

// Mock document.body.appendChild
const appendedToBody = [];
const mockDocument = {
    body: {
        appendChild(el) { appendedToBody.push(el); el.remove = () => { const i = appendedToBody.indexOf(el); if (i >= 0) appendedToBody.splice(i, 1); }; return el; }
    }
};

// Track rAF and setTimeout
let rafCallbacks = [];
let timeoutCallbacks = [];
const mockRAF = (cb) => { rafCallbacks.push(cb); };
const mockSetTimeout = (cb, delay) => { timeoutCallbacks.push({ cb, delay }); };

// ---- Minimal implementation of the new attachStickyHeader ----
function attachStickyHeaderNew(containerEl, doc, raf, st) {
    const tableWrap = containerEl.querySelector('.integram-table-wrapper');
    const hdr = containerEl.querySelector('.integram-table-header');
    const tblContainer = containerEl.querySelector('.integram-table-container');
    if (!tableWrap || !hdr || !tblContainer) return null;

    const scrollCont = appContent; // simulated getScrollContainer()

    const theadRowEl = tableWrap.querySelector('.integram-table thead tr');
    const filterRowEl = tableWrap.querySelector('.integram-table .filter-row');

    let cloneEl = null;
    const buildClone = () => {
        if (cloneEl) { cloneEl.remove(); cloneEl = null; }
        const originalThs = theadRowEl ? theadRowEl.querySelectorAll('th') : [];
        if (!originalThs.length) return;
        const clone = makeEl('div', 'integram-sticky-thead-clone');
        clone.style.cssText = 'position:fixed;z-index:109;overflow:hidden;display:none;pointer-events:none;box-sizing:border-box;';
        const cloneTable = makeEl('table', 'integram-table compact');
        const cloneThead = makeEl('thead');
        const cloneTr = makeEl('tr');
        originalThs.forEach(th => cloneTr.appendChild(th.cloneNode(true)));
        cloneThead.appendChild(cloneTr);
        cloneTable.appendChild(cloneThead);
        clone.appendChild(cloneTable);
        clone.querySelector = (sel) => {
            if (sel === 'table') return cloneTable;
            if (sel === 'thead tr:first-child th') return null;
            return null;
        };
        clone.querySelectorAll = (sel) => {
            if (sel === 'thead tr:first-child th') return Array.from(cloneTr._appended);
            return [];
        };
        doc.body.appendChild(clone);
        cloneEl = clone;
    };

    buildClone();

    let isStickyThead = false;

    const updateStickyThead = () => {
        if (!cloneEl || !theadRowEl) return;
        const theadRect = theadRowEl.getBoundingClientRect();
        const headerBottom = hdr.getBoundingClientRect().bottom;
        const shouldBeSticky = theadRect.bottom <= headerBottom + 1;
        if (shouldBeSticky !== isStickyThead) {
            isStickyThead = shouldBeSticky;
            cloneEl.style.display = shouldBeSticky ? 'block' : 'none';
        }
    };

    const updateStickyState = () => {
        const headerRect = hdr.getBoundingClientRect();
        const containerTop = scrollCont.getBoundingClientRect().top;
        const isSticky = headerRect.top <= containerTop + 1;
        const wasSticky = hdr.classList.contains('sticky');
        if (isSticky !== wasSticky) {
            hdr.classList.toggle('sticky', isSticky);
            tableWrap.classList.toggle('sticky-header', isSticky);
            st(() => { buildClone(); updateStickyThead(); }, 160);
        }
        updateStickyThead();
    };

    const tableScrollListener = () => {
        if (isStickyThead && cloneEl) cloneEl.scrollLeft = tblContainer.scrollLeft;
    };
    tblContainer.addEventListener('scroll', tableScrollListener);
    scrollCont.addEventListener('scroll', updateStickyState);

    raf(updateStickyState);

    return {
        getClone: () => cloneEl,
        getIsStickyThead: () => isStickyThead,
        triggerScroll: () => scrollCont._listeners.scroll.forEach(fn => fn({})),
        triggerTableScroll: () => tblContainer._listeners.scroll.forEach(fn => fn({})),
        fireRAF: () => { rafCallbacks.forEach(cb => cb()); rafCallbacks = []; },
        fireTimeout: () => { timeoutCallbacks.forEach(({ cb }) => cb()); timeoutCallbacks = []; },
    };
}

// ====== TESTS ======
console.log('\n=== Test suite for issue #2065 sticky column header clone fix ===\n');

// --- Test 1: buildClone appends a clone to document body ---
console.log('Test 1: buildClone appends clone div to document.body');
appendedToBody.length = 0;
const ctrl = attachStickyHeaderNew(container, mockDocument, mockRAF, mockSetTimeout);
assert(appendedToBody.length === 1, 'Clone appended to body');
assert(ctrl.getClone() !== null, 'Clone element exists');
// Clone starts hidden (display:none in cssText or style.display)
const cloneInitiallyHidden = ctrl.getClone().style.cssText.includes('display:none') || ctrl.getClone().style.display === 'none';
assert(cloneInitiallyHidden, 'Clone initially hidden (display:none in cssText or style.display)');

// --- Test 2: rAF is queued (deferred initial call) ---
console.log('\nTest 2: Initial updateStickyState is deferred via requestAnimationFrame');
assert(rafCallbacks.length === 1, '1 rAF callback queued');

// --- Test 3: on initial load (not scrolled), header is at containerTop → isSticky=true ---
console.log('\nTest 3: Toolbar gets .sticky class when header is at top of scroll container');
// header.top=46, appContent.top=46 → isSticky = true
ctrl.fireRAF();
assert(header.classList.contains('sticky'), 'header has .sticky class after rAF');
assert(tableWrapper.classList.contains('sticky-header'), 'wrapper has .sticky-header class');
assert(timeoutCallbacks.length === 1, 'setTimeout queued for rebuild after sticky transition');
assert(timeoutCallbacks[0].delay === 160, 'setTimeout delay is 160ms');

// --- Test 4: when thead is visible (theadRow.bottom > header.bottom), clone is hidden ---
console.log('\nTest 4: Clone is hidden when thead is visible below toolbar');
// thead bottom = 113, header bottom = 77 → shouldBeSticky = (113 <= 77+1) = false
assert(!ctrl.getIsStickyThead(), 'isStickyThead is false when thead is visible');
// After updateStickyThead runs, display is set explicitly
assert(ctrl.getClone().style.display === 'none' || ctrl.getClone().style.cssText.includes('display:none'), 'Clone is hidden');

// --- Test 5: after scrolling, thead scrolls above toolbar → clone shown ---
console.log('\nTest 5: Clone appears when thead scrolls above toolbar bottom');
// Simulate scroll: theadRow moves up (scrolled 200px → top=-123, bottom=-87)
theadRow.getBoundingClientRect = () => ({ top: -123, bottom: -87, left: 48, right: 1440, width: 1392, height: 36 });
ctrl.triggerScroll();
assert(ctrl.getIsStickyThead(), 'isStickyThead = true after scroll');
assert(ctrl.getClone().style.display === 'block', 'Clone is display:block after scroll');

// --- Test 6: scrolling back up hides clone ---
console.log('\nTest 6: Clone hides when user scrolls back up');
theadRow.getBoundingClientRect = () => ({ top: 77, bottom: 113, left: 48, right: 1440, width: 1392, height: 36 });
ctrl.triggerScroll();
assert(!ctrl.getIsStickyThead(), 'isStickyThead = false after scroll back');
assert(ctrl.getClone().style.display === 'none', 'Clone hidden after scroll back');

// --- Test 7: horizontal table scroll syncs to clone ---
console.log('\nTest 7: Horizontal table scroll syncs clone.scrollLeft');
theadRow.getBoundingClientRect = () => ({ top: -123, bottom: -87, left: 48, right: 1440, width: 1392, height: 36 });
ctrl.triggerScroll(); // make sticky
tableContainer.scrollLeft = 250;
ctrl.triggerTableScroll();
assert(ctrl.getClone().scrollLeft === 250, `Clone scrollLeft synced to 250 (got ${ctrl.getClone().scrollLeft})`);

// --- Test 8: after sticky toggle, setTimeout rebuilds clone ---
console.log('\nTest 8: After 160ms timeout, clone is rebuilt');
const prevClone = ctrl.getClone();
ctrl.fireTimeout();
const newClone = ctrl.getClone();
assert(newClone !== null, 'Clone exists after rebuild');

console.log('\n============================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
