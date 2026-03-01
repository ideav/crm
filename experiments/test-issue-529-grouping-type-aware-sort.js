/**
 * Test script for issue #529: Type-aware sorting in grouped columns
 *
 * When sorting records by groupable fields, the base type of the groupable column
 * should be considered: dates should be compared as dates, numbers as numbers.
 * The base type is known from the `type` key of the first column and its requisites.
 */

// Helper functions that mirror the implementation
function parseDDMMYYYY(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const trimmed = dateStr.trim();

    // Try YYYYMMDD format first (exactly 8 digits)
    if (/^\d{8}$/.test(trimmed)) {
        const year = parseInt(trimmed.substring(0, 4), 10);
        const month = parseInt(trimmed.substring(4, 6), 10);
        const day = parseInt(trimmed.substring(6, 8), 10);

        if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        return new Date(year, month - 1, day);
    }

    // Try DD.MM.YYYY format
    const parts = trimmed.split('.');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    return new Date(year, month - 1, day);
}

function normalizeFormat(baseTypeId) {
    const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                          'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                          'GRANT', 'REPORT_COLUMN', 'PATH'];

    const upperTypeId = String(baseTypeId).toUpperCase();

    if (validFormats.includes(upperTypeId)) {
        return upperTypeId;
    }

    // Numeric ID mapping
    const formatMap = {
        '0': 'SHORT',
        '1': 'CHARS',
        '2': 'DATE',
        '3': 'NUMBER',
        '4': 'SIGNED',
        '6': 'BOOLEAN',
        '7': 'MEMO',
        '8': 'DATETIME',
        '9': 'FILE',
        '10': 'HTML',
        '11': 'BUTTON',
        '13': 'PWD',
        '5': 'GRANT',
        '16': 'REPORT_COLUMN',
        '17': 'PATH'
    };
    return formatMap[String(baseTypeId)] || 'SHORT';
}

// Type-aware comparison function (Issue #529)
function compareGroupingValues(valA, valB, column, getDisplayValue) {
    // Handle null/undefined/empty
    const aEmpty = valA === null || valA === undefined || valA === '';
    const bEmpty = valB === null || valB === undefined || valB === '';

    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;  // Empty values go to end
    if (bEmpty) return -1;

    // Get the base type of the column
    const baseFormat = normalizeFormat(column.type);

    // For reference values (id:label format), extract the label for comparison
    let displayA = getDisplayValue(valA, column);
    let displayB = getDisplayValue(valB, column);

    switch (baseFormat) {
        case 'NUMBER':
        case 'SIGNED':
            const numA = parseFloat(displayA);
            const numB = parseFloat(displayB);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }
            break;
        case 'DATE':
            const dateA = parseDDMMYYYY(String(displayA));
            const dateB = parseDDMMYYYY(String(displayB));
            if (dateA && dateB) {
                return dateA.getTime() - dateB.getTime();
            }
            break;
        case 'BOOLEAN':
            const boolA = displayA !== null && displayA !== undefined && displayA !== '' && displayA !== 0 && displayA !== '0' && displayA !== false;
            const boolB = displayB !== null && displayB !== undefined && displayB !== '' && displayB !== 0 && displayB !== '0' && displayB !== false;
            return (boolA === boolB) ? 0 : (boolA ? -1 : 1);
    }

    // Default: string comparison (case-insensitive)
    return String(displayA).toLowerCase().localeCompare(String(displayB).toLowerCase(), 'ru');
}

// Simple display value extractor (no reference parsing for these tests)
function getDisplayValue(value, column) {
    return value;
}

// Old string-based comparison (before issue #529)
function compareGroupingValuesOld(valA, valB, column, getDisplayValue) {
    const strA = getDisplayValue(valA, column).toString().toLowerCase();
    const strB = getDisplayValue(valB, column).toString().toLowerCase();

    if (strA < strB) return -1;
    if (strA > strB) return 1;
    return 0;
}

// =====================
// TEST CASES
// =====================

console.log('=== Issue #529: Type-aware sorting in grouped columns ===\n');

// Test 1: Number sorting
console.log('Test 1: NUMBER type column sorting');
const numberColumn = { id: '0', name: 'Количество', type: 'NUMBER' };
const numberData = ['10', '2', '100', '20', '1', '3'];

