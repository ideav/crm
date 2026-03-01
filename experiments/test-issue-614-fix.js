/**
 * Test for issue #614 fix: New columns should appear visible by default
 *
 * Scenario:
 * 1. User has a table with columns [151, 153, 158] saved in cookies
 * 2. A new column [326] is added via "Add column" button
 * 3. On page reload, the new column should appear visible
 */

// Simulated state after loading from cookies (saved state before new column was added)
const savedColumnOrder = ["151", "153", "158"];
const savedVisibleColumns = ["153", "158"]; // Note: 151 is the main column (type column)

// Simulated current columns from metadata (after new column was added)
const currentColumns = [
    { id: "151", name: "Меню" },      // main column
    { id: "153", name: "Адрес" },
    { id: "158", name: "Параметры" },
    { id: "326", name: "Меню" }       // NEW column added via "Добавить колонку"
];

// Simulated ID columns (columns to hide)
const idColumns = new Set(); // Empty for this test

// Simulating the ORIGINAL code behavior
function originalBehavior() {
    let columnOrder = [...savedColumnOrder];
    let visibleColumns = [...savedVisibleColumns];

    const currentColumnIds = new Set(currentColumns.map(c => c.id));

    // Original validation
    if (columnOrder.length === 0 || !columnOrder.some(id => currentColumnIds.has(id))) {
        columnOrder = currentColumns.map(c => c.id);
    }

    const validVisible = visibleColumns.filter(id => currentColumnIds.has(id) && !idColumns.has(id));
    if (visibleColumns.length === 0 || validVisible.length === 0) {
        visibleColumns = currentColumns.filter(c => !idColumns.has(c.id)).map(c => c.id);
    } else {
        visibleColumns = validVisible;
    }

    return { columnOrder, visibleColumns };
}

// Simulating the FIXED code behavior
function fixedBehavior() {
    let columnOrder = [...savedColumnOrder];
    let visibleColumns = [...savedVisibleColumns];

    const currentColumnIds = new Set(currentColumns.map(c => c.id));

    // Original validation
    if (columnOrder.length === 0 || !columnOrder.some(id => currentColumnIds.has(id))) {
        columnOrder = currentColumns.map(c => c.id);
    }

    const validVisible = visibleColumns.filter(id => currentColumnIds.has(id) && !idColumns.has(id));
    if (visibleColumns.length === 0 || validVisible.length === 0) {
        visibleColumns = currentColumns.filter(c => !idColumns.has(c.id)).map(c => c.id);
    } else {
        visibleColumns = validVisible;
    }

    // Issue #614 FIX: Add newly created columns to visibleColumns and columnOrder
    const savedColumnIdsSet = new Set(columnOrder);
    const newColumnIds = currentColumns
        .filter(c => !savedColumnIdsSet.has(c.id) && !idColumns.has(c.id))
        .map(c => c.id);
    if (newColumnIds.length > 0) {
        // Add new columns to the end of columnOrder
        columnOrder = [...columnOrder.filter(id => currentColumnIds.has(id)), ...newColumnIds];
        // Make new columns visible
        visibleColumns = [...visibleColumns, ...newColumnIds.filter(id => !visibleColumns.includes(id))];
    }

    return { columnOrder, visibleColumns };
}

// Run tests
console.log("=== Test for Issue #614 Fix ===\n");

const original = originalBehavior();
console.log("ORIGINAL behavior (before fix):");
console.log("  columnOrder:", original.columnOrder);
console.log("  visibleColumns:", original.visibleColumns);
console.log("  New column '326' is visible?", original.visibleColumns.includes("326"));

console.log("");

const fixed = fixedBehavior();
console.log("FIXED behavior (after fix):");
console.log("  columnOrder:", fixed.columnOrder);
console.log("  visibleColumns:", fixed.visibleColumns);
console.log("  New column '326' is visible?", fixed.visibleColumns.includes("326"));

console.log("");

// Verify fix
if (!original.visibleColumns.includes("326") && fixed.visibleColumns.includes("326")) {
    console.log("SUCCESS: Fix correctly makes new column '326' visible!");
} else if (original.visibleColumns.includes("326")) {
    console.log("NOTE: Column was already visible in original (unexpected)");
} else {
    console.log("FAILURE: Fix did not make new column '326' visible");
}

// Additional test: verify column is added to columnOrder
if (!original.columnOrder.includes("326") && fixed.columnOrder.includes("326")) {
    console.log("SUCCESS: Fix correctly adds new column '326' to columnOrder!");
}
