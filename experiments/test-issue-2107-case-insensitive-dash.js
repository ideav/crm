// Test: case-insensitive comparison of item, Колонка группы, Столбец бюджета
// in dashGetSrc / dashGetVal / dashGetColVal (issue #2107)

let passed = 0, failed = 0;

function assert(condition, msg) {
    if (condition) { console.log('  PASS: ' + msg); passed++; }
    else { console.error('  FAIL: ' + msg); failed++; }
}

// --- Minimal stubs -------------------------------------------------------

let dashValues = {};
let dashValueItemIds = {};

function dashGetFloat(v) {
    var f = parseFloat(String(v).replace(',', '.'));
    return isNaN(f) ? 0 : f;
}

function dashNormalizeVal(item, val) {
    var v = val || '';
    if (typeof val === 'object' && val !== null) v = val[0].val;
    return String(v).replace(/ /g, '').replace(/,/g, '.');
}

// --- Paste in the fixed functions ----------------------------------------

function dashGetVal(item, fr, to) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item;
    if (!dashValues[key]) return;
    for (i in dashValues[key]) {
        if (!fr || (dashValues[key][i].date >= fr && dashValues[key][i].date <= to)) {
            valids = true;
            acc += dashGetFloat(dashValues[key][i].val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

function dashGetColVal(item, col) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item, colLower = col ? col.toLowerCase() : col;
    if (!dashValues[key]) return;
    for (i in dashValues[key]) {
        if ((dashValues[key][i].col || '').toLowerCase() === colLower) {
            valids = true;
            acc += dashGetFloat(dashValues[key][i].val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

function dashGetSrc(json) {
    for (var i in json || []) {
        if (json[i].valueItemID) dashValueItemIds[(json[i].item || '').toLowerCase()] = json[i].valueItemID;
        if (json[i].value.length > 0) {
            try {
                var colGroup = (json[i]['Колонка группы'] || '').toLowerCase();
                var itemKey = (json[i].item || '').toLowerCase();
                var key = colGroup ? itemKey + ':' + colGroup : itemKey;
                var parsed = JSON.parse('[' + json[i].value + ']');
                dashValues[key] = parsed;
            } catch (e) {
                dashValues[(json[i].item || '').toLowerCase()] = 'error ' + e + ' in ' + json[i].value;
            }
        }
    }
}

// =========================================================================
// Test 1: item comparison - report returns uppercase, model uses lowercase
// =========================================================================
console.log('\nTest 1: item comparison (report uppercase vs model lowercase)');
dashValues = {}; dashValueItemIds = {};
dashGetSrc([
    { item: 'Revenue', 'Колонка группы': '', valueItemID: '', value: '{"date":"2024-01-01","val":"1000"}' }
]);
var v = dashGetVal('revenue', '2024-01-01', '2024-12-31');
assert(v !== undefined, 'dashGetVal finds "Revenue" stored data when looking up "revenue"');
assert(v === '1000', 'value is correct: ' + v);

// =========================================================================
// Test 2: item comparison - report returns lowercase, model uses mixed case
// =========================================================================
console.log('\nTest 2: item comparison (report lowercase vs model MixedCase)');
dashValues = {}; dashValueItemIds = {};
dashGetSrc([
    { item: 'выручка', 'Колонка группы': '', valueItemID: '', value: '{"date":"2024-01-01","val":"500"}' }
]);
v = dashGetVal('Выручка', '2024-01-01', '2024-12-31');
assert(v !== undefined, 'dashGetVal finds "выручка" when looking up "Выручка"');
assert(v === '500', 'value is correct: ' + v);

// =========================================================================
// Test 3: Колонка группы comparison - mixed case
// =========================================================================
console.log('\nTest 3: Колонка группы comparison (mixed case)');
dashValues = {}; dashValueItemIds = {};
dashGetSrc([
    { item: 'Продажи', 'Колонка группы': 'Факт', valueItemID: '', value: '{"date":"2024-01-01","val":"200"}' }
]);
v = dashGetVal('продажи:факт', '2024-01-01', '2024-12-31');
assert(v !== undefined, 'dashGetVal finds "Продажи:Факт" when looking up "продажи:факт"');
assert(v === '200', 'value is correct: ' + v);

// Test uppercase lookup
v = dashGetVal('ПРОДАЖИ:ФАКТ', '2024-01-01', '2024-12-31');
assert(v !== undefined, 'dashGetVal finds "Продажи:Факт" when looking up "ПРОДАЖИ:ФАКТ"');

// =========================================================================
// Test 4: Столбец бюджета (col field) comparison
// =========================================================================
console.log('\nTest 4: Столбец бюджета (col) comparison (mixed case)');
dashValues = {}; dashValueItemIds = {};
dashGetSrc([
    { item: 'Расходы', 'Колонка группы': '', valueItemID: '', value: '{"col":"Бюджет","val":"3000"}' }
]);
v = dashGetColVal('Расходы', 'бюджет');
assert(v !== undefined, 'dashGetColVal finds col "Бюджет" when looking up "бюджет"');
assert(v === '3000', 'value is correct: ' + v);

v = dashGetColVal('расходы', 'БЮДЖЕТ');
assert(v !== undefined, 'dashGetColVal finds col "Бюджет" with both item and col in uppercase');

// =========================================================================
// Test 5: dashValueItemIds - case insensitive lookup
// =========================================================================
console.log('\nTest 5: dashValueItemIds case-insensitive');
dashValues = {}; dashValueItemIds = {};
dashGetSrc([
    { item: 'Прибыль', 'Колонка группы': '', valueItemID: '42', value: '{"date":"2024-01-01","val":"100"}' }
]);
var itemName = 'прибыль';
var vid = dashValueItemIds[(itemName || '').toLowerCase()] || '';
assert(vid === '42', 'dashValueItemIds stores with lowercase key, lookup with lowercase "прибыль" gives "42"');

itemName = 'ПРИБЫЛЬ';
vid = dashValueItemIds[(itemName || '').toLowerCase()] || '';
assert(vid === '42', 'dashValueItemIds lookup with uppercase "ПРИБЫЛЬ" gives "42"');

// =========================================================================
console.log('\n--- Results ---');
console.log('Passed: ' + passed + '  Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
