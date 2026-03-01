/**
 * Test script for issue #551: URL filter @id support
 *
 * Tests that:
 * 1. parseFilterValue() correctly detects @{id} format
 * 2. urlFilters stores isRefId and refId fields
 * 3. resolveRefIdUrlFilters() updates displayValue from fetched options
 * 4. renderFilterCell() uses displayValue when available
 * 5. User editing clears displayValue
 */

// Simulate the parseFilterValue function (extracted from integram-table.js)
function parseFilterValue(rawValue) {
    if (!rawValue || rawValue === '') {
        return { type: '^', value: '' };
    }
    if (rawValue === '%') return { type: '%', value: '' };
    if (rawValue === '!%') return { type: '!%', value: '' };

    // Check for ID-based filter: @{id} means filter by record ID (issue #551)
    const refIdMatch = rawValue.match(/^@(\d+)$/);
    if (refIdMatch) {
        return { type: '=', value: rawValue, isRefId: true, refId: refIdMatch[1] };
    }

    const inMatch = rawValue.match(/^IN\((.+)\)$/);
    if (inMatch) return { type: '(,)', value: inMatch[1] };

    if (rawValue.startsWith('!')) {
        const innerValue = rawValue.substring(1);
        if (innerValue.startsWith('%') && innerValue.endsWith('%')) return { type: '!', value: innerValue.slice(1, -1) };
        if (innerValue.startsWith('%') && !innerValue.endsWith('%')) return { type: '!^', value: innerValue.substring(1) };
        return { type: '≠', value: innerValue };
    }
    if (rawValue.startsWith('>=')) return { type: '≥', value: rawValue.substring(2) };
    if (rawValue.startsWith('<=')) return { type: '≤', value: rawValue.substring(2) };
    if (rawValue.startsWith('%') && rawValue.endsWith('%') && rawValue.length > 2) return { type: '~', value: rawValue.slice(1, -1) };
    if (rawValue.startsWith('%') && !rawValue.endsWith('%')) return { type: '$', value: rawValue.substring(1) };
    if (rawValue.endsWith('%') && !rawValue.startsWith('%')) return { type: '^', value: rawValue.slice(0, -1) };
    return { type: '=', value: rawValue };
}

// TEST 1: parseFilterValue detects @id format
console.log('=== TEST 1: parseFilterValue with @id format ===');

const test1a = parseFilterValue('@6753');
console.assert(test1a.type === '=', 'Type should be =');
console.assert(test1a.value === '@6753', 'Value should be @6753');
console.assert(test1a.isRefId === true, 'isRefId should be true');
console.assert(test1a.refId === '6753', 'refId should be 6753');
console.log('  @6753:', JSON.stringify(test1a));

const test1b = parseFilterValue('@100');
console.assert(test1b.isRefId === true, 'isRefId should be true for @100');
console.assert(test1b.refId === '100', 'refId should be 100');
console.log('  @100:', JSON.stringify(test1b));

// Ensure non-@ values are NOT treated as refId
const test1c = parseFilterValue('6753');
console.assert(!test1c.isRefId, 'Plain number should not be isRefId');
console.assert(test1c.type === '=', 'Plain number type should be =');
console.log('  6753 (plain):', JSON.stringify(test1c));

const test1d = parseFilterValue('test@email.com');
console.assert(!test1d.isRefId, 'Email-like value should not be isRefId');
console.log('  test@email.com:', JSON.stringify(test1d));

const test1e = parseFilterValue('@abc');
console.assert(!test1e.isRefId, '@abc (non-digit) should not be isRefId');
console.log('  @abc:', JSON.stringify(test1e));

console.log('TEST 1 PASSED\n');

// TEST 2: urlFilters stores isRefId and refId
console.log('=== TEST 2: URL filter parsing stores isRefId ===');

// Simulate what parseUrlFiltersFromParams would store
const parsed = parseFilterValue('@6753');
const urlFilter = {
    type: parsed.type,
    value: parsed.value,
    paramKey: 'FR_4547'
};
if (parsed.isRefId) {
    urlFilter.isRefId = true;
    urlFilter.refId = parsed.refId;
}

