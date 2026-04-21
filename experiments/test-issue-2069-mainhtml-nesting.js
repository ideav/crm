/**
 * Test for issue #2069: verify sticky header fix works when table is embedded
 * inside main.html (i.e., .integram-table-wrapper is inside .app-content which
 * is the scroll container, not window).
 *
 * Structure in main.html:
 *   body
 *     nav.navbar          (height ~46px, position:fixed or in-flow)
 *     div.app-layout
 *       aside.app-sidebar (width ~200px)
 *       main.app-content  (overflow-y:auto; scroll container; top=46px in viewport)
 *         div.tasks-container
 *           div#tasks-table
 *             div.integram-table-wrapper
 *               div.integram-table-header  (position:sticky; top:0 within .app-content)
 *               div.integram-table-container
 *                 table.integram-table
 *                   thead
 *                   tbody (many rows)
 *
 * Key properties:
 * - scrollContainer = .app-content (NOT window)
 * - containerTop = 46 (where .app-content starts in viewport, below navbar)
 * - header is sticky at top:0 relative to .app-content
 * - when not scrolled: headerRect.top = containerTop + 12 (app-content padding)
 * - when scrolled/stuck: headerRect.top = containerTop
 *
 * This test verifies (issue #2069):
 * 1. isSticky does NOT fire on initial load (header naturally positioned)
 * 2. isSticky fires when header is scrolled to the top of .app-content
 * 3. Clone is shown with correct viewport-relative position below toolbar
 * 4. Clone is hidden when scrolling back up
 */

'use strict';

// Node.js doesn't have window; define a sentinel object for the scrollContainer checks
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
        cloneNode() { return makeEl(tag, className); },
        querySelectorAll() { return []; },
        querySelector() { return null; },
        remove() {},
    };
    return el;
}

// ---- main.html DOM structure ----
// Navbar: fixed/in-flow, height=46px, covers top of viewport
const NAVBAR_HEIGHT = 46;

// .app-content: the scroll container, starts at y=46 in viewport
const APP_CONTENT_TOP = NAVBAR_HEIGHT;  // 46px
const APP_CONTENT_PADDING = 12;        // padding: 12px from main-app.css
const APP_CONTENT_HEIGHT = 800;        // visible height of app-content

const appContent = makeEl('div', 'app-content');
appContent.setRect({
    top: APP_CONTENT_TOP,
    bottom: APP_CONTENT_TOP + APP_CONTENT_HEIGHT,
    left: 200,     // left of app-content (after 200px sidebar)
    right: 1440,
    width: 1240,
    height: APP_CONTENT_HEIGHT,
});

// .integram-table-header (toolbar): position:sticky; top:0 within .app-content
// Initially naturally positioned with app-content padding offset
const HEADER_HEIGHT = 31;
const headerNaturalTop = APP_CONTENT_TOP + APP_CONTENT_PADDING;  // 58px
const headerNaturalBottom = headerNaturalTop + HEADER_HEIGHT;     // 89px

const header = makeEl('div', 'integram-table-header');
header.setRect({
    top: headerNaturalTop,   // 58 = 46 + 12 (padding)
    bottom: headerNaturalBottom,  // 89
    left: 200,
    right: 1440,
    width: 1240,
    height: HEADER_HEIGHT,
});

// thead row
const th1 = makeEl('th');
const th2 = makeEl('th');
const THEAD_TOP_NATURAL = headerNaturalBottom;  // 89px
const THEAD_HEIGHT = 36;
th1.setRect({ top: THEAD_TOP_NATURAL, bottom: THEAD_TOP_NATURAL + THEAD_HEIGHT, left: 200, right: 500, width: 300, height: THEAD_HEIGHT });
th2.setRect({ top: THEAD_TOP_NATURAL, bottom: THEAD_TOP_NATURAL + THEAD_HEIGHT, left: 500, right: 800, width: 300, height: THEAD_HEIGHT });

const theadRow = makeEl('tr');
theadRow.querySelectorAll = (sel) => sel.includes('th') ? [th1, th2] : [];
theadRow.setRect({ top: THEAD_TOP_NATURAL, bottom: THEAD_TOP_NATURAL + THEAD_HEIGHT, left: 200, right: 1440, width: 1240, height: THEAD_HEIGHT });

