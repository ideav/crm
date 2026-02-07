// Test script to verify date parsing functionality
// This tests the new YYYYMMDD format support alongside existing DD.MM.YYYY format

// Mock implementation of the date parsing methods
class DateParser {
    // Helper method to parse date format from API (supports both DD.MM.YYYY and YYYYMMDD)
    parseDDMMYYYY(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        const trimmed = dateStr.trim();

        // Try YYYYMMDD format first (exactly 8 digits)
        if (/^\d{8}$/.test(trimmed)) {
            const year = parseInt(trimmed.substring(0, 4), 10);
            const month = parseInt(trimmed.substring(4, 6), 10);
            const day = parseInt(trimmed.substring(6, 8), 10);

            if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

            // Validate month and day ranges
            if (month < 1 || month > 12 || day < 1 || day > 31) return null;

            // Month is 0-indexed in JavaScript Date
            return new Date(year, month - 1, day);
        }

        // Try DD.MM.YYYY format
        const parts = trimmed.split('.');
        if (parts.length !== 3) return null;
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const year = parseInt(parts[2], 10);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
        // Month is 0-indexed in JavaScript Date
        return new Date(year, month - 1, day);
    }

    // Helper method to parse YYYYMMDD date format from API
    parseYYYYMMDD(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        const trimmed = dateStr.trim();

        // Check if it matches YYYYMMDD format (exactly 8 digits)
        if (!/^\d{8}$/.test(trimmed)) return null;

        const year = parseInt(trimmed.substring(0, 4), 10);
        const month = parseInt(trimmed.substring(4, 6), 10);
        const day = parseInt(trimmed.substring(6, 8), 10);

        if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

        // Validate month and day ranges
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;

        // Month is 0-indexed in JavaScript Date
        return new Date(year, month - 1, day);
    }

    formatDateForInput(value, includeTime = false) {
        // Convert date from various formats to DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
        if (!value) return '';

        let date;
        // Try to parse DD.MM.YYYY format first
        date = this.parseDDMMYYYY(value);

        // If parsing failed, try YYYYMMDD format
        if (!date || isNaN(date.getTime())) {
            date = this.parseYYYYMMDD(value);
        }

        // If still failed, try standard Date constructor
        if (!date || isNaN(date.getTime())) {
            date = new Date(value);
            if (isNaN(date.getTime())) return value;  // Return as-is if not a valid date
        }

        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        if (includeTime) {
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            return `${ day }.${ month }.${ year } ${ hours }:${ minutes }:${ seconds }`;
        }

        return `${ day }.${ month }.${ year }`;
    }

    formatDateForHtml5(value, includeTime = false) {
        // Convert date to HTML5 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM
        if (!value) return '';

        let date;
        // Try to parse DD.MM.YYYY format first
        date = this.parseDDMMYYYY(value);

        // If parsing failed, try YYYYMMDD format
        if (!date || isNaN(date.getTime())) {
            date = this.parseYYYYMMDD(value);
        }

        // If still failed, try standard Date constructor
        if (!date || isNaN(date.getTime())) {
            date = new Date(value);
            if (isNaN(date.getTime())) return '';
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');

        if (includeTime) {
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${ year }-${ month }-${ day }T${ hours }:${ minutes }`;
        }

        return `${ year }-${ month }-${ day }`;
    }
}

// Test cases
const parser = new DateParser();

console.log('=== Testing parseYYYYMMDD ===');
const testCasesYYYYMMDD = [
    { input: '20260207', expected: new Date(2026, 1, 7) },
    { input: '19991231', expected: new Date(1999, 11, 31) },
    { input: '20000101', expected: new Date(2000, 0, 1) },
    { input: '2026020', expected: null }, // Too short
    { input: '202602077', expected: null }, // Too long
    { input: 'abcd1234', expected: null }, // Non-digits
    { input: '20261301', expected: null }, // Invalid month
    { input: '20260232', expected: null }, // Invalid day
];

testCasesYYYYMMDD.forEach(({ input, expected }) => {
    const result = parser.parseYYYYMMDD(input);
    const pass = expected === null ? result === null : result?.getTime() === expected?.getTime();
    console.log(`  ${pass ? '✓' : '✗'} parseYYYYMMDD("${input}") => ${result ? result.toISOString().split('T')[0] : 'null'} (expected: ${expected ? expected.toISOString().split('T')[0] : 'null'})`);
});

console.log('\n=== Testing parseDDMMYYYY (now with auto-detection) ===');
const testCasesDDMMYYYY = [
    // DD.MM.YYYY format tests
    { input: '07.02.2026', expected: new Date(2026, 1, 7) },
    { input: '31.12.1999', expected: new Date(1999, 11, 31) },
    { input: '01.01.2000', expected: new Date(2000, 0, 1) },
    { input: '7.2.2026', expected: new Date(2026, 1, 7) }, // Without leading zeros
    { input: '32.01.2026', expected: null }, // Invalid day (but will still parse as Date allows)
    { input: 'invalid', expected: null },
    // YYYYMMDD format tests (auto-detection)
    { input: '20260207', expected: new Date(2026, 1, 7) },
    { input: '19991231', expected: new Date(1999, 11, 31) },
    { input: '20000101', expected: new Date(2000, 0, 1) },
    { input: '2026020', expected: null }, // Too short
    { input: '202602077', expected: null }, // Too long
    { input: 'abcd1234', expected: null }, // Non-digits
    { input: '20261301', expected: null }, // Invalid month
    { input: '20260232', expected: null }, // Invalid day
];

testCasesDDMMYYYY.forEach(({ input, expected }) => {
    const result = parser.parseDDMMYYYY(input);
    const pass = expected === null ? result === null : result?.getTime() === expected?.getTime();
    console.log(`  ${pass ? '✓' : '✗'} parseDDMMYYYY("${input}") => ${result ? result.toISOString().split('T')[0] : 'null'} (expected: ${expected ? expected.toISOString().split('T')[0] : 'null'})`);
});

console.log('\n=== Testing formatDateForInput ===');
const testCasesFormatInput = [
    { input: '20260207', expected: '07.02.2026' },
    { input: '07.02.2026', expected: '07.02.2026' },
    { input: '19991231', expected: '31.12.1999' },
    { input: '31.12.1999', expected: '31.12.1999' },
];

testCasesFormatInput.forEach(({ input, expected }) => {
    const result = parser.formatDateForInput(input);
    const pass = result === expected;
    console.log(`  ${pass ? '✓' : '✗'} formatDateForInput("${input}") => "${result}" (expected: "${expected}")`);
});

console.log('\n=== Testing formatDateForHtml5 ===');
const testCasesFormatHtml5 = [
    { input: '20260207', expected: '2026-02-07' },
    { input: '07.02.2026', expected: '2026-02-07' },
    { input: '19991231', expected: '1999-12-31' },
    { input: '31.12.1999', expected: '1999-12-31' },
];

testCasesFormatHtml5.forEach(({ input, expected }) => {
    const result = parser.formatDateForHtml5(input);
    const pass = result === expected;
    console.log(`  ${pass ? '✓' : '✗'} formatDateForHtml5("${input}") => "${result}" (expected: "${expected}")`);
});

console.log('\n=== Summary ===');
console.log('All tests completed. Check results above for any failures.');
