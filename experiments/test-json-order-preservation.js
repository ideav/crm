/**
 * Test script for JSON order preservation
 * This tests the parseJsonObjectAsArray function that preserves server order
 */

function parseJsonObjectAsArray(jsonText) {
    const result = [];
    // Match "key": "value" or "key": value patterns, preserving order
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|([^,}\s]+))/g;
    let match;
    while ((match = regex.exec(jsonText)) !== null) {
        const key = match[1].replace(/\\(.)/g, '$1'); // Unescape
        const value = match[2] !== undefined
            ? match[2].replace(/\\(.)/g, '$1')  // String value, unescape
            : match[3];  // Non-string value (number, boolean, null)
        result.push([key, value]);
    }
    return result;
}

// Test cases
const tests = [
    {
        name: 'Basic JSON with numeric keys in specific order',
        input: '{"100": "Option A", "5": "Option B", "50": "Option C", "1": "Option D", "25": "Option E"}',
        expected: [["100", "Option A"], ["5", "Option B"], ["50", "Option C"], ["1", "Option D"], ["25", "Option E"]]
    },
    {
        name: 'JSON with escaped characters',
        input: '{"1": "Test \\"quoted\\" value", "2": "Normal value"}',
        expected: [["1", 'Test "quoted" value'], ["2", "Normal value"]]
    },
    {
        name: 'Empty object',
        input: '{}',
        expected: []
    },
    {
        name: 'Single entry',
        input: '{"42": "Only option"}',
        expected: [["42", "Only option"]]
    },
    {
        name: 'Keys with Russian text',
        input: '{"100": "Компания А", "5": "Компания Б", "1": "Компания В"}',
        expected: [["100", "Компания А"], ["5", "Компания Б"], ["1", "Компания В"]]
    }
];

console.log('Testing parseJsonObjectAsArray function:\n');

let passed = 0;
let failed = 0;

tests.forEach(test => {
    const result = parseJsonObjectAsArray(test.input);
    const success = JSON.stringify(result) === JSON.stringify(test.expected);
    
    if (success) {
        console.log(`✓ ${test.name}`);
        passed++;
    } else {
        console.log(`✗ ${test.name}`);
        console.log(`  Input: ${test.input}`);
        console.log(`  Expected: ${JSON.stringify(test.expected)}`);
        console.log(`  Got: ${JSON.stringify(result)}`);
        failed++;
    }
});

console.log(`\n${passed} passed, ${failed} failed`);

// Compare with standard JSON.parse + Object.entries
console.log('\n--- Comparison with Object.entries() ---');
const jsonWithNumericKeys = '{"100": "Option A", "5": "Option B", "50": "Option C", "1": "Option D", "25": "Option E"}';

console.log('Original JSON order: 100, 5, 50, 1, 25');
console.log('Object.entries() order:', Object.entries(JSON.parse(jsonWithNumericKeys)).map(([k]) => k).join(', '));
console.log('parseJsonObjectAsArray order:', parseJsonObjectAsArray(jsonWithNumericKeys).map(([k]) => k).join(', '));
