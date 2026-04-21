/**
 * Test for issue #2063: Table header initially placed incorrectly, then doesn't stick.
 *
 * Root cause:
 * 1. attachStickyHeader() called synchronously after innerHTML assignment —
 *    header.offsetHeight may return 0 before browser layout, setting th.style.top
 *    to '0px' (wrong). Fix: defer with requestAnimationFrame so layout is done first.
 * 2. When sticky state toggles, header height changes via 150ms CSS transition and
 *    th.style.top becomes stale. Fix: re-call applyOffsets via setTimeout after 160ms.
 */

'use strict';

// ---- Minimal DOM mocks (no jsdom needed) ----

function makeEl(tag) {
    const style = {};
    const classList = new Set();
    return {
        tagName: tag,
        style,
        classList: {
            contains: (c) => classList.has(c),
            toggle: (c, force) => {
                if (force === undefined) { classList.has(c) ? classList.delete(c) : classList.add(c); }
                else { force ? classList.add(c) : classList.delete(c); }
            },
            add: (c) => classList.add(c),
            remove: (c) => classList.delete(c),
        },
        children: [],
        _offsetHeight: 0,
        get offsetHeight() { return this._offsetHeight; },
        getBoundingClientRect: () => ({ top: 0 }),
    };
}

// Build mock DOM tree
const header = makeEl('div');
header.className = 'integram-table-header';
header._offsetHeight = 50;
header.getBoundingClientRect = () => ({ top: 100 }); // not sticky initially

const th1 = makeEl('th'); th1._offsetHeight = 36;
const th2 = makeEl('th'); th2._offsetHeight = 36;
const filterTd1 = makeEl('td');
const filterTd2 = makeEl('td');

const tableWrapper = makeEl('div');
tableWrapper.className = 'integram-table-wrapper';

// Mock querySelectorAll on tableWrapper
tableWrapper.querySelectorAll = (sel) => {
    if (sel === '.integram-table thead th') return [th1, th2];
    if (sel === '.filter-row td') return [filterTd1, filterTd2];
    return [];
};
tableWrapper.querySelector = (sel) => {
    if (sel === '.integram-table thead th') return th1;
    return null;
};

// Mock window (scroll container)
const mockWindow = { addEventListener: () => {} };

// Track rAF and setTimeout callbacks
let rafCallbacks = [];
let timeoutCallbacks = [];

const mockRequestAnimationFrame = (cb) => { rafCallbacks.push(cb); };
const mockSetTimeout = (cb, delay) => { timeoutCallbacks.push({ cb, delay }); };

// ---- Re-implementation of the FIXED attachStickyHeader logic ----
function attachStickyHeaderFixed(tableWrapper, header, scrollContainer, requestAnimationFrame, setTimeout) {
    const applyOffsets = () => {
        const headerHeight = header.offsetHeight;
        const ths = tableWrapper.querySelectorAll('.integram-table thead th');
        ths.forEach(th => { th.style.top = headerHeight + 'px'; });

        const firstTh = tableWrapper.querySelector('.integram-table thead th');
        const thHeight = firstTh ? firstTh.offsetHeight : 0;
        const filterCells = tableWrapper.querySelectorAll('.filter-row td');
        filterCells.forEach(td => { td.style.top = (headerHeight + thHeight) + 'px'; });
    };

    const updateStickyState = () => {
        const headerRect = header.getBoundingClientRect();
        const containerTop = scrollContainer === mockWindow ? 0 : scrollContainer.getBoundingClientRect().top;
        const isSticky = headerRect.top <= containerTop + 1;

        const wasSticky = header.classList.contains('sticky');
        if (isSticky !== wasSticky) {
            header.classList.toggle('sticky', isSticky);
            tableWrapper.classList.toggle('sticky-header', isSticky);
            setTimeout(applyOffsets, 160);
        }
        applyOffsets();
    };

    scrollContainer.addEventListener('scroll', updateStickyState);
    requestAnimationFrame(updateStickyState);
    return updateStickyState; // expose for testing scroll simulation
}

