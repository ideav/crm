/**
 * Experiment: Test for issue #634 - Method name collision bug
 *
 * This test demonstrates the bug where having two methods with the same name
 * (createMenuItem) caused the wrong method to be called during menu building.
 *
 * Bug description:
 * - MainAppController had two methods named `createMenuItem`:
 *   1. createMenuItem(item, level, hasChildren) - Synchronous, creates DOM element
 *   2. async createMenuItem(name, href, icon, parentId) - Async, calls API to create menu item
 *
 * - JavaScript doesn't support method overloading, so the second definition
 *   overwrote the first one
 *
 * - When buildMenu() called createMenuItem(item, level, hasChildren) for each
 *   menu item, it actually called the async API method, which:
 *   1. Interpreted the `item` object as `name` (became "[object Object]")
 *   2. Made a POST request to /_m_new/151?JSON creating unwanted menu items
 *   3. Returned a Promise instead of a DOM element
 *   4. Caused "Failed to execute 'appendChild' on 'Node'" error
 *
 * Fix:
 * - Renamed the API method to `createMenuItemAPI` to avoid collision
 */

// Simulate the bug
class BuggyMainAppController {
    // First method definition (line ~216 in original)
    createMenuItem(item, level, hasChildren) {
        console.log('[DOM] createMenuItem called with:', { item, level, hasChildren });
        // Would create a DOM element
        return document.createElement('div');
    }

    // Second method definition OVERWRITES the first (line ~710 in original)
    async createMenuItem(name, href, icon, parentId) {
        console.log('[API] createMenuItem called with:', { name, href, icon, parentId });
        // Would make an API POST request here
        // This returns a Promise, not a DOM element!
        return Promise.resolve({ obj: 12345 });
    }
}

// Simulate the fix
class FixedMainAppController {
    // First method definition - creates DOM element
    createMenuItem(item, level, hasChildren) {
        console.log('[DOM] createMenuItem called with:', { item, level, hasChildren });
        return document.createElement('div');
    }

    // Renamed to avoid collision
    async createMenuItemAPI(name, href, icon, parentId) {
        console.log('[API] createMenuItemAPI called with:', { name, href, icon, parentId });
        return Promise.resolve({ obj: 12345 });
    }
}

// Test the buggy version
console.log('=== Testing Buggy Version ===');
const buggy = new BuggyMainAppController();

// Simulate buildMenu() calling createMenuItem for a menu item
const menuItem = { menu_id: '100', name: 'Test Item', href: 'test' };
const result = buggy.createMenuItem(menuItem, 0, false);

console.log('Result type:', typeof result);
console.log('Is Promise?:', result instanceof Promise);
console.log('Is Node?:', typeof document !== 'undefined' && result instanceof Node);

if (result instanceof Promise) {
    console.log('BUG REPRODUCED: createMenuItem returned a Promise instead of a DOM element');
    console.log('This would cause: "Failed to execute appendChild on Node: parameter 1 is not of type Node"');
} else {
    console.log('No bug - returned a DOM element');
}

console.log('\n=== Testing Fixed Version ===');
const fixed = new FixedMainAppController();

// Simulate buildMenu() calling createMenuItem for a menu item
const fixedResult = fixed.createMenuItem(menuItem, 0, false);

console.log('Result type:', typeof fixedResult);
console.log('Is Promise?:', fixedResult instanceof Promise);
console.log('Is Node?:', typeof document !== 'undefined' && fixedResult instanceof Node);

if (fixedResult instanceof Promise) {
    console.log('STILL BUGGY: createMenuItem returned a Promise');
} else {
    console.log('FIX VERIFIED: createMenuItem returns a DOM element');
}

// Verify the API method is still accessible
console.log('\n=== Verify API method works ===');
fixed.createMenuItemAPI('New Item', 'new/item', 'pi-star', '100').then(res => {
    console.log('API method result:', res);
});
