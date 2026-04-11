/**
 * Test for issue #1516: Refresh button (Обновить) doesn't work
 *
 * Problem: After initial data load, hasMore=false and loadedRecords>0.
 * The guard in loadData() prevents refresh:
 *   if (this.isLoading || (!append && !this.hasMore && this.loadedRecords > 0)) return;
 * When user clicks refresh (loadData(false)), all three conditions are met and function exits early.
 *
 * Fix: The guard should only block appending when there's nothing more to load.
 * A non-append (refresh) call should always be allowed.
 * New condition: if (this.isLoading || (append && !this.hasMore)) return;
 */

// Simulate table state after initial data load
function createTableState() {
    return {
        isLoading: false,
        hasMore: false,       // All records fit on first page
        loadedRecords: 10,    // 10 records were loaded
        data: [],
        loadCallCount: 0
    };
}

// OLD (buggy) guard condition
function loadData_buggy(state, append = false) {
    if (state.isLoading || (!append && !state.hasMore && state.loadedRecords > 0)) {
        return false; // blocked
    }
    state.loadCallCount++;
    return true; // proceeded
}

// NEW (fixed) guard condition
function loadData_fixed(state, append = false) {
    if (state.isLoading || (append && !state.hasMore)) {
        return false; // blocked
    }
    state.loadCallCount++;
    return true; // proceeded
}

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`✗ ${name}: ${e.message}`);
        failed++;
    }
}

function assert(condition, msg) {
    if (!condition) throw new Error(msg);
}

// ===== BUGGY BEHAVIOR TESTS =====
console.log('\n--- Testing BUGGY behavior ---');

test('BUGGY: refresh (append=false) is blocked after initial load', () => {
    const state = createTableState(); // hasMore=false, loadedRecords=10
    const result = loadData_buggy(state, false);
    assert(result === false, 'Expected loadData to be blocked, but it proceeded');
});

test('BUGGY: append (append=true) is also blocked when hasMore=false', () => {
    const state = createTableState(); // hasMore=false, loadedRecords=10
    const result = loadData_buggy(state, true);
    // Actually with append=true, the !append part is false, so the whole OR is just isLoading
    // Let's re-check: (!append && !hasMore && loadedRecords>0) = (false && ...) = false
    // So append=true should NOT be blocked by this condition
    assert(result === true, 'Expected append to proceed, but it was blocked');
});

test('BUGGY: isLoading blocks all calls', () => {
    const state = createTableState();
    state.isLoading = true;
    const result = loadData_buggy(state, false);
    assert(result === false, 'Expected to be blocked when isLoading=true');
});

test('BUGGY: initial load (loadedRecords=0) is NOT blocked', () => {
    const state = createTableState();
    state.loadedRecords = 0;
    state.hasMore = true;
    const result = loadData_buggy(state, false);
    assert(result === true, 'Expected initial load to proceed');
});

// ===== FIXED BEHAVIOR TESTS =====
console.log('\n--- Testing FIXED behavior ---');

test('FIXED: refresh (append=false) proceeds after initial load', () => {
    const state = createTableState(); // hasMore=false, loadedRecords=10
    const result = loadData_fixed(state, false);
    assert(result === true, 'Expected refresh to proceed, but it was blocked');
});

test('FIXED: append (append=true) is blocked when hasMore=false', () => {
    const state = createTableState(); // hasMore=false
    const result = loadData_fixed(state, true);
    assert(result === false, 'Expected append to be blocked when hasMore=false');
});

test('FIXED: append (append=true) proceeds when hasMore=true', () => {
    const state = createTableState();
    state.hasMore = true;
    const result = loadData_fixed(state, true);
    assert(result === true, 'Expected append to proceed when hasMore=true');
});

test('FIXED: isLoading blocks all calls', () => {
    const state = createTableState();
    state.isLoading = true;
    const result = loadData_fixed(state, false);
    assert(result === false, 'Expected to be blocked when isLoading=true');
});

test('FIXED: initial load (loadedRecords=0, hasMore=true) proceeds', () => {
    const state = createTableState();
    state.loadedRecords = 0;
    state.hasMore = true;
    const result = loadData_fixed(state, false);
    assert(result === true, 'Expected initial load to proceed');
});

test('FIXED: refresh works multiple times', () => {
    const state = createTableState(); // hasMore=false, loadedRecords=10
    const r1 = loadData_fixed(state, false);
    const r2 = loadData_fixed(state, false);
    const r3 = loadData_fixed(state, false);
    assert(r1 === true && r2 === true && r3 === true,
        'Expected all refresh calls to proceed');
    assert(state.loadCallCount === 3, `Expected 3 loads, got ${state.loadCallCount}`);
});

// ===== SUMMARY =====
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
