// Test the regex fix for applyFormFieldSettings (issue #1526)
// Tests that FILE-type field groups are correctly identified

// Simulate the DOM lookup logic (before and after fix)

function getFieldIdOldWay(inputId) {
    // Old regex - doesn't handle -file suffix
    const match = inputId.match(/^field-(.+?)(-search|-picker)?$/);
    return match ? match[1] : null;
}

function getFieldIdNewWay(inputId, allInputIds) {
    // New logic: prefer non-file inputs
    // Simulate: querySelector('input[type="hidden"][id^="field-"], input[id^="field-"]:not([type="file"])')
    // In DOM, the first matching element would be returned
    // The new selector prefers hidden inputs or non-file inputs
    // For the test, we just check the regex with the -file suffix added
    const match = inputId.match(/^field-(.+?)(-search|-picker|-file)?$/);
    return match ? match[1] : null;
}

console.log("=== Testing field ID extraction ===\n");

const testCases = [
    // [inputId, expectedOldWay, expectedNewWay, description]
    ['field-38-file', '38-file', '38', 'FILE field type=file input'],
    ['field-38', '38', '38', 'FILE field type=hidden input (canonical)'],
    ['field-20', '20', '20', 'PWD field (normal)'],
    ['field-125', '125', '125', 'Token field (normal)'],
    ['field-38-search', '38', '38', 'REF field search input'],
    ['field-38-picker', '38', '38', 'DATE field picker input'],
    ['field-main', 'main', 'main', 'Main value field'],
];

let allPassed = true;
testCases.forEach(([inputId, expectedOld, expectedNew, desc]) => {
    const oldResult = getFieldIdOldWay(inputId);
    const newResult = getFieldIdNewWay(inputId);
    const oldPass = oldResult === expectedOld;
    const newPass = newResult === expectedNew;
    console.log(`${desc}: input="${inputId}"`);
    console.log(`  Old: "${oldResult}" → ${oldPass ? 'OK' : 'WRONG'} (expected "${expectedOld}")`);
    console.log(`  New: "${newResult}" → ${newPass ? 'OK ✓' : 'WRONG ✗'} (expected "${expectedNew}")`);
    if (!newPass) allPassed = false;
});

console.log(`\n${allPassed ? 'All tests PASSED ✓' : 'SOME TESTS FAILED ✗'}`);

console.log('\n=== Demonstrating the fix effect on applyFormFieldSettings ===\n');

// Simulate applyFormFieldSettings with the fixed groupMap
const groupMapOld = {};
const groupMapNew = {};

// Simulate form groups as they appear in the DOM for the Пользователь form
const formGroupInputs = {
    'main': 'field-main',       // Main field (Пользователь name)
    'Роль': 'field-115',
    'Email': 'field-41',
    'Примечание': 'field-39',
    'Телефон': 'field-30',
    'Дата': 'field-156',
    'Имя': 'field-33',
    // FILE field - OLD bug: querySelector finds field-38-file first
    'Фото': 'field-38-file',    // OLD: first [id^="field-"] in FILE form-group is the file input
    'Activity': 'field-124',
    'Secret': 'field-130',
    'Password': 'field-20',
    'Token': 'field-125',
    'xsrf': 'field-40',
    'Retries': 'field-301',
};

// OLD mapping (bug)
Object.entries(formGroupInputs).forEach(([fieldName, inputId]) => {
    const match = inputId.match(/^field-(.+?)(-search|-picker)?$/);
    if (match) groupMapOld[match[1]] = fieldName;
});

// NEW mapping (fixed - also considers -file suffix)
Object.entries(formGroupInputs).forEach(([fieldName, inputId]) => {
    const match = inputId.match(/^field-(.+?)(-search|-picker|-file)?$/);
    if (match) groupMapNew[match[1]] = fieldName;
});

console.log('Old groupMap keys:', Object.keys(groupMapOld).join(', '));
console.log('New groupMap keys:', Object.keys(groupMapNew).join(', '));

const savedOrder = ['115', '41', '39', '30', '156', '33', '38', '124', '130', '20', '125', '40', '301'];
console.log('\nWith saved order containing "38" (Фото):');

const orderedOld = ['main'];
const orderedNew = ['main'];
savedOrder.forEach(fieldId => {
    if (groupMapOld[fieldId]) orderedOld.push(groupMapOld[fieldId]);
    else orderedOld.push(`[MISSING:${fieldId}]`);

    if (groupMapNew[fieldId]) orderedNew.push(groupMapNew[fieldId]);
    else orderedNew.push(`[MISSING:${fieldId}]`);
});

console.log('Old order (WRONG - Фото missing):', orderedOld.join(', '));
console.log('New order (CORRECT):', orderedNew.join(', '));
console.log('Old has MISSING:', orderedOld.some(s => s.includes('MISSING')));
console.log('New has MISSING:', orderedNew.some(s => s.includes('MISSING')));
