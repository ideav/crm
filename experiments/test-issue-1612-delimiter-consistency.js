/**
 * Test for issue #1612: delimiter consistency validation
 * A delimiter is only used if it appears the same number of times in every
 * non-empty line. This prevents false splits when text contains commas or
 * semicolons as part of values.
 */

// Count occurrences of ch in str, ignoring escaped instances (preceded by \)
// (issue #1614: escaped delimiters like \, should not be counted)
const countChar = (str, ch) => {
    let count = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === ch && (i === 0 || str[i - 1] !== '\\')) {
            count++;
        }
    }
    return count;
};

function detectDelimiter(lines) {
    const isConsistentDelimiter = (delim) => {
        const counts = lines.map(l => countChar(l, delim));
        return counts[0] > 0 && counts.every(c => c === counts[0]);
    };
    if (isConsistentDelimiter('\t')) return '\t';
    if (isConsistentDelimiter(';')) return ';';
    if (isConsistentDelimiter(',')) return ',';
    return '\t'; // fallback: TAB (issue #1614)
}

function parseData(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    const delimiter = detectDelimiter(lines);
    return lines.map(l => l.split(delimiter).map(p => p.trim()));
}

let passed = 0;
let total = 0;

function test(label, text, expectedRows) {
    total++;
    const result = parseData(text);
    const ok = JSON.stringify(result) === JSON.stringify(expectedRows);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}`);
    if (!ok) {
        console.log(`  Expected: ${JSON.stringify(expectedRows)}`);
        console.log(`  Got:      ${JSON.stringify(result)}`);
    }
    if (ok) passed++;
}

// Basic cases from issue #1606
test('TAB delimiter (consistent)',
    'Alice\t30\tManager\nBob\t25\tDeveloper',
    [['Alice', '30', 'Manager'], ['Bob', '25', 'Developer']]
);

test('Semicolon delimiter (consistent)',
    'Alice;30;Manager\nBob;25;Developer',
    [['Alice', '30', 'Manager'], ['Bob', '25', 'Developer']]
);

test('Comma delimiter (consistent)',
    'Alice,30,Manager\nBob,25,Developer',
    [['Alice', '30', 'Manager'], ['Bob', '25', 'Developer']]
);

// Issue #1612: inconsistent comma count — detectDelimiter falls back to ','
// but the real protection is that the user sees misaligned data and can choose
// another format; the key test is that isConsistentDelimiter returns false.
// We verify detectDelimiter returns ',' (the fallback) when no delimiter is consistent.
(function() {
    total++;
    const lines = ['Alice,30,Manager', 'Jane Smith "Engineer, LLC",25,Developer'];
    // 2 commas vs 3 commas — comma is NOT consistent, semicolon=0, tab=0
    // detectDelimiter should fall back to ','
    const delim = detectDelimiter(lines);
    const ok = delim === '\t';
    console.log(`[${ok ? 'PASS' : 'FAIL'}] Comma inconsistent: detectDelimiter falls back to TAB (got: ${JSON.stringify(delim)})`);
    if (ok) passed++;
})();

// Explicit delimiter consistency check
(function() {
    total++;
    const lines = ['Alice,30,Manager', 'Jane Smith "Engineer, LLC",25,Developer'];
    // line 1: 2 commas, line 2: 3 commas → inconsistent
    const countsComma = lines.map(l => countChar(l, ','));
    const isConsistent = countsComma[0] > 0 && countsComma.every(c => c === countsComma[0]);
    const ok = !isConsistent; // should NOT be consistent
    console.log(`[${ok ? 'PASS' : 'FAIL'}] Comma with text commas is NOT a consistent delimiter (counts: ${countsComma})`);
    if (ok) passed++;
})();

// Semicolon inconsistent — should not be used as delimiter
(function() {
    total++;
    const lines = ['Alice;30;Manager', 'Jane;Smith "Engineer; LLC";25;Developer'];
    // line 1: 2 semicolons, line 2: 3 semicolons → inconsistent
    const countsSemi = lines.map(l => countChar(l, ';'));
    const isConsistent = countsSemi[0] > 0 && countsSemi.every(c => c === countsSemi[0]);
    const ok = !isConsistent;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] Semicolon with text semicolons is NOT a consistent delimiter (counts: ${countsSemi})`);
    if (ok) passed++;
})();

// When TAB is consistent, prefer TAB even if semicolons also appear
test('TAB preferred over semicolon when TAB is consistent',
    'Alice\t30;extra\tManager\nBob\t25;foo\tDeveloper',
    [['Alice', '30;extra', 'Manager'], ['Bob', '25;foo', 'Developer']]
);

// Single-line data — comma should work as fallback
test('Single line comma',
    'Alice,30,Manager',
    [['Alice', '30', 'Manager']]
);

// Empty lines are ignored
test('Empty lines ignored',
    'Alice,30,Manager\n\nBob,25,Developer\n',
    [['Alice', '30', 'Manager'], ['Bob', '25', 'Developer']]
);

console.log(`\n${passed}/${total} tests passed`);
