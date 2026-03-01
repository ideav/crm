/**
 * Test script for issue #553: Auto-select @id URL filter values on create record form
 *
 * The issue: when the page URL has FR_4547=@6753 (an @id filter),
 * opening the create record form should automatically pre-select
 * the record with id=6753 in the corresponding reference dropdown.
 *
 * Implementation: buildRefIdPrefillFromUrlFilters(metadata) collects
 * all isRefId URL filters, checks if they match a reference requisite
 * in the metadata, and returns a reqs map to pre-fill the form.
 */

'use strict';

// ===== Simulate the relevant parts of IntegramTable =====

function simulateBuildRefIdPrefillFromUrlFilters(urlFilters, metadata) {
    if (!urlFilters || !metadata || !metadata.reqs) return null;

    const reqs = {};
    let hasPrefill = false;

    for (const [colId, urlFilter] of Object.entries(urlFilters)) {
        if (!urlFilter.isRefId || !urlFilter.refId) continue;

        // Check if this colId matches a requisite in the metadata
        const matchingReq = metadata.reqs.find(req => String(req.id) === String(colId) && req.ref_id);
        if (matchingReq) {
            reqs[colId] = { value: String(urlFilter.refId) };
            hasPrefill = true;
        }
    }

    return hasPrefill ? reqs : null;
}

// ===== Test helpers =====

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

// ===== TEST 1: Basic @id prefill works =====
console.log('\n=== TEST 1: Basic @id prefill for reference field ===');

const urlFilters1 = {
    '4547': { type: '=', value: '@6753', isRefId: true, refId: '6753', paramKey: 'FR_4547' }
};

const metadata1 = {
    id: 3596,
    val: 'Order',
    type: 3,
    reqs: [
        { id: '4547', val: 'Customer', ref_id: 100, orig: 200 },
        { id: '4548', val: 'Status', type: 3, ref_id: null }
    ]
};

const result1 = simulateBuildRefIdPrefillFromUrlFilters(urlFilters1, metadata1);

assert(result1 !== null, 'Result should not be null when prefill exists');
assert(result1['4547'] !== undefined, 'Should have prefill for field 4547');
assert(result1['4547'].value === '6753', 'Prefill value should be refId "6753"');
assert(result1['4548'] === undefined, 'Non-@id filter field should not be prefilled');
console.log(`  Result: ${JSON.stringify(result1)}`);

// ===== TEST 2: No @id filters = null result =====
console.log('\n=== TEST 2: No @id filters => null (no prefill) ===');

const urlFilters2 = {
    '4547': { type: '=', value: 'SomeText', isRefId: false, paramKey: 'FR_4547' }
};

const result2 = simulateBuildRefIdPrefillFromUrlFilters(urlFilters2, metadata1);

assert(result2 === null, 'Result should be null when no @id filters');

// ===== TEST 3: @id filter for non-reference field is ignored =====
console.log('\n=== TEST 3: @id filter for non-reference field is ignored ===');

const urlFilters3 = {
    '9999': { type: '=', value: '@6753', isRefId: true, refId: '6753', paramKey: 'FR_9999' }
    // 9999 does not exist in metadata1.reqs
};

const result3 = simulateBuildRefIdPrefillFromUrlFilters(urlFilters3, metadata1);

assert(result3 === null, 'Result should be null when @id filter does not match any ref field in metadata');

// ===== TEST 4: Multiple @id filters =====
console.log('\n=== TEST 4: Multiple @id filters ===');

const urlFilters4 = {
    '4547': { type: '=', value: '@6753', isRefId: true, refId: '6753', paramKey: 'FR_4547' },
    '4550': { type: '=', value: '@8888', isRefId: true, refId: '8888', paramKey: 'FR_4550' }
};

const metadata4 = {
    id: 3596,
    val: 'Order',
    type: 3,
    reqs: [
        { id: '4547', val: 'Customer', ref_id: 100 },
        { id: '4550', val: 'Department', ref_id: 150 }
    ]
};

const result4 = simulateBuildRefIdPrefillFromUrlFilters(urlFilters4, metadata4);

