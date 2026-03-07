/**
 * Test script for reference field parsing in forms.html
 * Issue #727: Display only the name part for reference fields (id:name format)
 *
 * Run with: node experiments/test-reference-field-parsing.js
 */

// ============================================================
// Parse Reference Field Value
// Reference fields come in format "id:name", e.g., "169:МоёМеню"
// Returns { id: string, name: string } or null if not a reference
// ============================================================
function parseReferenceValue(value) {
    if (!value || typeof value !== 'string') return null;
    const colonIndex = value.indexOf(':');
    if (colonIndex <= 0) return null;
    const id = value.substring(0, colonIndex);
    const name = value.substring(colonIndex + 1);
    // Only treat as reference if id part is numeric
    if (!/^\d+$/.test(id)) return null;
    return { id: id, name: name };
}

// ============================================================
// Get Display Value for Reference Field
// Shows only the name part for reference fields (id:name -> name)
// ============================================================
function getDisplayValue(value) {
    const ref = parseReferenceValue(value);
    return ref ? ref.name : value;
}

// ============================================================
// Test Cases
// ============================================================

console.log('Testing parseReferenceValue and getDisplayValue functions...\n');

const testCases = [
    // Reference fields (id:name format)
    { input: '169:МоёМеню', expectedParsed: { id: '169', name: 'МоёМеню' }, expectedDisplay: 'МоёМеню' },
    { input: '1:First', expectedParsed: { id: '1', name: 'First' }, expectedDisplay: 'First' },
    { input: '999:With:Colons:In:Name', expectedParsed: { id: '999', name: 'With:Colons:In:Name' }, expectedDisplay: 'With:Colons:In:Name' },
    { input: '42:', expectedParsed: { id: '42', name: '' }, expectedDisplay: '' },

    // Non-reference values (should return original)
    { input: 'Сводная таблица', expectedParsed: null, expectedDisplay: 'Сводная таблица' },
    { input: '0', expectedParsed: null, expectedDisplay: '0' },
    { input: '', expectedParsed: null, expectedDisplay: '' },
    { input: null, expectedParsed: null, expectedDisplay: null },
    { input: undefined, expectedParsed: null, expectedDisplay: undefined },
    { input: 'abc:def', expectedParsed: null, expectedDisplay: 'abc:def' }, // id is not numeric
    { input: ':test', expectedParsed: null, expectedDisplay: ':test' }, // colonIndex is 0
    { input: 'noColon', expectedParsed: null, expectedDisplay: 'noColon' },
];

let passCount = 0;
let failCount = 0;

testCases.forEach((test, index) => {
    const parsed = parseReferenceValue(test.input);
    const display = getDisplayValue(test.input);

    const parsedMatch = JSON.stringify(parsed) === JSON.stringify(test.expectedParsed);
    const displayMatch = display === test.expectedDisplay;

    if (parsedMatch && displayMatch) {
        console.log(`[PASS] Test ${index + 1}: input="${test.input}"`);
        passCount++;
    } else {
        console.log(`[FAIL] Test ${index + 1}: input="${test.input}"`);
        if (!parsedMatch) {
            console.log(`  parseReferenceValue: expected ${JSON.stringify(test.expectedParsed)}, got ${JSON.stringify(parsed)}`);
        }
        if (!displayMatch) {
            console.log(`  getDisplayValue: expected "${test.expectedDisplay}", got "${display}"`);
        }
        failCount++;
    }
});

console.log(`\n========================================`);
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log(`========================================`);

// Test with real-world example from issue #727
console.log('\n\nReal-world example from issue #727:');
const issueExample = {
    "i": 430,
    "u": 428,
    "o": 1,
    "r": [
        "Сводная таблица",
        "0",
        "169:МоёМеню",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]
};

console.log('Input:', JSON.stringify(issueExample.r, null, 2));
console.log('\nProcessed for display:');
issueExample.r.forEach((val, idx) => {
    const display = getDisplayValue(val);
    console.log(`  r[${idx}]: "${val}" => "${display}"`);
});

process.exit(failCount > 0 ? 1 : 0);
