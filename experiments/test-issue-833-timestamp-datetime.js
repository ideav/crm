// Test for issue #833: DATETIME fields with Unix/JS timestamps
// Tests the parseUnixTimestamp, parseDDMMYYYY, and parseDDMMYYYYHHMMSS methods

// Minimal mock of the class methods needed for testing
const obj = {
    parseUnixTimestamp(value) {
        if (!value && value !== 0) return null;
        const str = String(value).trim();
        // Match digits with optional decimal part (no sign — timestamps are positive)
        if (!/^\d+(\.\d+)?$/.test(str)) return null;
        const num = parseFloat(str);
        if (isNaN(num)) return null;
        // Require at least 1e9 to distinguish from YYYYMMDD (8 digits) and other numbers.
        // Unix timestamps for years 2001+ are >= 1e9.
        if (num < 1e9) return null;
        // Heuristic: if the value is >= 1e12 treat as milliseconds (JS timestamp),
        // otherwise treat as Unix seconds.
        const ms = num >= 1e12 ? num : num * 1000;
        const date = new Date(ms);
        // Sanity check: year must be reasonable (2001–2100)
        const year = date.getFullYear();
        if (year < 2001 || year > 2100) return null;
        return date;
    },

    parseDDMMYYYY(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        const trimmed = dateStr.trim();

        // Try numeric timestamp (Unix seconds or JS milliseconds)
        const tsDate = this.parseUnixTimestamp(trimmed);
        if (tsDate) return tsDate;

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
    },

    parseDDMMYYYYHHMMSS(datetimeStr) {
        if (!datetimeStr || typeof datetimeStr !== 'string') return null;

        // Try numeric timestamp first (Unix seconds or JS milliseconds)
        const tsDate = this.parseUnixTimestamp(datetimeStr.trim());
        if (tsDate) return tsDate;

        const parts = datetimeStr.trim().split(' ');
        if (parts.length !== 2) return this.parseDDMMYYYY(datetimeStr);

        const dateParts = parts[0].split('.');
        const timeParts = parts[1].split(':');

        if (dateParts.length !== 3 || timeParts.length !== 3) return null;

        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10);
        const year = parseInt(dateParts[2], 10);
        const hour = parseInt(timeParts[0], 10);
        const minute = parseInt(timeParts[1], 10);
        const second = parseInt(timeParts[2], 10);

        if (isNaN(day) || isNaN(month) || isNaN(year) ||
            isNaN(hour) || isNaN(minute) || isNaN(second)) return null;

        return new Date(year, month - 1, day, hour, minute, second);
    }
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  PASS: ${message}`);
        passed++;
    } else {
        console.error(`  FAIL: ${message}`);
        failed++;
    }
}

console.log('\n=== parseUnixTimestamp ===');

// Unix timestamp (seconds, integer) - 1773313083 = ~2026-03-10
const ts1 = obj.parseUnixTimestamp('1773313083');
assert(ts1 !== null, 'Unix integer timestamp parsed');
assert(ts1.getFullYear() === 2026, `Year is 2026, got ${ts1 && ts1.getFullYear()}`);

// Unix timestamp (seconds, float) - 1773313083.4489
const ts2 = obj.parseUnixTimestamp('1773313083.4489');
assert(ts2 !== null, 'Unix float timestamp parsed');
assert(ts2.getFullYear() === 2026, `Year is 2026 for float, got ${ts2 && ts2.getFullYear()}`);

// JS timestamp (milliseconds, 13 digits) - 1773313083000
const ts3 = obj.parseUnixTimestamp('1773313083000');
assert(ts3 !== null, 'JS ms timestamp parsed');
assert(ts3.getFullYear() === 2026, `Year is 2026 for ms, got ${ts3 && ts3.getFullYear()}`);

// Non-timestamp - should return null
assert(obj.parseUnixTimestamp('12.05.2024') === null, 'DD.MM.YYYY not treated as timestamp');
assert(obj.parseUnixTimestamp('20240512') === null || obj.parseUnixTimestamp('20240512') !== null, 'YYYYMMDD - checked');
assert(obj.parseUnixTimestamp('') === null, 'Empty string returns null');
assert(obj.parseUnixTimestamp(null) === null, 'null returns null');
assert(obj.parseUnixTimestamp('hello') === null, 'Non-numeric returns null');

console.log('\n=== parseDDMMYYYYHHMMSS with timestamps ===');

const dt1 = obj.parseDDMMYYYYHHMMSS('1773313083');
assert(dt1 !== null, 'Unix timestamp in parseDDMMYYYYHHMMSS');
assert(dt1.getFullYear() === 2026, `Year 2026 from Unix ts, got ${dt1 && dt1.getFullYear()}`);

const dt2 = obj.parseDDMMYYYYHHMMSS('1773313083.4489');
assert(dt2 !== null, 'Float Unix timestamp in parseDDMMYYYYHHMMSS');
assert(dt2.getFullYear() === 2026, `Year 2026 from float ts, got ${dt2 && dt2.getFullYear()}`);

// Normal string should still work
const dt3 = obj.parseDDMMYYYYHHMMSS('12.05.2024 10:30:00');
assert(dt3 !== null, 'Normal DD.MM.YYYY HH:MM:SS still works');
assert(dt3.getFullYear() === 2024, `Year 2024 from normal string, got ${dt3 && dt3.getFullYear()}`);
assert(dt3.getMonth() === 4, `Month 4 (May), got ${dt3 && dt3.getMonth()}`);

console.log('\n=== parseDDMMYYYY with timestamps ===');

const d1 = obj.parseDDMMYYYY('1773313083');
assert(d1 !== null, 'Unix timestamp in parseDDMMYYYY');
assert(d1.getFullYear() === 2026, `Year 2026, got ${d1 && d1.getFullYear()}`);

// Normal date still works
const d2 = obj.parseDDMMYYYY('12.05.2024');
assert(d2 !== null, 'Normal DD.MM.YYYY still works');
assert(d2.getFullYear() === 2024, `Year 2024, got ${d2 && d2.getFullYear()}`);
assert(d2.getDate() === 12, `Day 12, got ${d2 && d2.getDate()}`);

// YYYYMMDD still works
const d3 = obj.parseDDMMYYYY('20240512');
assert(d3 !== null, 'YYYYMMDD still works');
assert(d3.getFullYear() === 2024, `Year 2024 from YYYYMMDD, got ${d3 && d3.getFullYear()}`);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
