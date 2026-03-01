/**
 * Experiment: Test reference value parsing for grouping (Issue #504)
 *
 * This test validates that the parseReferenceDisplayValue method correctly
 * handles "id:Value" format for reference fields when grouping.
 */

// Mock the parseReferenceDisplayValue function as it would be in the class
function parseReferenceDisplayValue(value, column) {
    if (value === null || value === undefined) return '';

    const strValue = String(value);

    // Check if this is a reference field (has ref_id or non-zero ref)
    const isRefField = column && (column.ref_id != null || (column.ref && column.ref !== 0));

    if (isRefField && strValue) {
        const colonIndex = strValue.indexOf(':');
        if (colonIndex > 0) {
            // Return only the display value part (after the colon)
            return strValue.substring(colonIndex + 1);
        }
    }

    return strValue;
}

// Test cases
console.log('=== Test Reference Value Parsing ===\n');

// Test 1: Reference field with "id:Value" format
const refColumn = { id: '1', name: 'Status', ref_id: '123', ref: 1 };
const refValue1 = '456:Active';
const result1 = parseReferenceDisplayValue(refValue1, refColumn);
console.log(`Test 1 - Reference field with id:Value`);
console.log(`  Input: "${refValue1}"`);
console.log(`  Column: ref_id=${refColumn.ref_id}`);
console.log(`  Expected: "Active"`);
console.log(`  Actual: "${result1}"`);
console.log(`  Result: ${result1 === 'Active' ? 'PASS' : 'FAIL'}\n`);

// Test 2: Reference field with no colon (just value)
const refValue2 = 'InProgress';
const result2 = parseReferenceDisplayValue(refValue2, refColumn);
console.log(`Test 2 - Reference field without colon`);
console.log(`  Input: "${refValue2}"`);
console.log(`  Expected: "InProgress"`);
console.log(`  Actual: "${result2}"`);
console.log(`  Result: ${result2 === 'InProgress' ? 'PASS' : 'FAIL'}\n`);

// Test 3: Non-reference field with colon in value
const nonRefColumn = { id: '2', name: 'Description', ref: 0 };
const nonRefValue = '12:30:45 - Meeting time';
const result3 = parseReferenceDisplayValue(nonRefValue, nonRefColumn);
console.log(`Test 3 - Non-reference field with colon (should keep full value)`);
console.log(`  Input: "${nonRefValue}"`);
console.log(`  Column: ref=${nonRefColumn.ref}`);
console.log(`  Expected: "${nonRefValue}"`);
console.log(`  Actual: "${result3}"`);
console.log(`  Result: ${result3 === nonRefValue ? 'PASS' : 'FAIL'}\n`);

// Test 4: Empty value
const result4 = parseReferenceDisplayValue('', refColumn);
console.log(`Test 4 - Empty value`);
console.log(`  Input: ""`);
console.log(`  Expected: ""`);
console.log(`  Actual: "${result4}"`);
console.log(`  Result: ${result4 === '' ? 'PASS' : 'FAIL'}\n`);

// Test 5: Null value
const result5 = parseReferenceDisplayValue(null, refColumn);
console.log(`Test 5 - Null value`);
console.log(`  Input: null`);
console.log(`  Expected: ""`);
console.log(`  Actual: "${result5}"`);
console.log(`  Result: ${result5 === '' ? 'PASS' : 'FAIL'}\n`);

// Test 6: Value starting with colon (edge case)
const refValue6 = ':NoId';
const result6 = parseReferenceDisplayValue(refValue6, refColumn);
console.log(`Test 6 - Value starting with colon (colonIndex=0)`);
console.log(`  Input: "${refValue6}"`);
console.log(`  Expected: "${refValue6}" (colonIndex <= 0, so no parsing)`);
console.log(`  Actual: "${result6}"`);
console.log(`  Result: ${result6 === refValue6 ? 'PASS' : 'FAIL'}\n`);

// Test 7: Grouping comparison simulation
console.log('=== Grouping Comparison Simulation ===\n');

const mockData = [
    ['789:Project A', 'Task 1'],
    ['123:Project B', 'Task 2'],
    ['789:Project A', 'Task 3'],
    ['456:Project A', 'Task 4'],  // Different ID, same display value
];

const projectColumn = { id: '0', name: 'Project', ref_id: '100', ref: 1 };

console.log('Data with raw values:');
mockData.forEach((row, i) => {
    console.log(`  Row ${i}: [${row[0]}, ${row[1]}]`);
});

console.log('\nParsed display values for grouping:');
mockData.forEach((row, i) => {
    const displayValue = parseReferenceDisplayValue(row[0], projectColumn);
    console.log(`  Row ${i}: "${row[0]}" -> "${displayValue}"`);
});

// Simulate sorting by display value
const sortedData = [...mockData].sort((a, b) => {
    const valA = parseReferenceDisplayValue(a[0], projectColumn).toLowerCase();
    const valB = parseReferenceDisplayValue(b[0], projectColumn).toLowerCase();
    return valA.localeCompare(valB);
});

console.log('\nSorted by display value:');
sortedData.forEach((row, i) => {
    const displayValue = parseReferenceDisplayValue(row[0], projectColumn);
    console.log(`  Row ${i}: "${displayValue}" <- [${row[0]}, ${row[1]}]`);
});

// Verify grouping would work correctly
console.log('\nGrouping result (all "Project A" items should group together):');
let currentGroup = null;
sortedData.forEach((row) => {
    const displayValue = parseReferenceDisplayValue(row[0], projectColumn);
    if (displayValue !== currentGroup) {
        console.log(`\n  Group: "${displayValue}"`);
        currentGroup = displayValue;
    }
    console.log(`    - ${row[1]}`);
});

console.log('\n=== All tests completed ===');