// ---- Re-implementation of the OLD (buggy) attachStickyHeader logic ----
function attachStickyHeaderOld(tableWrapper, header, scrollContainer) {
    const updateStickyState = () => {
        const headerRect = header.getBoundingClientRect();
        const containerTop = 0;
        const isSticky = headerRect.top <= containerTop + 1;
        const wasSticky = header.classList.contains('sticky');
        if (isSticky !== wasSticky) {
            header.classList.toggle('sticky', isSticky);
            tableWrapper.classList.toggle('sticky-header', isSticky);
        }
        const headerHeight = header.offsetHeight;
        tableWrapper.querySelectorAll('.integram-table thead th').forEach(th => {
            th.style.top = headerHeight + 'px';
        });
        const firstTh = tableWrapper.querySelector('.integram-table thead th');
        const thHeight = firstTh ? firstTh.offsetHeight : 0;
        tableWrapper.querySelectorAll('.filter-row td').forEach(td => {
            td.style.top = (headerHeight + thHeight) + 'px';
        });
    };
    scrollContainer.addEventListener('scroll', updateStickyState);
    updateStickyState(); // BUG: synchronous, layout may not be ready
    return updateStickyState;
}

// ---- Tests ----
let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  PASS: ${message}`);
        passed++;
    } else {
        console.error(`  FAIL: ${message}`);
        failed++;
    }
}

// Reset helpers
function reset() {
    th1.style = {}; th2.style = {}; filterTd1.style = {}; filterTd2.style = {};
    header.classList.remove('sticky'); tableWrapper.classList.remove('sticky-header');
    header.getBoundingClientRect = () => ({ top: 100 });
    rafCallbacks = []; timeoutCallbacks = [];
}

console.log('=== Test suite for issue #2063 sticky header fix ===\n');

// ---- Test 1: Initial call is deferred (fixed behavior) ----
console.log('Test 1: Fixed - initial updateStickyState is deferred via requestAnimationFrame');
reset();
attachStickyHeaderFixed(tableWrapper, header, mockWindow, mockRequestAnimationFrame, mockSetTimeout);

assert(th1.style.top === undefined || th1.style.top === '',
    `th1.style.top before rAF fires = "${th1.style.top || ''}" (should be empty - not yet set)`);
assert(rafCallbacks.length === 1, `1 rAF callback queued (got ${rafCallbacks.length})`);

// Now fire rAF
rafCallbacks.forEach(cb => cb());
rafCallbacks = [];

assert(th1.style.top === '50px',
    `th1.style.top after rAF fires = "${th1.style.top}" (should be "50px" = headerHeight)`);
assert(filterTd1.style.top === '86px',
    `filterTd1.style.top after rAF fires = "${filterTd1.style.top}" (should be "86px" = 50+36)`);

// ---- Test 2: Old behavior (synchronous) - demonstrates the bug ----
console.log('\nTest 2: Old (buggy) - initial updateStickyState called synchronously');
console.log('  (This test demonstrates the bug; passing here just confirms the old code path)');
reset();
// Simulate layout not ready: offsetHeight returns 0
const realHeight = header._offsetHeight;
header._offsetHeight = 0;
attachStickyHeaderOld(tableWrapper, header, mockWindow);

// With the bug, if offsetHeight=0 at call time, top is set to '0px'
assert(th1.style.top === '0px',
    `th1.style.top with old code when offsetHeight=0 = "${th1.style.top}" (bug: "0px" not "50px")`);
header._offsetHeight = realHeight;

// ---- Test 3: Sticky state toggle calls applyOffsets again after transition ----
console.log('\nTest 3: Fixed - sticky toggle queues applyOffsets via setTimeout (for CSS transition)');
reset();
const updateFn = attachStickyHeaderFixed(tableWrapper, header, mockWindow, mockRequestAnimationFrame, mockSetTimeout);
rafCallbacks.forEach(cb => cb()); rafCallbacks = [];

// Simulate scroll makes header sticky
header.getBoundingClientRect = () => ({ top: 0 });
updateFn();

assert(header.classList.contains('sticky'), 'header has .sticky class after scroll');
assert(timeoutCallbacks.length === 1, `1 setTimeout(applyOffsets, 160) queued (got ${timeoutCallbacks.length})`);
assert(timeoutCallbacks[0].delay === 160, `setTimeout delay = ${timeoutCallbacks[0].delay}ms (should be 160ms)`);

// ---- Test 4: Correct offsets maintained after un-sticky ----
console.log('\nTest 4: Fixed - offsets correct when header un-sticks');
reset();
const updateFn2 = attachStickyHeaderFixed(tableWrapper, header, mockWindow, mockRequestAnimationFrame, mockSetTimeout);
rafCallbacks.forEach(cb => cb()); rafCallbacks = [];

// Make sticky
header.getBoundingClientRect = () => ({ top: 0 });
updateFn2();
// Unstick
header.getBoundingClientRect = () => ({ top: 100 });
updateFn2();

assert(!header.classList.contains('sticky'), 'header loses .sticky class when scrolled back');
assert(th1.style.top === '50px', `th1.style.top after unstick = "${th1.style.top}" (should be "50px")`);

// ---- Summary ----
console.log(`\n============================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
