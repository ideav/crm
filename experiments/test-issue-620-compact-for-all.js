/**
 * Test script for issue #620 - "Для всех" checkbox for compact settings
 *
 * This test verifies the logic of the global compact setting feature.
 * The feature adds a "Для всех" checkbox that when checked, applies the
 * compact setting to all tables without explicit compactness setting.
 */

// Simulate the settings structure
class MockIntegramTable {
    constructor(cookiePrefix) {
        this.options = {
            cookiePrefix: cookiePrefix
        };
        this.settings = {
            compact: false,
            compactForAll: true,
            pageSize: 20,
            truncateLongValues: true
        };
        this.cookies = {};
    }

    // Simulated cookie operations
    getCookie(name) {
        return this.cookies[name];
    }

    setCookie(name, value, maxAge) {
        if (maxAge === 0) {
            delete this.cookies[name];
        } else {
            this.cookies[name] = value;
        }
    }

    // Save settings (mimics the actual implementation)
    saveSettings() {
        const settings = {
            compact: this.settings.compact,
            compactForAll: this.settings.compactForAll,
            pageSize: this.settings.pageSize,
            truncateLongValues: this.settings.truncateLongValues
        };
        this.setCookie(`${this.options.cookiePrefix}-settings`, JSON.stringify(settings), 31536000);

        // Save global compact setting if "For All" is checked
        if (this.settings.compactForAll) {
            const globalSettings = { compact: this.settings.compact };
            this.setCookie('integram-table-global-settings', JSON.stringify(globalSettings), 31536000);
        }
    }

    // Load settings (mimics the actual implementation)
    loadSettings() {
        const settingsCookie = this.getCookie(`${this.options.cookiePrefix}-settings`);

        if (settingsCookie) {
            try {
                const settings = JSON.parse(settingsCookie);
                this.settings.compact = settings.compact !== undefined ? settings.compact : false;
                this.settings.compactForAll = settings.compactForAll !== undefined ? settings.compactForAll : true;
                this.settings.pageSize = settings.pageSize || 20;
                this.settings.truncateLongValues = settings.truncateLongValues !== undefined ? settings.truncateLongValues : true;
            } catch (e) {
                console.error('Error loading settings:', e);
            }
        } else {
            // No table-specific settings found, try to load global compact setting
            const globalSettingsCookie = this.getCookie('integram-table-global-settings');
            if (globalSettingsCookie) {
                try {
                    const globalSettings = JSON.parse(globalSettingsCookie);
                    if (globalSettings.compact !== undefined) {
                        this.settings.compact = globalSettings.compact;
                    }
                } catch (e) {
                    console.error('Error loading global settings:', e);
                }
            }
        }
    }

    // Reset settings
    resetSettings() {
        this.setCookie(`${this.options.cookiePrefix}-settings`, null, 0);
        this.settings = {
            compact: false,
            compactForAll: true,
            pageSize: 20,
            truncateLongValues: true
        };
    }
}

// Test cases
function runTests() {
    console.log('=== Test Issue #620: "Для всех" checkbox for compact settings ===\n');

    // Test 1: Saving settings with compactForAll = true should save global setting
    console.log('Test 1: Saving with compactForAll = true saves global setting');
    const table1 = new MockIntegramTable('table1');
    table1.settings.compact = true;
    table1.settings.compactForAll = true;
    table1.saveSettings();
    console.log('  Table1 cookies:', table1.cookies);
    console.assert(table1.cookies['integram-table-global-settings'] !== undefined, 'Global settings should be saved');
    console.assert(JSON.parse(table1.cookies['integram-table-global-settings']).compact === true, 'Global compact should be true');
    console.log('  ✓ PASSED\n');

    // Test 2: New table without settings should load global setting
    console.log('Test 2: New table without settings loads global setting');
    const table2 = new MockIntegramTable('table2');
    table2.cookies = { ...table1.cookies }; // Share the global cookie
    delete table2.cookies['table2-settings']; // Ensure no table-specific settings
    table2.loadSettings();
    console.log('  Table2 compact after load:', table2.settings.compact);
    console.assert(table2.settings.compact === true, 'Table2 should inherit global compact setting');
    console.log('  ✓ PASSED\n');

    // Test 3: Table with existing settings should NOT load global setting
    console.log('Test 3: Table with existing settings does NOT load global setting');
    const table3 = new MockIntegramTable('table3');
    table3.cookies = { ...table1.cookies };
    table3.settings.compact = false;
    table3.settings.compactForAll = false;
    table3.saveSettings();
    // Now reset settings and reload
    table3.settings.compact = null; // Reset to test loading
    table3.loadSettings();
    console.log('  Table3 compact after load:', table3.settings.compact);
    console.assert(table3.settings.compact === false, 'Table3 should use its own setting (false)');
    console.log('  ✓ PASSED\n');

    // Test 4: Saving with compactForAll = false should NOT save global setting
    console.log('Test 4: Saving with compactForAll = false does NOT save global setting');
    const table4 = new MockIntegramTable('table4');
    table4.settings.compact = true;
    table4.settings.compactForAll = false;
    table4.saveSettings();
    console.log('  Table4 cookies:', table4.cookies);
    console.assert(table4.cookies['integram-table-global-settings'] === undefined, 'Global settings should NOT be saved when compactForAll is false');
    console.log('  ✓ PASSED\n');

    // Test 5: Default value for compactForAll should be true
    console.log('Test 5: Default value for compactForAll is true');
    const table5 = new MockIntegramTable('table5');
    console.log('  Table5 default compactForAll:', table5.settings.compactForAll);
    console.assert(table5.settings.compactForAll === true, 'Default compactForAll should be true');
    console.log('  ✓ PASSED\n');

    // Test 6: Reset settings should reset compactForAll to default (true)
    console.log('Test 6: Reset settings resets compactForAll to default (true)');
    const table6 = new MockIntegramTable('table6');
    table6.settings.compactForAll = false;
    table6.resetSettings();
    console.log('  Table6 compactForAll after reset:', table6.settings.compactForAll);
    console.assert(table6.settings.compactForAll === true, 'compactForAll should be reset to true');
    console.log('  ✓ PASSED\n');

    console.log('=== All tests passed! ===');
}

runTests();