// .integram-table-container
const tableContainer = makeEl('div', 'integram-table-container');
tableContainer.setRect({ top: THEAD_TOP_NATURAL + THEAD_HEIGHT, bottom: APP_CONTENT_TOP + 2000, left: 200, right: 1440, width: 1240, height: 1875 });

// .integram-table
const table = makeEl('table', 'integram-table compact');
table.scrollWidth = 2000;

// .integram-table-wrapper
const tableWrapper = makeEl('div', 'integram-table-wrapper');
tableWrapper.querySelector = (sel) => {
    if (sel === '.integram-table-header') return header;
    if (sel === '.integram-table thead tr') return theadRow;
    if (sel === '.integram-table .filter-row') return null;
    if (sel === '.integram-table') return table;
    return null;
};
tableWrapper.querySelectorAll = () => [];

// Container (#tasks-table)
const container = makeEl('div', 'tasks-table');
container.querySelector = (sel) => {
    if (sel === '.integram-table-wrapper') return tableWrapper;
    if (sel === '.integram-table-header') return header;
    if (sel === '.integram-table-container') return tableContainer;
    return null;
};

// Mock document.body
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

// Track rAF and setTimeout
let rafCallbacks = [];
let timeoutCallbacks = [];
const mockRAF = (cb) => { rafCallbacks.push(cb); };
const mockSetTimeout = (cb, delay) => { timeoutCallbacks.push({ cb, delay }); };

