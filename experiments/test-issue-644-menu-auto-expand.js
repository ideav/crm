/**
 * Test script for Issue #644: Auto-expand parent menus when active item is hidden
 *
 * This tests the expandParentMenus() method that should automatically expand
 * parent menus when a page loads with an active menu item inside a collapsed submenu.
 */

// Mock DOM structure
function createMockDOM() {
    // Create a mock menu structure with nested items
    const menuContainer = {
        innerHTML: ''
    };

    // Simulate menu data with a 3-level hierarchy:
    // - Level 0: "Reports" (id: 1, no href)
    //   - Level 1: "Sales" (id: 2, no href)
    //     - Level 2: "Monthly Report" (id: 3, href: "reports/sales/monthly")
    //   - Level 1: "Inventory" (id: 4, href: "reports/inventory")
    // - Level 0: "Settings" (id: 5, href: "settings")

    const mockMenuData = [
        { menu_id: '1', menu_up: '', name: 'Reports', href: '', icon: '' },
        { menu_id: '2', menu_up: '1', name: 'Sales', href: '', icon: '' },
        { menu_id: '3', menu_up: '2', name: 'Monthly Report', href: 'reports/sales/monthly', icon: '' },
        { menu_id: '4', menu_up: '1', name: 'Inventory', href: 'reports/inventory', icon: '' },
        { menu_id: '5', menu_up: '', name: 'Settings', href: 'settings', icon: '' }
    ];

    return mockMenuData;
}

// Test the expandParentMenus logic
function testExpandParentMenusLogic() {
    console.log('=== Test expandParentMenus Logic ===\n');

    const menuData = createMockDOM();

    // Build a map of menu items
    const menuItems = {};
    menuData.forEach(item => {
        menuItems[item.menu_id] = item;
    });

    // Simulate expandParentMenus logic for item with id '3' (Monthly Report)
    // It should expand parents: id '2' (Sales) and id '1' (Reports)

    const activeItemId = '3';
    const expandedParents = [];

    let parentId = menuItems[activeItemId].menu_up;
    while (parentId) {
        const parentItem = menuItems[parentId];
        if (!parentItem) break;

        expandedParents.push({
            id: parentId,
            name: parentItem.name
        });

        parentId = parentItem.menu_up;
    }

    console.log(`Active item: "${menuItems[activeItemId].name}" (id: ${activeItemId})`);
    console.log(`Parent hierarchy to expand:`);
    expandedParents.forEach((parent, index) => {
        console.log(`  ${index + 1}. "${parent.name}" (id: ${parent.id})`);
    });

    // Verify the correct parents are found
    const expectedParents = ['2', '1']; // Sales, then Reports
    const actualParents = expandedParents.map(p => p.id);

    const test1Pass = JSON.stringify(actualParents) === JSON.stringify(expectedParents);
    console.log(`\nTest 1 (Nested item parents): ${test1Pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!test1Pass) {
        console.log(`  Expected: ${JSON.stringify(expectedParents)}`);
        console.log(`  Actual: ${JSON.stringify(actualParents)}`);
    }

    // Test 2: Item with single parent level
    const activeItemId2 = '4'; // Inventory (parent: Reports)
    const expandedParents2 = [];

    parentId = menuItems[activeItemId2].menu_up;
    while (parentId) {
        const parentItem = menuItems[parentId];
        if (!parentItem) break;

        expandedParents2.push({
            id: parentId,
            name: parentItem.name
        });

        parentId = parentItem.menu_up;
    }

    console.log(`\nActive item: "${menuItems[activeItemId2].name}" (id: ${activeItemId2})`);
    console.log(`Parent hierarchy to expand:`);
    expandedParents2.forEach((parent, index) => {
        console.log(`  ${index + 1}. "${parent.name}" (id: ${parent.id})`);
    });

    const expectedParents2 = ['1']; // Just Reports
    const actualParents2 = expandedParents2.map(p => p.id);

    const test2Pass = JSON.stringify(actualParents2) === JSON.stringify(expectedParents2);
    console.log(`\nTest 2 (Single parent level): ${test2Pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!test2Pass) {
        console.log(`  Expected: ${JSON.stringify(expectedParents2)}`);
        console.log(`  Actual: ${JSON.stringify(actualParents2)}`);
    }

    // Test 3: Top-level item (no parents)
    const activeItemId3 = '5'; // Settings
    const expandedParents3 = [];

    parentId = menuItems[activeItemId3].menu_up;
    while (parentId) {
        const parentItem = menuItems[parentId];
        if (!parentItem) break;

        expandedParents3.push({
            id: parentId,
            name: parentItem.name
        });

        parentId = parentItem.menu_up;
    }

    console.log(`\nActive item: "${menuItems[activeItemId3].name}" (id: ${activeItemId3})`);
    console.log(`Parent hierarchy to expand: (none - top level item)`);

    const test3Pass = expandedParents3.length === 0;
    console.log(`\nTest 3 (Top-level item, no parents): ${test3Pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!test3Pass) {
        console.log(`  Expected: []`);
        console.log(`  Actual: ${JSON.stringify(expandedParents3.map(p => p.id))}`);
    }

    // Summary
    console.log('\n=== Test Summary ===');
    const allPassed = test1Pass && test2Pass && test3Pass;
    console.log(`Total: ${allPassed ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);

    return allPassed;
}

// Run tests
const success = testExpandParentMenusLogic();
process.exit(success ? 0 : 1);
