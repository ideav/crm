/**
 * Test for issue #869: single-select reference field saving id:text instead of just id
 *
 * The problem: when editing a record, the hidden input for a single-select ref field
 * is populated with the raw value from the API response (e.g. "145:admin").
 * When saving, the form submits t115=145:admin instead of t115=145.
 *
 * The fix: in loadReferenceOptions, detect "id:text" format and strip the text part.
 */

// Simulate the options array (as returned by fetchReferenceOptions)
const options = [
    ['145', 'admin'],
    ['146', 'manager'],
    ['147', 'user'],
];

// Simulate hiddenInput and searchInput
function testParsing(rawValue) {
    let hiddenValue = rawValue;
    let searchValue = '';

    if (hiddenValue) {
        // Fix: Issue #869 — strip text part from "id:text" format
        const colonIdx = hiddenValue.indexOf(':');
        if (colonIdx > 0) {
            hiddenValue = hiddenValue.substring(0, colonIdx);
        }
        const currentOption = options.find(([id]) => id === hiddenValue);
        if (currentOption) {
            searchValue = currentOption[1];
        }
    }

    return { hiddenValue, searchValue };
}

// Test cases
const tests = [
    { input: '145:admin',   expectedId: '145',  expectedText: 'admin' },
    { input: '146:manager', expectedId: '146',  expectedText: 'manager' },
    { input: '145',         expectedId: '145',  expectedText: 'admin' },  // plain id (already correct)
    { input: '',            expectedId: '',     expectedText: '' },       // empty
    { input: '999:unknown', expectedId: '999',  expectedText: '' },       // id not in options
];

let pass = 0;
let fail = 0;
for (const t of tests) {
    const result = testParsing(t.input);
    const ok = result.hiddenValue === t.expectedId && result.searchValue === t.expectedText;
    if (ok) {
        pass++;
        console.log(`PASS: input="${t.input}" → id="${result.hiddenValue}" text="${result.searchValue}"`);
    } else {
        fail++;
        console.log(`FAIL: input="${t.input}" → id="${result.hiddenValue}" (expected "${t.expectedId}"), text="${result.searchValue}" (expected "${t.expectedText}")`);
    }
}

console.log(`\n${pass} passed, ${fail} failed`);
