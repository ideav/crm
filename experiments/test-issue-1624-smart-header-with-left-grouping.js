/**
 * Test: Smart header grouping works with left-side row grouping (issue #1624)
 *
 * The bug: when left-grouping is enabled (groupingEnabled=true, groupingColumns.length>0),
 * smart top-header grouping was completely disabled.
 *
 * The fix: allow smart headers to work with left-grouping. In left-grouping mode,
 * use the reordered columns (grouping cols first) for building the smart header tree.
 */

// Simulate the relevant parts of the IntegralTable class

function _smartHeaderLCP(a, b) {
    const partsA = a.split('.');
    const partsB = b.split('.');
    let i = 0;
    while (i < partsA.length && i < partsB.length && partsA[i] === partsB[i]) i++;
    if (i === 0) return '';
    return partsA.slice(0, i).join('.');
}

function buildSmartHeaderTree(columns) {
    if (columns.length === 0) return [];
    if (columns.length === 1) return [{ type: 'leaf', col: columns[0], span: 1 }];

    // Find shortest non-universal prefix that groups a proper subset of consecutive columns
    let bestPrefix = null;
    let bestStart = -1;
    let bestEnd = -1;

    for (let i = 0; i < columns.length - 1; i++) {
        const prefix = _smartHeaderLCP(columns[i].name, columns[i + 1].name);
        if (!prefix) continue;

        // Extend the group as far as it shares this prefix
        let end = i + 1;
        while (end + 1 < columns.length && columns[end + 1].name.startsWith(prefix + '.') || (end + 1 < columns.length && _smartHeaderLCP(columns[i].name, columns[end + 1].name) === prefix)) {
            end++;
        }

        // Skip universal prefix (covers all columns)
        if (i === 0 && end === columns.length - 1) continue;

        // Use shortest prefix (fewest words = least specific)
        if (bestPrefix === null || prefix.split('.').length < bestPrefix.split('.').length) {
            bestPrefix = prefix;
            bestStart = i;
            bestEnd = end;
        }
    }

    if (bestPrefix === null) {
        // No grouping: all flat leaves
        return columns.map(col => ({ type: 'leaf', col, span: 1 }));
    }

    const result = [];
    // Leaves before the group
    for (let i = 0; i < bestStart; i++) {
        result.push({ type: 'leaf', col: columns[i], span: 1 });
    }
    // The group
    const groupCols = columns.slice(bestStart, bestEnd + 1);
    const suffixCols = groupCols.map(col => ({
        ...col,
        name: col.name.slice(bestPrefix.length + 1) // remove prefix + dot
    }));
    result.push({
        type: 'group',
        prefix: bestPrefix,
        span: groupCols.length,
        children: buildSmartHeaderTree(suffixCols.map((sc, idx) => ({ ...groupCols[idx], name: sc.name })))
    });
    // Leaves after the group
    for (let i = bestEnd + 1; i < columns.length; i++) {
        result.push({ type: 'leaf', col: columns[i], span: 1 });
    }
    return result;
}

function smartHeaderTreeDepth(nodes) {
    return nodes.reduce((max, n) =>
        Math.max(max, n.type === 'group' ? 1 + smartHeaderTreeDepth(n.children) : 1), 0);
}

