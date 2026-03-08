/**
 * Test: Issue #769 - escapeHtml('') gives undefined
 *
 * Tests different escapeHtml implementations to find which one
 * might return undefined for empty string or other edge cases.
 */

// Current forms.html implementation (DOM-based - simulated with regex for Node.js)
function escapeHtml_formsCurrent(str) {
    if (!str) return '';
    // In browser: uses document.createElement('div') + textContent + innerHTML
    // Simulated here with regex for Node.js testing
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// integram-table.js implementation (robust, already uses explicit null/undefined check)
function escapeHtml_integram(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&#039;');
}

// Fixed implementation for forms.html, cabinet.js, main-app.js
function escapeHtml_fixed(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&#039;');
}

const testCases = [
    { name: 'empty string', input: '' },
    { name: 'null', input: null },
    { name: 'undefined', input: undefined },
    { name: 'number 0', input: 0 },
    { name: 'number 42', input: 42 },
    { name: 'false', input: false },
    { name: 'hello', input: 'hello' },
    { name: 'xss script', input: '<script>alert(1)</script>' },
    { name: 'double quote', input: '"quoted"' },
    { name: 'single quote', input: "'single'" },
    { name: 'ampersand', input: '&amp;' },
];

console.log('=== escapeHtml Implementation Comparison (Issue #769) ===\n');
console.log('Test Case          | current result | integram result | fixed result | Diff?');
console.log('-'.repeat(85));

testCases.forEach(({ name, input }) => {
    const currentResult = escapeHtml_formsCurrent(input);
    const intgramResult = escapeHtml_integram(input);
    const fixedResult = escapeHtml_fixed(input);

    const nameStr = String(name).substring(0, 17);
    const current = String(currentResult);
    const integram = String(intgramResult);
    const fixed = String(fixedResult);

    const differs = current !== integram || current !== fixed;
    const diffFlag = differs ? '*** DIFF ***' : '';

    console.log(`${nameStr.padEnd(18)} | ${current.padEnd(14)} | ${integram.padEnd(15)} | ${fixed.padEnd(12)} | ${diffFlag}`);
});

console.log('\n=== Key Findings ===');
console.log('');
console.log('1. escapeHtml("") behavior:');
console.log('   - current (!str check): returns "" (empty string) - OK');
console.log('   - integram (null/undefined check): returns "" - OK');
console.log('   - fixed: returns "" - OK');
console.log('');
console.log('2. DIFFERENCE: The !str falsy check incorrectly handles:');
console.log('   - Number 0: !0 is true, so returns "" instead of "0"');
console.log('   - false: !false is true, so returns "" instead of "false"');
console.log('');
console.log('3. DOM-based approach (current forms.html) risks:');
console.log('   - Depends on document being available (fails in non-browser contexts)');
console.log('   - Could return undefined if innerHTML getter is unavailable');
console.log('');
console.log('4. Fix: Use regex-based approach with explicit null/undefined check');
console.log('   This is consistent with how integram-table.js already works.');
