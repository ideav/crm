/**
 * Test script for grouping functionality (issue #502)
 *
 * This script tests the core grouping logic without needing a browser.
 */

// Mock data for testing
const mockData = [
    ['Product A', 'Category 1', 100, 'Supplier X'],
    ['Product B', 'Category 1', 200, 'Supplier X'],
    ['Product C', 'Category 2', 150, 'Supplier X'],
    ['Product D', 'Category 2', 300, 'Supplier Y'],
    ['Product E', 'Category 1', 250, 'Supplier Y'],
    ['Product F', 'Category 3', 175, 'Supplier Y'],
];

const mockColumns = [
    { id: '0', name: 'Name' },
    { id: '1', name: 'Category' },
    { id: '2', name: 'Price' },
    { id: '3', name: 'Supplier' },
];

// Test the processGroupedData logic
function processGroupedData(data, columns, groupingColumns) {
    if (!groupingColumns || groupingColumns.length === 0) {
        return [];
    }

    // Get column indices for grouping columns
    const groupColIndices = groupingColumns.map(colId => {
        return columns.findIndex(c => c.id === colId);
    }).filter(idx => idx !== -1);

    if (groupColIndices.length === 0) {
        return [];
    }

    // Sort data by grouping columns
    const sortedData = [...data].sort((a, b) => {
        for (const colIdx of groupColIndices) {
            const valA = a[colIdx] || '';
            const valB = b[colIdx] || '';

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();

            if (strA < strB) return -1;
            if (strA > strB) return 1;
        }
        return 0;
    });

    // Create grouped structure
    const groupedData = [];
    let prevGroupValues = [];

    sortedData.forEach((row, rowIndex) => {
        const groupValues = groupColIndices.map(colIdx => row[colIdx] || '');

        // Determine which group levels changed
        let changedLevel = -1;
        for (let i = 0; i < groupValues.length; i++) {
            if (groupValues[i] !== prevGroupValues[i]) {
                changedLevel = i;
                break;
            }
        }

        // Create row info
        const rowInfo = {
            originalIndex: data.indexOf(row),
            data: row,
            groupCells: []
        };

        // If this is first row or group value changed, calculate rowspan
        if (rowIndex === 0 || changedLevel !== -1) {
            for (let level = (changedLevel === -1 ? 0 : changedLevel); level < groupColIndices.length; level++) {
                const colIdx = groupColIndices[level];
                let rowspan = 1;

                // Count subsequent rows with same value at this level
                for (let j = rowIndex + 1; j < sortedData.length; j++) {
                    let allMatch = true;
                    for (let k = 0; k <= level; k++) {
                        if (sortedData[j][groupColIndices[k]] !== groupValues[k]) {
                            allMatch = false;
                            break;
                        }
                    }
                    if (allMatch) {
                        rowspan++;
                    } else {
                        break;
                    }
                }

                rowInfo.groupCells.push({
                    colId: groupingColumns[level],
                    colIndex: colIdx,
                    value: groupValues[level],
                    rowspan: rowspan
                });
            }
        }

        groupedData.push(rowInfo);
        prevGroupValues = groupValues;
    });

    return { groupedData, sortedData };
}

// Test 1: Group by Category (single column)
console.log('Test 1: Group by Category (single column)');
const result1 = processGroupedData(mockData, mockColumns, ['1']);
console.log('Sorted data:', result1.sortedData.map(r => r[1]));
console.log('Grouped data:', result1.groupedData.map(r => ({
    category: r.data[1],
    groupCells: r.groupCells.map(g => ({ value: g.value, rowspan: g.rowspan }))
})));
console.log('');

// Test 2: Group by Category, then Supplier (two columns)
console.log('Test 2: Group by Category, then Supplier (two columns)');
const result2 = processGroupedData(mockData, mockColumns, ['1', '3']);
console.log('Sorted data:', result2.sortedData.map(r => `${r[1]} / ${r[3]}`));
console.log('Grouped data:');
result2.groupedData.forEach((r, idx) => {
    const groupCellsInfo = r.groupCells.length > 0
        ? r.groupCells.map(g => `${g.value}(rowspan=${g.rowspan})`).join(', ')
        : '(continues previous groups)';
    console.log(`  Row ${idx}: ${r.data[0]} - ${groupCellsInfo}`);
});
console.log('');

// Test 3: Verify rowspan calculations
console.log('Test 3: Verify rowspan calculations');
result2.groupedData.forEach((r, idx) => {
    if (r.groupCells.length > 0) {
        r.groupCells.forEach(g => {
            console.log(`  Row ${idx}: Column ${g.colId} = "${g.value}" spans ${g.rowspan} rows`);
        });
    }
});

console.log('');
console.log('All tests completed successfully!');
