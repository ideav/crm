/**
 * Test for issue #1606: paste data parsing logic
 * Verifies that lines are split correctly by TAB, ";", or ","
 */

function parseLine(line) {
    let parts;
    if (line.includes('\t')) {
        parts = line.split('\t');
    } else if (line.includes(';')) {
        parts = line.split(';');
    } else {
        parts = line.split(',');
    }
    return parts.map(p => p.trim()).filter(p => p !== '');
}

const tests = [
    { input: 'Alice\t30\tManager', expected: ['Alice', '30', 'Manager'], delim: 'TAB' },
    { input: 'Bob;25;Developer', expected: ['Bob', '25', 'Developer'], delim: ';' },
    { input: 'Carol,35,Designer', expected: ['Carol', '35', 'Designer'], delim: ',' },
    { input: 'SingleValue', expected: ['SingleValue'], delim: 'none' },
    { input: '  Alice  \t  30  ', expected: ['Alice', '30'], delim: 'TAB with spaces' },
];

let passed = 0;
for (const t of tests) {
    const result = parseLine(t.input);
    const ok = JSON.stringify(result) === JSON.stringify(t.expected);
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${t.delim}: ${JSON.stringify(result)} (expected ${JSON.stringify(t.expected)})`);
    if (ok) passed++;
}

// Test multi-line splitting
const multiLine = 'Alice\t30\tManager\nBob;25;Developer\n\nCarol,35,Designer';
const lines = multiLine.split(/\r?\n/).filter(l => l.trim() !== '');
console.log(`\nMulti-line split: ${lines.length} lines (expected 3): ${lines.length === 3 ? 'PASS' : 'FAIL'}`);
if (lines.length === 3) passed++;

console.log(`\n${passed}/${tests.length + 1} tests passed`);
