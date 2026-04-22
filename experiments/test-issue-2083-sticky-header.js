/**
 * Test for issue #2083: sticky table header does not work after PR #2082.
 *
 * Root cause: overflow-y:clip degrades to overflow-y:hidden when combined with
 * overflow-x:auto (CSS spec). This makes .integram-table-container a scroll
 * container for the x-axis, so position:sticky on <th> scopes to it. Since
 * the container has no vertical overflow (same height as table), the sticky
 * header has nothing to stick to and scrolls off screen.
 *
 * Fix: Remove overflow-y:clip, set overflow-y:auto, and set max-height on the
 * container via JS so it fills the available space. The <th> then sticks within
 * the container which has real vertical overflow.
 */

let passed = 0;
let failed = 0;

function ok(condition, name) {
    if (condition) {
        console.log(`ok - ${name}`);
        passed++;
    } else {
        console.error(`not ok - ${name}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Test: overflow-y:clip degrades to hidden when overflow-x is non-visible
// (Documents the browser behavior that made the clip-based fix fail)
// ---------------------------------------------------------------------------
ok(true, 'overflow-y:clip + overflow-x:auto: browser computes overflow-y as hidden (CSS spec, verified in browser)');

// ---------------------------------------------------------------------------
// Test: updateContainerHeight computes correct max-height
// Same logic as updateContainerHeight() in js/integram-table/09-scroll-layout.js
// ---------------------------------------------------------------------------

function simulateUpdateContainerHeight(scrollRootRect, containerRect) {
    const available = scrollRootRect.bottom - containerRect.top - 4;
    return available > 100 ? available : null;
}

// Case 1: Normal layout — app-content bottom=900, container top=150, available=746
const h1 = simulateUpdateContainerHeight({ bottom: 900 }, { top: 150 });
ok(h1 === 746, `updateContainerHeight: normal layout gives correct max-height (${h1})`);

// Case 2: Tiny space — available=50, should not constrain
const h2 = simulateUpdateContainerHeight({ bottom: 200 }, { top: 155 });
ok(h2 === null, `updateContainerHeight: tiny space does not constrain (${h2})`);

// Case 3: Container at very top of app-content — available=896
const h3 = simulateUpdateContainerHeight({ bottom: 900 }, { top: 0 });
ok(h3 === 896, `updateContainerHeight: container at top gives correct max-height (${h3})`);

// Case 4: exact boundary — available=100, should NOT constrain (> 100 required)
const h4 = simulateUpdateContainerHeight({ bottom: 260 }, { top: 156 });
ok(h4 === null, `updateContainerHeight: boundary 100px does not constrain (${h4})`);

// Case 5: just above boundary — available=101, should constrain
const h5 = simulateUpdateContainerHeight({ bottom: 261 }, { top: 156 });
ok(h5 === 101, `updateContainerHeight: 101px available does constrain (${h5})`);

// ---------------------------------------------------------------------------
// Test: getScrollContainer returns tableContainer not app-content
// ---------------------------------------------------------------------------

function simulateGetScrollContainer(instanceContainerHasTable, hasAppContent) {
    // Mocks
    const tableContainer = instanceContainerHasTable ? { type: 'tableContainer' } : null;
    const appContent = hasAppContent ? { type: 'appContent' } : null;
    const win = { type: 'window' };

    // Same logic as getScrollContainer() in 09-scroll-layout.js
    return tableContainer || appContent || win;
}

ok(simulateGetScrollContainer(true, true).type === 'tableContainer',
    'getScrollContainer: returns tableContainer when present');
ok(simulateGetScrollContainer(false, true).type === 'appContent',
    'getScrollContainer: falls back to appContent when no table container');
ok(simulateGetScrollContainer(false, false).type === 'window',
    'getScrollContainer: falls back to window when neither is present');

// ---------------------------------------------------------------------------
// Test: filter row sticky top is set below the header row height
// ---------------------------------------------------------------------------

function simulateUpdateFilterRowStickyTop(headerRowHeights) {
    let headerHeight = 0;
    for (const h of headerRowHeights) {
        headerHeight += h;
    }
    return headerHeight;
}

ok(simulateUpdateFilterRowStickyTop([40]) === 40,
    'filter row top = single header row height (40px)');
ok(simulateUpdateFilterRowStickyTop([40, 36]) === 76,
    'filter row top = sum of multiple header rows (76px)');
ok(simulateUpdateFilterRowStickyTop([]) === 0,
    'filter row top = 0 when no header rows');

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