// Old behavior (string sort): "1", "10", "100", "2", "20", "3"
const oldNumberSort = [...numberData].sort((a, b) =>
    compareGroupingValuesOld(a, b, numberColumn, getDisplayValue)
);
console.log('  Old (string) sort:', oldNumberSort.join(', '));

// New behavior (numeric sort): "1", "2", "3", "10", "20", "100"
const newNumberSort = [...numberData].sort((a, b) =>
    compareGroupingValues(a, b, numberColumn, getDisplayValue)
);
console.log('  New (numeric) sort:', newNumberSort.join(', '));

const expectedNumberSort = ['1', '2', '3', '10', '20', '100'];
const numberTestPassed = JSON.stringify(newNumberSort) === JSON.stringify(expectedNumberSort);
console.log('  Expected:', expectedNumberSort.join(', '));
console.log('  Test:', numberTestPassed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 2: Date sorting (DD.MM.YYYY format)
console.log('Test 2: DATE type column sorting (DD.MM.YYYY format)');
const dateColumn = { id: '0', name: 'Дата', type: 'DATE' };
const dateData = ['15.01.2024', '01.12.2023', '10.06.2024', '05.03.2023', '20.01.2024'];

// Old behavior (string sort): lexicographic by string
const oldDateSort = [...dateData].sort((a, b) =>
    compareGroupingValuesOld(a, b, dateColumn, getDisplayValue)
);
console.log('  Old (string) sort:', oldDateSort.join(', '));

// New behavior (date sort): chronological order
const newDateSort = [...dateData].sort((a, b) =>
    compareGroupingValues(a, b, dateColumn, getDisplayValue)
);
console.log('  New (date) sort:', newDateSort.join(', '));

const expectedDateSort = ['05.03.2023', '01.12.2023', '15.01.2024', '20.01.2024', '10.06.2024'];
const dateTestPassed = JSON.stringify(newDateSort) === JSON.stringify(expectedDateSort);
console.log('  Expected:', expectedDateSort.join(', '));
console.log('  Test:', dateTestPassed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 3: Date sorting (YYYYMMDD format)
console.log('Test 3: DATE type column sorting (YYYYMMDD format)');
const dateData2 = ['20240115', '20231201', '20240610', '20230305', '20240120'];

const newDateSort2 = [...dateData2].sort((a, b) =>
    compareGroupingValues(a, b, dateColumn, getDisplayValue)
);
console.log('  New (date) sort:', newDateSort2.join(', '));

const expectedDateSort2 = ['20230305', '20231201', '20240115', '20240120', '20240610'];
const dateTest2Passed = JSON.stringify(newDateSort2) === JSON.stringify(expectedDateSort2);
console.log('  Expected:', expectedDateSort2.join(', '));
console.log('  Test:', dateTest2Passed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 4: SIGNED (negative numbers) sorting
console.log('Test 4: SIGNED type column sorting (with negative numbers)');
const signedColumn = { id: '0', name: 'Баланс', type: 'SIGNED' };
const signedData = ['-10', '5', '-200', '100', '0', '-5'];

const oldSignedSort = [...signedData].sort((a, b) =>
    compareGroupingValuesOld(a, b, signedColumn, getDisplayValue)
);
console.log('  Old (string) sort:', oldSignedSort.join(', '));

const newSignedSort = [...signedData].sort((a, b) =>
    compareGroupingValues(a, b, signedColumn, getDisplayValue)
);
console.log('  New (numeric) sort:', newSignedSort.join(', '));

const expectedSignedSort = ['-200', '-10', '-5', '0', '5', '100'];
const signedTestPassed = JSON.stringify(newSignedSort) === JSON.stringify(expectedSignedSort);
console.log('  Expected:', expectedSignedSort.join(', '));
console.log('  Test:', signedTestPassed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 5: Empty values handling
console.log('Test 5: Empty values should go to end');
const mixedColumn = { id: '0', name: 'Цена', type: 'NUMBER' };
const mixedData = ['10', '', null, '5', undefined, '20'];

const newMixedSort = [...mixedData].sort((a, b) =>
    compareGroupingValues(a, b, mixedColumn, getDisplayValue)
);
console.log('  Sorted:', newMixedSort.map(v => v === null ? 'null' : v === undefined ? 'undefined' : v === '' ? '""' : v).join(', '));
console.log('  Empty values at end:', (newMixedSort[3] === '' && newMixedSort[4] === null && newMixedSort[5] === undefined) ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 6: String type (default) keeps string comparison
console.log('Test 6: SHORT type column (default string comparison)');
const stringColumn = { id: '0', name: 'Имя', type: 'SHORT' };
const stringData = ['Банан', 'Яблоко', 'Апельсин', 'Груша'];

const newStringSort = [...stringData].sort((a, b) =>
    compareGroupingValues(a, b, stringColumn, getDisplayValue)
);
console.log('  Sorted:', newStringSort.join(', '));

const expectedStringSort = ['Апельсин', 'Банан', 'Груша', 'Яблоко'];
const stringTestPassed = JSON.stringify(newStringSort) === JSON.stringify(expectedStringSort);
console.log('  Expected:', expectedStringSort.join(', '));
console.log('  Test:', stringTestPassed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 7: Numeric type ID (e.g., type: '3' for NUMBER)
console.log('Test 7: Numeric type ID ("3" = NUMBER)');
const numericTypeIdColumn = { id: '0', name: 'Количество', type: '3' };
const numericTypeIdData = ['10', '2', '100', '20', '1'];

const newNumericTypeIdSort = [...numericTypeIdData].sort((a, b) =>
    compareGroupingValues(a, b, numericTypeIdColumn, getDisplayValue)
);
console.log('  Sorted:', newNumericTypeIdSort.join(', '));

const expectedNumericTypeIdSort = ['1', '2', '10', '20', '100'];
const numericTypeIdTestPassed = JSON.stringify(newNumericTypeIdSort) === JSON.stringify(expectedNumericTypeIdSort);
console.log('  Expected:', expectedNumericTypeIdSort.join(', '));
console.log('  Test:', numericTypeIdTestPassed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Test 8: Date type ID ("2" = DATE)
console.log('Test 8: Numeric type ID ("2" = DATE)');
const dateTypeIdColumn = { id: '0', name: 'Дата', type: '2' };
const dateTypeIdData = ['15.01.2024', '01.12.2023', '10.06.2024'];

const newDateTypeIdSort = [...dateTypeIdData].sort((a, b) =>
    compareGroupingValues(a, b, dateTypeIdColumn, getDisplayValue)
);
console.log('  Sorted:', newDateTypeIdSort.join(', '));

const expectedDateTypeIdSort = ['01.12.2023', '15.01.2024', '10.06.2024'];
const dateTypeIdTestPassed = JSON.stringify(newDateTypeIdSort) === JSON.stringify(expectedDateTypeIdSort);
console.log('  Expected:', expectedDateTypeIdSort.join(', '));
console.log('  Test:', dateTypeIdTestPassed ? 'PASSED ✓' : 'FAILED ✗');
console.log('');

// Summary
console.log('=== Test Summary ===');
const allPassed = numberTestPassed && dateTestPassed && dateTest2Passed && signedTestPassed && stringTestPassed && numericTypeIdTestPassed && dateTypeIdTestPassed;
console.log('Number sorting:', numberTestPassed ? 'PASSED' : 'FAILED');
console.log('Date sorting (DD.MM.YYYY):', dateTestPassed ? 'PASSED' : 'FAILED');
console.log('Date sorting (YYYYMMDD):', dateTest2Passed ? 'PASSED' : 'FAILED');
console.log('Signed number sorting:', signedTestPassed ? 'PASSED' : 'FAILED');
console.log('String sorting:', stringTestPassed ? 'PASSED' : 'FAILED');
console.log('Numeric type ID (NUMBER):', numericTypeIdTestPassed ? 'PASSED' : 'FAILED');
console.log('Numeric type ID (DATE):', dateTypeIdTestPassed ? 'PASSED' : 'FAILED');
console.log('');
console.log('Overall:', allPassed ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗');

if (!allPassed) {
    process.exit(1);
}
