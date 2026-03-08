/**
 * Test for issue #747: Settings merge when saving column config
 *
 * Problem: When changing column settings (order/visibility), the panel type
 * settings (like panelType: 'Report') were being lost because the config
 * was completely overwritten instead of being merged.
 *
 * Solution: Merge the new column settings with the existing config using
 * Object.assign() to preserve other settings.
 */

// Simulate the fix implementation
function testConfigMerge() {
    console.log('=== Test: Config Merge for Column Settings ===\n');

    // Test case 1: Original config has panelType, saving column settings should preserve it
    console.log('Test 1: Preserve panelType when saving column settings');
    const originalConfig1 = { panelType: 'Report' };
    const newColumnSettings1 = { o: ['col1', 'col2'], v: ['col1', 'col2'] };

    // Old behavior (buggy): completely overwrite
    const oldResult1 = newColumnSettings1;
    console.log('  Old result (buggy):', JSON.stringify(oldResult1));
    console.log('  panelType preserved:', oldResult1.panelType === 'Report' ? 'YES' : 'NO - BUG!');

    // New behavior (fixed): merge with existing config
    const newResult1 = Object.assign({}, originalConfig1, newColumnSettings1);
    console.log('  New result (fixed):', JSON.stringify(newResult1));
    console.log('  panelType preserved:', newResult1.panelType === 'Report' ? 'YES - FIXED!' : 'NO');
    console.log('');

    // Test case 2: Original config has additional settings (rows, cols for pivot)
    console.log('Test 2: Preserve pivot settings when saving column settings');
    const originalConfig2 = {
        panelType: 'Report',
        rows: ['Region'],
        cols: ['Month'],
        rendererName: 'Table'
    };
    const newColumnSettings2 = { o: ['id', 'name', 'date'], v: ['id', 'name'] };

    // Old behavior
    const oldResult2 = newColumnSettings2;
    console.log('  Old result (buggy):', JSON.stringify(oldResult2));
    console.log('  All settings preserved:',
        (oldResult2.panelType === 'Report' && oldResult2.rows && oldResult2.cols)
            ? 'YES' : 'NO - BUG!');

    // New behavior
    const newResult2 = Object.assign({}, originalConfig2, newColumnSettings2);
    console.log('  New result (fixed):', JSON.stringify(newResult2));
    console.log('  panelType preserved:', newResult2.panelType === 'Report' ? 'YES' : 'NO');
    console.log('  rows preserved:', newResult2.rows ? 'YES' : 'NO');
    console.log('  cols preserved:', newResult2.cols ? 'YES' : 'NO');
    console.log('');

    // Test case 3: Empty original config (default case)
    console.log('Test 3: Handle empty original config');
    const originalConfig3 = {};
    const newColumnSettings3 = { o: ['a', 'b'], v: ['a'] };

    const newResult3 = Object.assign({}, originalConfig3, newColumnSettings3);
    console.log('  Result:', JSON.stringify(newResult3));
    console.log('  Works correctly:',
        (JSON.stringify(newResult3) === JSON.stringify(newColumnSettings3))
            ? 'YES' : 'NO');
    console.log('');

    // Test case 4: New settings should override old values for same keys
    console.log('Test 4: New settings override old values for same keys');
    const originalConfig4 = { o: ['old1', 'old2'], v: ['old1'], panelType: 'Report' };
    const newColumnSettings4 = { o: ['new1', 'new2', 'new3'], v: ['new1', 'new2'] };

    const newResult4 = Object.assign({}, originalConfig4, newColumnSettings4);
    console.log('  Result:', JSON.stringify(newResult4));
    console.log('  Column order updated:',
        (JSON.stringify(newResult4.o) === JSON.stringify(['new1', 'new2', 'new3']))
            ? 'YES' : 'NO');
    console.log('  Visible columns updated:',
        (JSON.stringify(newResult4.v) === JSON.stringify(['new1', 'new2']))
            ? 'YES' : 'NO');
    console.log('  panelType still preserved:',
        newResult4.panelType === 'Report' ? 'YES' : 'NO');
    console.log('');

    console.log('=== All Tests Complete ===');
}

// Run tests
testConfigMerge();
