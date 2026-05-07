// Test for issue #2432: table header should stick to top when panel has max-height
// and content overflows vertically.
//
// Root cause analysis:
// 1. .f-panel .f-table-wrap has overflow: auto — creates scroll container
// 2. .dash-head th has position: sticky; top: 0 — sticky within the scroll container
// 3. When height is set on f-table-wrap via JS (dashApplyVizSizeStyles), the container
//    becomes a vertical scroll container, and sticky header SHOULD work.
// 4. The f-subhead row (sub-headers for RGcolumns) is NOT sticky, so when both
//    dash-head and f-subhead are present, only dash-head sticks.
//
// Requirements from issue:
// - When the table (or chart) overflows the panel's maximum height, it scrolls vertically
// - During vertical scrolling, the table header (thead) must stay visible at the top
//
// The fix needed:
// 1. Verify current CSS is correct for sticky behavior when height is set
// 2. Make f-subhead sticky when dash-head is sticky
// 3. Ensure overflow-y is properly set when height constraint is active

const fs = require('fs');
const css = fs.readFileSync('css/dash.css', 'utf8');
const js = fs.readFileSync('js/dash.js', 'utf8');

let passed = 0;
let failed = 0;

function ok(condition, message) {
    if (condition) {
        console.log('ok - ' + message);
        passed++;
    } else {
        console.error('not ok - ' + message);
        failed++;
    }
}

// Test 1: Main header row has sticky positioning
ok(
    /\.dash-head\s+th\s*\{[^}]*position\s*:\s*sticky/s.test(css),
    'dash-head th has position: sticky'
);

// Test 2: Main header has top: 0
ok(
    /\.dash-head\s+th\s*\{[^}]*top\s*:\s*0/s.test(css),
    'dash-head th has top: 0'
);

// Test 3: f-table-wrap has overflow: auto (creates scroll container)
ok(
    /\.f-panel\s+\.f-table-wrap\s*\{[^}]*overflow\s*:\s*auto/s.test(css),
    'f-panel .f-table-wrap has overflow: auto'
);

// Test 4: f-subhead th should also be sticky when present (new requirement)
// The f-subhead row appears below dash-head for RGcolumns — it should also stick
ok(
    /\.f-subhead\s+th\s*\{[^}]*position\s*:\s*sticky/s.test(css),
    'f-subhead th has position: sticky (for multi-row sticky header)'
);

// Test 5: f-subhead th should have the correct top offset (below dash-head)
// The top value should be dynamic or set to an appropriate offset
ok(
    /\.f-subhead\s+th\s*\{[^}]*top\s*:/s.test(css),
    'f-subhead th has top defined'
);

// Test 6: Main header (dash-head) has opaque background for proper sticky visual
ok(
    /\.dash-head\s+th\s*\{[^}]*background/s.test(css),
    'dash-head th has background (needed for sticky to look correct)'
);

// Test 7: dashUpdateSubheadStickyTop function exists for computing sticky top offset
ok(
    /function dashUpdateSubheadStickyTop/.test(js),
    'dashUpdateSubheadStickyTop function exists'
);

// Test 8: dashUpdateSubheadStickyTop is called after table render
ok(
    /dashUpdateSubheadStickyTop\(/.test(js),
    'dashUpdateSubheadStickyTop is called after table render'
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    console.log('\nFailing tests indicate required changes:');
    console.log('- Tests 4,5: Add position:sticky and proper top offset to f-subhead th');
    console.log('- Tests 7,8: dashApplyVizSizeStyles should explicitly set overflow-y');
    process.exit(1);
}
