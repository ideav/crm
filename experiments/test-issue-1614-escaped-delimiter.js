/**
 * Test for issue #1614: escaped delimiters should not be counted,
 * and fallback delimiter should be TAB (not comma).
 *
 * Issue description:
 *   1. Escaped values like \, should not be counted as delimiter occurrences
 *   2. Default fallback should be TAB, not comma
 */

// ---- Current (BUGGY) implementation from PR #1613 ----
const countCharBuggy = (str, ch) => str.split(ch).length - 1;

function detectDelimiterBuggy(lines) {
    const isConsistentDelimiter = (delim) => {
        const counts = lines.map(l => countCharBuggy(l, delim));
        return counts[0] > 0 && counts.every(c => c === counts[0]);
    };
    if (isConsistentDelimiter('\t')) return '\t';
    if (isConsistentDelimiter(';')) return ';';
    if (isConsistentDelimiter(',')) return ',';
    return ','; // BUGGY: fallback should be TAB
}

// ---- Fixed implementation ----
// Count occurrences of ch in str, ignoring escaped instances (preceded by \)
const countCharFixed = (str, ch) => {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === ch && (i === 0 || str[i - 1] !== '\\')) {
            count++;
        }
    }
    return count;
};

function detectDelimiterFixed(lines) {
    const isConsistentDelimiter = (delim) => {
        const counts = lines.map(l => countCharFixed(l, delim));
        return counts[0] > 0 && counts.every(c => c === counts[0]);
    };
    if (isConsistentDelimiter('\t')) return '\t';
    if (isConsistentDelimiter(';')) return ';';
    if (isConsistentDelimiter(',')) return ',';
    return '\t'; // FIXED: fallback is TAB
}

let passed = 0;
let failed = 0;

function test(label, actual, expected) {
    const ok = actual === expected;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
    if (!ok) {
        console.log(`  Expected: ${JSON.stringify(expected)}`);
        console.log(`  Got:      ${JSON.stringify(actual)}`);
    }
    if (ok) passed++; else failed++;
}

// ---- Tests for BUG 1: escaped commas counted as delimiter ----
// Text: "Alice\,30\,Manager\nBob\,25\,Developer"
// The \, are escaped — they should NOT be treated as commas
// The buggy impl counts them as commas (3 per line → consistent!) and uses ','
// The fixed impl ignores \, so comma count = 0, falls back to TAB
const escapedCommaLines = ['Alice\\,30\\,Manager', 'Bob\\,25\\,Developer'];

console.log('\n--- Bug 1: escaped commas should not be counted as delimiter ---');
test(
    'BUGGY: escaped commas wrongly detected as consistent delimiter',
    detectDelimiterBuggy(escapedCommaLines),
    ',' // buggy: returns comma because \, is counted
);
test(
    'FIXED: escaped commas NOT counted, falls back to TAB',
    detectDelimiterFixed(escapedCommaLines),
    '\t' // fixed: \, not counted, no consistent delimiter found, TAB fallback
);

// Mix: some real commas + escaped commas
// "name\,with\,escapes,value1" — the real comma separates cols, \, are in values
const mixedLines = ['name\\,with\\,escapes,value1', 'other\\,name,value2'];
// Each line has 1 real comma (the separator) → consistent!
console.log('\n--- Mixed: real commas + escaped commas ---');
test(
    'BUGGY: counts all commas (escaped + real) → 3 vs 2 → inconsistent → falls back to comma',
    detectDelimiterBuggy(mixedLines),
    ',' // line1: 3 commas total (2 escaped + 1 real), line2: 2 commas total → inconsistent → fallback ','
);
test(
    'FIXED: only counts real commas (1 per line) → consistent → uses comma',
    detectDelimiterFixed(mixedLines),
    ',' // line1: 1 real comma, line2: 1 real comma → consistent!
);

// ---- Tests for BUG 2: fallback should be TAB, not comma ----
// Single-column data (no delimiter at all) → should fall back to TAB
const noDelimLines = ['Alice Smith', 'Bob Jones'];
console.log('\n--- Bug 2: default fallback should be TAB ---');
test(
    'BUGGY: no delimiter found → fallback is comma (wrong)',
    detectDelimiterBuggy(noDelimLines),
    ',' // buggy fallback
);
test(
    'FIXED: no delimiter found → fallback is TAB (correct)',
    detectDelimiterFixed(noDelimLines),
    '\t' // fixed fallback
);

// ---- Regression tests: existing behavior must still work ----
console.log('\n--- Regression: existing delimiter detection ---');

test('TAB consistent → TAB',
    detectDelimiterFixed(['Alice\t30\tManager', 'Bob\t25\tDeveloper']),
    '\t'
);
test('Semicolon consistent → semicolon',
    detectDelimiterFixed(['Alice;30;Manager', 'Bob;25;Developer']),
    ';'
);
test('Comma consistent (no escapes) → comma',
    detectDelimiterFixed(['Alice,30,Manager', 'Bob,25,Developer']),
    ','
);
test('Comma inconsistent (text contains extra commas) → TAB fallback',
    detectDelimiterFixed(['Alice,30,Manager', 'Jane Smith "Engineer, LLC",25,Developer']),
    '\t' // CHANGED from comma to TAB fallback
);
test('TAB preferred over semicolon',
    detectDelimiterFixed(['Alice\t30;extra\tManager', 'Bob\t25;foo\tDeveloper']),
    '\t'
);

// ---- Escaped semicolons ----
console.log('\n--- Escaped semicolons ---');
const escapedSemiLines = ['Alice\\;30\\;Manager', 'Bob\\;25\\;Developer'];
test(
    'FIXED: escaped semicolons not counted → TAB fallback',
    detectDelimiterFixed(escapedSemiLines),
    '\t'
);

// ---- Escaped TABs (edge case) ----
// A literal backslash followed by t is not the same as a real tab char
// Real tab is \t (0x09), escaped form \\\t would be backslash+tab
// This is an unusual edge case; skip for now

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
