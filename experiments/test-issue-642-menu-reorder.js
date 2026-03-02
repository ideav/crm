/**
 * Test for issue #642: Menu item visual position not updating after drag-and-drop reorder
 *
 * This test verifies the reorderMenuDataLocally() function correctly updates the menuData
 * array to match the new visual order after a successful reorder API call.
 */

// Mock menuData array (global, as in the actual app)
var menuData = [
    { menu_id: '1', menu_up: '', name: 'Главная', href: 'dashboard', icon: '<i class="pi pi-home"></i>' },
    { menu_id: '2', menu_up: '', name: 'Клиенты', href: 'clients', icon: '<i class="pi pi-users"></i>' },
    { menu_id: '3', menu_up: '', name: 'Задачи', href: 'tasks', icon: '<i class="pi pi-check-circle"></i>' },
    { menu_id: '4', menu_up: '', name: 'Настройки', href: 'settings', icon: '<i class="pi pi-cog"></i>' }
];

// Mock the reorderMenuDataLocally function (extracted from main-app.js)
function reorderMenuDataLocally(draggedId, targetId, targetParentId, insertBefore) {
    if (typeof menuData === 'undefined' || !Array.isArray(menuData)) return;

    // Find and remove the dragged item from menuData
    const draggedIndex = menuData.findIndex(item => item.menu_id === draggedId);
    if (draggedIndex === -1) return;

    const [draggedItem] = menuData.splice(draggedIndex, 1);

    // Find the target item's index in menuData
    let targetIndex = menuData.findIndex(item => item.menu_id === targetId);
    if (targetIndex === -1) {
        // Target not found, append to the end
        menuData.push(draggedItem);
        return;
    }

    // Calculate insertion point: before or after the target
    // When insertBefore is true, insert at targetIndex; otherwise insert after targetIndex
    const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
    menuData.splice(insertIndex, 0, draggedItem);
}

function getMenuOrder() {
    return menuData.map(item => item.menu_id).join(',');
}

function resetMenuData() {
    menuData = [
        { menu_id: '1', menu_up: '', name: 'Главная', href: 'dashboard', icon: '<i class="pi pi-home"></i>' },
        { menu_id: '2', menu_up: '', name: 'Клиенты', href: 'clients', icon: '<i class="pi pi-users"></i>' },
        { menu_id: '3', menu_up: '', name: 'Задачи', href: 'tasks', icon: '<i class="pi pi-check-circle"></i>' },
        { menu_id: '4', menu_up: '', name: 'Настройки', href: 'settings', icon: '<i class="pi pi-cog"></i>' }
    ];
}

// Test cases
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
    try {
        fn();
        testsPassed++;
        console.log('✓ PASS:', name);
    } catch (e) {
        testsFailed++;
        console.log('✗ FAIL:', name);
        console.log('  Error:', e.message);
    }
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected "${expected}" but got "${actual}"`);
    }
}

// Test 1: Move item 3 (Задачи) before item 1 (Главная)
test('Move item 3 before item 1', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 3, drop before item 1
    reorderMenuDataLocally('3', '1', '', true);

    // Expected order: 3,1,2,4
    assertEqual(getMenuOrder(), '3,1,2,4', 'After reorder');
});

// Test 2: Move item 1 (Главная) after item 4 (Настройки)
test('Move item 1 after item 4', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 1, drop after item 4
    reorderMenuDataLocally('1', '4', '', false);

    // Expected order: 2,3,4,1
    assertEqual(getMenuOrder(), '2,3,4,1', 'After reorder');
});

// Test 3: Move item 4 (Настройки) before item 2 (Клиенты)
test('Move item 4 before item 2', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 4, drop before item 2
    reorderMenuDataLocally('4', '2', '', true);

    // Expected order: 1,4,2,3
    assertEqual(getMenuOrder(), '1,4,2,3', 'After reorder');
});

// Test 4: Move item 2 (Клиенты) after item 3 (Задачи)
test('Move item 2 after item 3', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 2, drop after item 3
    reorderMenuDataLocally('2', '3', '', false);

    // Expected order: 1,3,2,4
    assertEqual(getMenuOrder(), '1,3,2,4', 'After reorder');
});

// Test 5: Move first item to second position
test('Move item 1 after item 2', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 1, drop after item 2
    reorderMenuDataLocally('1', '2', '', false);

    // Expected order: 2,1,3,4
    assertEqual(getMenuOrder(), '2,1,3,4', 'After reorder');
});

// Test 6: Move last item to first position
test('Move item 4 before item 1', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 4, drop before item 1
    reorderMenuDataLocally('4', '1', '', true);

    // Expected order: 4,1,2,3
    assertEqual(getMenuOrder(), '4,1,2,3', 'After reorder');
});

// Test 7: Invalid dragged id (should not crash)
test('Invalid dragged id does nothing', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag non-existent item
    reorderMenuDataLocally('999', '1', '', true);

    // Order should remain unchanged
    assertEqual(getMenuOrder(), '1,2,3,4', 'After invalid reorder');
});

// Test 8: Invalid target id (should append to end)
test('Invalid target id appends to end', () => {
    resetMenuData();
    // Initial order: 1,2,3,4
    assertEqual(getMenuOrder(), '1,2,3,4', 'Initial order');

    // Drag item 2, drop at non-existent target
    reorderMenuDataLocally('2', '999', '', true);

    // Item 2 should be at the end: 1,3,4,2
    assertEqual(getMenuOrder(), '1,3,4,2', 'After reorder to invalid target');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests completed: ${testsPassed + testsFailed}`);
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);

if (testsFailed === 0) {
    console.log('\n✓ All tests passed!');
    process.exit(0);
} else {
    console.log('\n✗ Some tests failed!');
    process.exit(1);
}
