/**
 * Test for issue #2085: double scrollbar on right side of table
 *
 * Verifies that when updateContainerHeight() constrains the table container,
 * the outer .app-content scrollbar is suppressed (overflowY = 'hidden'),
 * and restored when the constraint is removed.
 *
 * Run with: node experiments/test-issue-2085-double-scrollbar.js
 */

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

// ─── Minimal DOM stubs ────────────────────────────────────────────────────────

function makeRect(top, bottom, left = 0, right = 800) {
    return { top, bottom, left, right, width: right - left, height: bottom - top };
}

const appContent = {
    style: { overflowY: '' },
    getBoundingClientRect: () => makeRect(0, 800)
};

const tableContainer = {
    style: { maxHeight: '', overflowY: '' },
    getBoundingClientRect: () => makeRect(100, 1200) // Taller than appContent.bottom
};

const containerEl = {
    querySelector: (sel) => {
        if (sel === '.integram-table-container') return tableContainer;
        return null;
    }
};

// Simulate document.querySelector
global.document = {
    querySelector: (sel) => {
        if (sel === '.app-content') return appContent;
        return null;
    }
};

// ─── Paste updateContainerHeight logic under test ─────────────────────────────

function updateContainerHeight(container) {
    const tc = container && container.querySelector('.integram-table-container');
    if (!tc) return;

    const ac = document.querySelector('.app-content');
    const scrollRoot = ac || { getBoundingClientRect: () => makeRect(0, document.documentElement.scrollHeight) };

    const containerRect = tc.getBoundingClientRect();
    const rootRect = scrollRoot.getBoundingClientRect();

    const available = rootRect.bottom - containerRect.top - 4;

    if (available > 100) {
        tc.style.maxHeight = available + 'px';
        if (ac) ac.style.overflowY = 'hidden';
    } else {
        tc.style.maxHeight = '';
        if (ac) ac.style.overflowY = '';
    }
}

// ─── Test 1: container taller than app-content → should constrain and suppress ─

console.log('\nTest 1: table container taller than app-content');
appContent.getBoundingClientRect = () => makeRect(0, 800);
tableContainer.getBoundingClientRect = () => makeRect(100, 1200);
appContent.style.overflowY = '';
tableContainer.style.maxHeight = '';

updateContainerHeight(containerEl);

const available1 = 800 - 100 - 4; // = 696
assert(tableContainer.style.maxHeight === available1 + 'px',
    `tableContainer.maxHeight = ${available1}px (was ${tableContainer.style.maxHeight})`);
assert(appContent.style.overflowY === 'hidden',
    `appContent.overflowY = 'hidden' (was '${appContent.style.overflowY}')`);

// ─── Test 2: very small available height → should not constrain, restore overflow ─

console.log('\nTest 2: available height <= 100px (no constraint)');
appContent.getBoundingClientRect = () => makeRect(0, 150);
tableContainer.getBoundingClientRect = () => makeRect(100, 200);
appContent.style.overflowY = 'hidden'; // Simulate already set
tableContainer.style.maxHeight = '46px';

updateContainerHeight(containerEl);

const available2 = 150 - 100 - 4; // = 46 → not > 100
assert(tableContainer.style.maxHeight === '',
    `tableContainer.maxHeight cleared (was '${tableContainer.style.maxHeight}')`);
assert(appContent.style.overflowY === '',
    `appContent.overflowY restored to '' (was '${appContent.style.overflowY}')`);

// ─── Test 3: no appContent in DOM → should not throw ──────────────────────────

console.log('\nTest 3: no .app-content element in DOM');
const origQS = global.document.querySelector;
global.document.querySelector = () => null;
// Provide a documentElement fallback used when appContent is null
global.document.documentElement = { scrollHeight: 800 };
tableContainer.getBoundingClientRect = () => makeRect(0, 200);
appContent.style.overflowY = '';

let threw = false;
try {
    updateContainerHeight(containerEl);
} catch (e) {
    threw = true;
    console.error('  Exception:', e.message);
}
assert(!threw, 'no exception when .app-content is missing');
global.document.querySelector = origQS;

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