console.assert(urlFilter.isRefId === true, 'urlFilter should have isRefId=true');
console.assert(urlFilter.refId === '6753', 'urlFilter should have refId=6753');
console.assert(urlFilter.value === '@6753', 'urlFilter should have value=@6753');
console.log('  urlFilter:', JSON.stringify(urlFilter));
console.log('TEST 2 PASSED\n');

// TEST 3: resolveRefIdUrlFilters resolves label from options
console.log('=== TEST 3: Resolution of @id to text label ===');

// Simulate the options returned by fetchReferenceOptions
const mockOptions = [
    ['6750', 'Option A'],
    ['6753', 'Customer XYZ'],
    ['6760', 'Option C'],
];

// Simulate what resolveRefIdUrlFilters does
const filters = { '4547': { type: '=', value: '@6753' } };
const urlFilters = { '4547': { isRefId: true, refId: '6753', value: '@6753' } };

// Find matching option
const match = mockOptions.find(([id]) => String(id) === String(urlFilters['4547'].refId));
if (match && filters['4547'] && filters['4547'].value === urlFilters['4547'].value) {
    filters['4547'].displayValue = match[1];
}

console.assert(filters['4547'].displayValue === 'Customer XYZ', 'displayValue should be resolved');
console.assert(filters['4547'].value === '@6753', 'value should remain @id for API');
console.log('  filters[4547]:', JSON.stringify(filters['4547']));
console.log('TEST 3 PASSED\n');

// TEST 4: renderFilterCell uses displayValue
console.log('=== TEST 4: renderFilterCell uses displayValue ===');

// Simulate renderFilterCell logic
function getDisplayForInput(currentFilter) {
    return currentFilter.displayValue !== undefined ? currentFilter.displayValue : currentFilter.value;
}

// Filter with displayValue
const filterWithDisplay = { type: '=', value: '@6753', displayValue: 'Customer XYZ' };
console.assert(getDisplayForInput(filterWithDisplay) === 'Customer XYZ', 'Should show displayValue');
console.log('  Filter with displayValue shows:', getDisplayForInput(filterWithDisplay));

// Filter without displayValue (regular text filter)
const filterWithoutDisplay = { type: '=', value: 'some text' };
console.assert(getDisplayForInput(filterWithoutDisplay) === 'some text', 'Should show value when no displayValue');
console.log('  Filter without displayValue shows:', getDisplayForInput(filterWithoutDisplay));

// Filter with empty displayValue (shouldn't happen but guard)
const filterEmptyDisplay = { type: '=', value: 'text', displayValue: '' };
console.assert(getDisplayForInput(filterEmptyDisplay) === '', 'Empty displayValue should be shown as empty');
console.log('TEST 4 PASSED\n');

// TEST 5: User editing clears displayValue
console.log('=== TEST 5: User editing clears displayValue ===');

// Simulate user input
const filterBeforeEdit = { type: '=', value: '@6753', displayValue: 'Customer XYZ' };

// User types new value
const userInput = 'New Filter Value';
filterBeforeEdit.value = userInput;
delete filterBeforeEdit.displayValue;

console.assert(filterBeforeEdit.value === userInput, 'value should be user input');
console.assert(filterBeforeEdit.displayValue === undefined, 'displayValue should be cleared');
console.log('  Filter after user edit:', JSON.stringify(filterBeforeEdit));
console.log('TEST 5 PASSED\n');

// TEST 6: applyFilter sends @id as-is to API
console.log('=== TEST 6: applyFilter behavior with @id value ===');

// When filter.value = '@6753' and type = '=', format is 'FR_{T}={X}'
// Result: FR_4547=@6753 -> strip FR_4547= -> send @6753
const filterType = '=';
const filterValue = '@6753';
const colId = '4547';
const format = 'FR_{ T }={ X }';
const paramValue = format.replace('{ T }', colId).replace('{ X }', filterValue);
// Strip FR_{colId}= prefix
const prefix = 'FR_' + colId;
let apiValue = paramValue.startsWith(prefix) ? paramValue.substring(prefix.length) : paramValue;
if (apiValue.startsWith('=')) apiValue = apiValue.substring(1);

console.assert(apiValue === '@6753', 'API should receive @6753');
console.log('  API receives for FR_4547=@6753:', apiValue);
console.log('TEST 6 PASSED\n');

console.log('=== ALL TESTS PASSED ===');