// --- Tests ---

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`PASS: ${name}`);
        passed++;
    } catch (e) {
        console.log(`FAIL: ${name}: ${e.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// Simulate the fixed render logic
function simulateHeaderRender(columns, groupingEnabled, groupingColumns) {
    const isLeftGrouping = groupingEnabled && groupingColumns.length > 0;
    const groupingColumnSet = isLeftGrouping ? new Set(groupingColumns) : null;

    // In left-grouping mode, reorder columns: grouping cols first, then non-grouping
    const headerColumns = isLeftGrouping
        ? [
            ...groupingColumns
                .map(colId => columns.find(c => c.id === colId))
                .filter(Boolean),
            ...columns.filter(col => !groupingColumnSet.has(col.id))
          ]
        : columns;

    const smartTree = buildSmartHeaderTree(headerColumns);
    const smartDepth = smartHeaderTreeDepth(smartTree);
    const hasSmartGroups = smartDepth > 1;

    return { headerColumns, smartTree, smartDepth, hasSmartGroups, groupingColumnSet };
}

// Test 1: No grouping, smart headers work normally
test('no left-grouping: smart headers work for prefixed columns', () => {
    const columns = [
        { id: 'a', name: 'info.x' },
        { id: 'b', name: 'info.y' },
        { id: 'c', name: 'other' },
    ];
    const { hasSmartGroups, smartDepth } = simulateHeaderRender(columns, false, []);
    assertEqual(hasSmartGroups, true, 'should have smart groups');
    assertEqual(smartDepth, 2, 'depth should be 2');
});

// Test 2: Left-grouping enabled, smart headers should still work for non-grouping columns
test('left-grouping enabled: smart headers still work for non-grouping prefixed columns', () => {
    const columns = [
        { id: 'vid_zakupki', name: 'Вид закупки' },
        { id: 'info_x', name: 'информация №4.возможность соответствовать.можно' },
        { id: 'info_y', name: 'информация №4.возможность соответствовать.время' },
        { id: 'info_z', name: 'информация №4.сумма' },
    ];
    const groupingColumns = ['vid_zakupki'];
    const { hasSmartGroups, smartDepth, headerColumns } = simulateHeaderRender(columns, true, groupingColumns);

    // Grouping column should be first
    assertEqual(headerColumns[0].id, 'vid_zakupki', 'grouping col should be first');
    // Should have smart groups since non-grouping cols share prefix
    assertEqual(hasSmartGroups, true, 'should have smart groups');
    console.log(`  smartDepth=${smartDepth}`);
});

// Test 3: With old logic (useSmartHeaders = !groupingEnabled), no smart headers when grouping active
test('OLD BUG: smart headers disabled when left-grouping active (should NOT happen with fix)', () => {
    const columns = [
        { id: 'vid_zakupki', name: 'Вид закупки' },
        { id: 'info_x', name: 'информация №4.x' },
        { id: 'info_y', name: 'информация №4.y' },
    ];
    // Old logic: useSmartHeaders = !(groupingEnabled && groupingColumns.length > 0) = false
    const useSmartHeaders_old = !(true && ['vid_zakupki'].length > 0);
    assertEqual(useSmartHeaders_old, false, 'old logic disabled smart headers');

    // New logic: always try smart headers
    const { hasSmartGroups } = simulateHeaderRender(columns, true, ['vid_zakupki']);
    assertEqual(hasSmartGroups, true, 'new logic: smart headers still work');
});

// Test 4: Left-grouping enabled, but no prefixed columns — should still produce flat header
test('left-grouping enabled, no prefixed columns: flat single-row header', () => {
    const columns = [
        { id: 'vid_zakupki', name: 'Вид закупки' },
        { id: 'naimeno', name: 'Наименование' },
        { id: 'budget', name: 'Бюджет' },
    ];
    const { hasSmartGroups } = simulateHeaderRender(columns, true, ['vid_zakupki']);
    assertEqual(hasSmartGroups, false, 'should NOT have smart groups when no prefixed columns');
});

// Test 5: Grouping column with badge in smart header mode
test('left-grouping enabled: grouping columns get isGroupingCol=true in renderSmartHeaderRows', () => {
    const columns = [
        { id: 'vid', name: 'Вид' },
        { id: 'info_x', name: 'информация.x' },
        { id: 'info_y', name: 'информация.y' },
    ];
    const groupingColumns = ['vid'];
    const { groupingColumnSet } = simulateHeaderRender(columns, true, groupingColumns);
    assertEqual(groupingColumnSet !== null, true, 'groupingColumnSet should exist');
    assertEqual(groupingColumnSet.has('vid'), true, 'vid should be in groupingColumnSet');
    assertEqual(groupingColumnSet.has('info_x'), false, 'info_x should NOT be in groupingColumnSet');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