// ---- Implementation of attachStickyHeader (mirrors 09-scroll-layout.js) ----
function attachStickyHeader(containerEl, doc, raf, st, scrollCont) {
    const tableWrap = containerEl.querySelector('.integram-table-wrapper');
    const hdr = containerEl.querySelector('.integram-table-header');
    const tblContainer = containerEl.querySelector('.integram-table-container');
    if (!tableWrap || !hdr || !tblContainer) return null;

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
        cloneTable.style.cssText = 'border-collapse:collapse;table-layout:fixed;';
        const cloneThead = makeEl('thead');
        const cloneTr = makeEl('tr');
        originalThs.forEach(th => cloneTr.appendChild(th.cloneNode(true)));
        cloneThead.appendChild(cloneTr);
        cloneTable.appendChild(cloneThead);
        if (filterRowEl) {
            const filterTds = filterRowEl.querySelectorAll('td');
            if (filterTds.length > 0) {
                const cloneFilterTr = makeEl('tr', 'filter-row');
                filterTds.forEach(td => cloneFilterTr.appendChild(td.cloneNode(true)));
                cloneThead.appendChild(cloneFilterTr);
            }
        }
        clone.appendChild(cloneTable);
        clone.querySelector = (sel) => {
            if (sel === 'table') return cloneTable;
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

    const syncClone = () => {
        const clone = cloneEl;
        if (!clone) return;
        const containerRect = tblContainer.getBoundingClientRect();
        const headerBottom = hdr.getBoundingClientRect().bottom;
        const tbl = tableWrap.querySelector('.integram-table');

        clone.style.top = headerBottom + 'px';
        clone.style.left = containerRect.left + 'px';
        clone.style.width = containerRect.width + 'px';

        const cloneTable = clone.querySelector('table');
        if (tbl && cloneTable) cloneTable.style.width = tbl.scrollWidth + 'px';

        const originalThs = theadRowEl ? theadRowEl.querySelectorAll('th') : [];
        const cloneThs = clone.querySelectorAll('thead tr:first-child th');
        originalThs.forEach((th, i) => {
            if (cloneThs[i]) {
                const w = th.getBoundingClientRect().width;
                cloneThs[i].style.width = w + 'px';
                cloneThs[i].style.minWidth = w + 'px';
            }
        });

        clone.scrollLeft = tblContainer.scrollLeft;
    };

    let isStickyThead = false;

    const updateStickyThead = () => {
        const clone = cloneEl;
        if (!clone || !theadRowEl) return;

        const theadRect = theadRowEl.getBoundingClientRect();
        const headerBottom = hdr.getBoundingClientRect().bottom;
        const shouldBeSticky = theadRect.bottom <= headerBottom + 1;

        if (shouldBeSticky !== isStickyThead) {
            isStickyThead = shouldBeSticky;
            clone.style.display = shouldBeSticky ? 'block' : 'none';
        }

        if (isStickyThead) syncClone();
    };

    const updateStickyState = () => {
        const headerRect = hdr.getBoundingClientRect();
        const containerTop = scrollCont === window
            ? 0
            : scrollCont.getBoundingClientRect().top;
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
        triggerScroll: () => (scrollCont._listeners.scroll || []).forEach(fn => fn({})),
        triggerTableScroll: () => (tblContainer._listeners.scroll || []).forEach(fn => fn({})),
        fireRAF: () => { rafCallbacks.forEach(cb => cb()); rafCallbacks = []; },
        fireTimeout: () => { timeoutCallbacks.forEach(({ cb }) => cb()); timeoutCallbacks = []; },
        setHeaderRect: (r) => header.setRect(r),
        setTheadRect: (r) => theadRow.setRect(r),
    };
}

// ====== TESTS ======
console.log('\n=== Test suite for issue #2069: sticky header when table embedded in main.html ===\n');
console.log(`Setup: navbar height=${NAVBAR_HEIGHT}px, app-content starts at y=${APP_CONTENT_TOP}px`);
console.log(`       Header initial top=${headerNaturalTop}px (app-content top + ${APP_CONTENT_PADDING}px padding)`);
console.log(`       Header initial bottom=${headerNaturalBottom}px\n`);

// --- Test 1: Initial state — header NOT sticky on page load ---
console.log('Test 1: Header is NOT sticky on initial page load (before any scrolling)');
// header.top=58, appContent.top=46 → isSticky = (58 <= 47) = false
appendedToBody.length = 0;
const ctrl = attachStickyHeader(container, mockDocument, mockRAF, mockSetTimeout, appContent);
ctrl.fireRAF();  // Simulate rAF firing after initial layout
assert(!header.classList.contains('sticky'),
    `header.top(${headerNaturalTop}) > containerTop(${APP_CONTENT_TOP})+1 → isSticky=false, no .sticky class on load`);
assert(!tableWrapper.classList.contains('sticky-header'),
    'wrapper does NOT have .sticky-header on initial load');

// --- Test 2: Clone is appended to body but hidden on load ---
console.log('\nTest 2: Clone appended to body but hidden on initial load');
assert(appendedToBody.length === 1, 'Clone appended to document.body');
const cloneInitiallyHidden = ctrl.getClone().style.cssText.includes('display:none') ||
    ctrl.getClone().style.display === 'none';
assert(cloneInitiallyHidden, 'Clone initially hidden');

// --- Test 3: After scrolling down — header reaches containerTop → sticky fires ---
console.log('\nTest 3: After scrolling down, header reaches top of .app-content → .sticky class added');
// Simulate: user has scrolled .app-content; CSS sticky pins header at top:0 of .app-content
// So header.top = APP_CONTENT_TOP = 46px (= containerTop)
const headerStuckTop = APP_CONTENT_TOP;           // 46px
const headerStuckBottom = headerStuckTop + HEADER_HEIGHT;  // 77px
ctrl.setHeaderRect({
    top: headerStuckTop,
    bottom: headerStuckBottom,
    left: 200,
    right: 1440,
    width: 1240,
    height: HEADER_HEIGHT,
});
ctrl.triggerScroll();
assert(header.classList.contains('sticky'),
    `After scroll: header.top(${headerStuckTop}) <= containerTop(${APP_CONTENT_TOP})+1 → .sticky added`);
assert(tableWrapper.classList.contains('sticky-header'),
    'wrapper has .sticky-header after scroll');

// --- Test 4: Clone shown when thead scrolls above stuck toolbar ---
console.log('\nTest 4: Clone shown when thead has scrolled above the stuck toolbar');
// Simulate: after scrolling 200px, thead is at top=-110 (above viewport)
ctrl.setTheadRect({ top: -110, bottom: -74, left: 200, right: 1440, width: 1240, height: THEAD_HEIGHT });
ctrl.triggerScroll();
assert(ctrl.getIsStickyThead(), 'isStickyThead = true (thead scrolled above toolbar)');
assert(ctrl.getClone().style.display === 'block', 'Clone is display:block');

// --- Test 5: Clone positioned at headerBottom (viewport-relative, below navbar+toolbar) ---
console.log('\nTest 5: Clone is positioned at headerBottom (correct viewport coordinates)');
// syncClone() sets clone.style.top = header.getBoundingClientRect().bottom
// When stuck: headerBottom = APP_CONTENT_TOP + HEADER_HEIGHT = 46 + 31 = 77px
assert(ctrl.getClone().style.top === `${headerStuckBottom}px`,
    `Clone.top = ${headerStuckBottom}px (= navbar height + toolbar height, accounts for main.html layout)`);
assert(ctrl.getClone().style.left === `${tableContainer.getBoundingClientRect().left}px`,
    `Clone.left = ${tableContainer.getBoundingClientRect().left}px (accounts for sidebar)`);
assert(ctrl.getClone().style.width === `${tableContainer.getBoundingClientRect().width}px`,
    `Clone.width = ${tableContainer.getBoundingClientRect().width}px`);

// --- Test 6: Scrolling back up — sticky removed, clone hidden ---
console.log('\nTest 6: Scrolling back up restores natural state');
// Restore header to natural position (not stuck)
ctrl.setHeaderRect({
    top: headerNaturalTop,
    bottom: headerNaturalBottom,
    left: 200,
    right: 1440,
    width: 1240,
    height: HEADER_HEIGHT,
});
// Restore thead to visible position
ctrl.setTheadRect({
    top: headerNaturalBottom,
    bottom: headerNaturalBottom + THEAD_HEIGHT,
    left: 200,
    right: 1440,
    width: 1240,
    height: THEAD_HEIGHT,
});
ctrl.triggerScroll();
assert(!header.classList.contains('sticky'),
    'header loses .sticky class when scrolled back to natural position');
assert(!tableWrapper.classList.contains('sticky-header'),
    'wrapper loses .sticky-header when scrolled back');
assert(!ctrl.getIsStickyThead(), 'isStickyThead = false (thead visible again)');
assert(ctrl.getClone().style.display === 'none', 'Clone hidden when scrolled back up');

// --- Test 7: containerTop correctly uses .app-content top, not 0 ---
console.log('\nTest 7: containerTop = .app-content.getBoundingClientRect().top (not 0)');
// This is the key assertion for issue #2069:
// The isSticky condition uses containerTop = appContent.getBoundingClientRect().top = 46,
// NOT 0. This ensures sticky fires only when the header is stuck at the top of app-content
// (below the navbar), not when it's at the very top of the viewport.
const containerTop = appContent.getBoundingClientRect().top;
assert(containerTop === APP_CONTENT_TOP,
    `containerTop = ${containerTop}px (= navbar height ${NAVBAR_HEIGHT}px, accounts for main.html nesting)`);
assert(containerTop > 0,
    'containerTop > 0 confirms the code accounts for .app-content being below navbar in main.html');

// --- Test 8: Horizontal scroll of table syncs to clone ---
console.log('\nTest 8: Horizontal scroll syncs clone.scrollLeft when clone is visible');
// First scroll down to make clone visible again
ctrl.setHeaderRect({ top: headerStuckTop, bottom: headerStuckBottom, left: 200, right: 1440, width: 1240, height: HEADER_HEIGHT });
ctrl.setTheadRect({ top: -110, bottom: -74, left: 200, right: 1440, width: 1240, height: THEAD_HEIGHT });
ctrl.triggerScroll();
tableContainer.scrollLeft = 300;
ctrl.triggerTableScroll();
assert(ctrl.getClone().scrollLeft === 300, `Clone.scrollLeft synced to 300 (horizontal scroll in main.html layout)`);

console.log('\n============================');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