assert(result4 !== null, 'Result should not be null');
assert(result4['4547'] !== undefined, 'Field 4547 should be prefilled');
assert(result4['4547'].value === '6753', 'Field 4547 value should be 6753');
assert(result4['4550'] !== undefined, 'Field 4550 should be prefilled');
assert(result4['4550'].value === '8888', 'Field 4550 value should be 8888');

// ===== TEST 5: createRecordData structure =====
console.log('\n=== TEST 5: createRecordData structure when prefill exists ===');

// Simulate what openColumnCreateForm does with the result
const prefillReqs = simulateBuildRefIdPrefillFromUrlFilters(urlFilters1, metadata1);
const createRecordData = prefillReqs ? { obj: { val: '', parent: 1 }, reqs: prefillReqs } : null;

assert(createRecordData !== null, 'createRecordData should not be null');
assert(createRecordData.obj !== undefined, 'Should have obj property');
assert(createRecordData.obj.val === '', 'obj.val should be empty string');
assert(createRecordData.obj.parent === 1, 'obj.parent should be 1');
assert(createRecordData.reqs !== undefined, 'Should have reqs property');
assert(createRecordData.reqs['4547'].value === '6753', 'reqs[4547].value should be 6753');
console.log(`  createRecordData: ${JSON.stringify(createRecordData)}`);

// ===== TEST 6: createRecordData is null when no prefill =====
console.log('\n=== TEST 6: createRecordData is null when no @id filters ===');

const prefillReqs6 = simulateBuildRefIdPrefillFromUrlFilters({}, metadata1);
const createRecordData6 = prefillReqs6 ? { obj: { val: '', parent: 1 }, reqs: prefillReqs6 } : null;

assert(createRecordData6 === null, 'createRecordData should be null when no @id filters');

// ===== TEST 7: renderAttributesForm uses reqValue for hidden input =====
console.log('\n=== TEST 7: recordReqs[req.id].value is used as hidden input value ===');

// Simulate what renderAttributesForm does
function simulateReferenceFieldValue(recordReqs, reqId) {
    const reqValue = recordReqs[reqId] ? recordReqs[reqId].value : '';
    // This is what goes into the hidden input's value attribute
    return reqValue;
}

const recordReqs7 = { '4547': { value: '6753' } };
const hiddenInputValue = simulateReferenceFieldValue(recordReqs7, '4547');

assert(hiddenInputValue === '6753', 'Hidden input value should be "6753"');
assert(simulateReferenceFieldValue(recordReqs7, '9999') === '', 'Missing req should give empty string');

// ===== TEST 8: loadReferenceOptions finds matching option =====
console.log('\n=== TEST 8: loadReferenceOptions selection logic ===');

// Simulate what loadReferenceOptions does with the hidden input value
const mockOptions = [
    ['6750', 'Customer A'],
    ['6753', 'Customer XYZ'],
    ['6760', 'Customer B'],
];

const hiddenValue = '6753';
const selectedOption = mockOptions.find(([id]) => id === hiddenValue);

assert(selectedOption !== undefined, 'Should find matching option by id');
assert(selectedOption[0] === '6753', 'Selected option id should be 6753');
assert(selectedOption[1] === 'Customer XYZ', 'Selected option text should be "Customer XYZ"');

// ===== TEST 9: No match case =====
console.log('\n=== TEST 9: loadReferenceOptions - no match (id not in list) ===');

const hiddenValue9 = '9999';
const selectedOption9 = mockOptions.find(([id]) => id === hiddenValue9);

assert(selectedOption9 === undefined, 'Should not find option when id not in list');

// ===== TEST 10: urlFilters is empty / null guard =====
console.log('\n=== TEST 10: Guard: null/empty urlFilters ===');

assert(simulateBuildRefIdPrefillFromUrlFilters(null, metadata1) === null, 'null urlFilters => null result');
assert(simulateBuildRefIdPrefillFromUrlFilters({}, metadata1) === null, 'empty urlFilters => null result');
assert(simulateBuildRefIdPrefillFromUrlFilters(urlFilters1, null) === null, 'null metadata => null result');
assert(simulateBuildRefIdPrefillFromUrlFilters(urlFilters1, {}) === null, 'metadata without reqs => null result');

// ===== Summary =====
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
    console.log('ALL TESTS PASSED ✓');
} else {
    console.log('SOME TESTS FAILED ✗');
    process.exit(1);
}
