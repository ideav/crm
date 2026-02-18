/**
 * Experiment to verify the fix for issue #535:
 * Dates in grouped columns were sorted as text instead of as actual dates.
 *
 * Root cause: compareGroupingValues used normalizeFormat(column.type) which
 * maps numeric type IDs (e.g., "323") -> unknown -> default 'SHORT'.
 * Fix: Check column.format first (like renderCell does), then fall back to normalizeFormat.
 */

// Simulate the relevant parts of the integram-table.js logic

const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                      'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                      'GRANT', 'REPORT_COLUMN', 'PATH'];

function getFormatById(typeId) {
    const formatMap = {
        '3': 'SHORT', '8': 'CHARS', '9': 'DATE', '13': 'NUMBER',
        '14': 'SIGNED', '11': 'BOOLEAN', '12': 'MEMO', '4': 'DATETIME',
        '10': 'FILE', '2': 'HTML', '7': 'BUTTON', '6': 'PWD',
        '5': 'GRANT', '16': 'REPORT_COLUMN', '17': 'PATH'
    };
    return formatMap[String(typeId)] || 'SHORT';
}

function normalizeFormat(baseTypeId) {
    const upperTypeId = String(baseTypeId).toUpperCase();
    if (validFormats.includes(upperTypeId)) return upperTypeId;
    return getFormatById(baseTypeId);
}

function parseDDMMYYYY(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts.map(Number);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return new Date(year, month - 1, day);
}

// OLD behavior (before fix)
function getBaseFormatOld(column) {
    return normalizeFormat(column.type);
}

// NEW behavior (after fix - issue #535)
function getBaseFormatNew(column) {
    const upperFormat = column.format ? String(column.format).toUpperCase() : '';
    return validFormats.includes(upperFormat) ? upperFormat :
           (column.type ? normalizeFormat(column.type) : 'SHORT');
}

// Column from the issue: type "323" (custom app-specific ID), format "DATE"
const dateColumn = { id: '2146', type: '323', format: 'DATE', name: 'Дата встречи' };

console.log('=== Testing fix for issue #535 ===\n');
console.log('Column:', dateColumn);
console.log('');
console.log('OLD: getBaseFormatOld(column) =', getBaseFormatOld(dateColumn));
console.log('NEW: getBaseFormatNew(column) =', getBaseFormatNew(dateColumn));
console.log('');

// Test dates from the issue data
const dates = ['02.02.2026', '03.01.2026', '18.02.2026', '01.01.1970', '14.02.2026', '06.01.2026'];
console.log('Test dates (original order):', dates);

// Sorting with OLD approach (text sort)
const sortedTextually = [...dates].sort((a, b) => a.localeCompare(b));
console.log('\nSorted as TEXT (WRONG):    ', sortedTextually);
// Expected wrong output: lexicographic order by day first

// Sorting with NEW approach (date sort)
const sortedByDate = [...dates].sort((a, b) => {
    const baseFormat = getBaseFormatNew(dateColumn);
    if (baseFormat === 'DATE') {
        const dateA = parseDDMMYYYY(a);
        const dateB = parseDDMMYYYY(b);
        if (dateA && dateB) return dateA.getTime() - dateB.getTime();
    }
    return a.localeCompare(b);
});
console.log('Sorted as DATES (CORRECT): ', sortedByDate);

console.log('\n=== Verification ===');

const oldFormat = getBaseFormatOld(dateColumn);
const newFormat = getBaseFormatNew(dateColumn);

if (oldFormat !== 'DATE') {
    console.log(`✓ OLD behavior confirmed: type "323" mapped to "${oldFormat}" (not DATE) -> dates sorted as text`);
} else {
    console.log(`✗ OLD behavior unexpected: type "323" somehow mapped to "DATE"`);
}

if (newFormat === 'DATE') {
    console.log(`✓ NEW behavior correct: column.format "DATE" is now used directly -> dates sorted chronologically`);
} else {
    console.log(`✗ NEW behavior FAILED: expected "DATE", got "${newFormat}"`);
}

// Test with base type ID "9" (which is DATE in the map) - should still work
const columnWithBaseTypeId = { id: '100', type: '9', name: 'Some Date' };
const newFormatForBaseType = getBaseFormatNew(columnWithBaseTypeId);
console.log(`\n✓ Backward compatible: type "9" (no format field) -> "${newFormatForBaseType}" (should be DATE)`);

// Test that SHORT still works correctly
const shortColumn = { id: '200', type: '305', format: 'SHORT', name: 'Short text' };
const newFormatForShort = getBaseFormatNew(shortColumn);
console.log(`✓ Short column: type "305" with format "SHORT" -> "${newFormatForShort}" (should be SHORT)`);
