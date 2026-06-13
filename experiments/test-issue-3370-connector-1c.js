/**
 * Test: Issue #3370 — Universal 1C connector workplace
 *
 * Loads the REAL pure functions from templates/connector-1c.html (by running
 * its IIFE in a sandbox where the DOM block early-returns) and asserts the
 * type-mapping and entity-classification logic that backs the connector.
 *
 * parseMetadata's XML/DOM logic is verified separately in a browser
 * (experiments/connector-1c-harness.html via Playwright), since it needs a
 * real DOMParser not present in plain Node.
 *
 * Run: node experiments/test-issue-3370-connector-1c.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'templates', 'connector-1c.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) { console.error('FAIL: <script> block not found in connector-1c.html'); process.exit(1); }

// Sandbox: document.getElementById returns null so the DOM-logic block bails out,
// leaving only the pure functions registered on `window.Connector1C`.
const sandbox = {
    window: {},
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

const C = sandbox.window.Connector1C;
if (!C) { console.error('FAIL: window.Connector1C not exported'); process.exit(1); }

let passed = 0, failed = 0;
function eq(actual, expected, label) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { passed++; console.log(`  ✓ ${label}`); }
    else { failed++; console.log(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`); }
}

console.log('=== mapType (Edm.* → Integram type/code) ===');
eq(C.mapType('Edm.Boolean'), { code: 11, name: 'BOOLEAN' }, 'Boolean → BOOLEAN(11)');
eq(C.mapType('Edm.Int32'), { code: 13, name: 'NUMBER' }, 'Int32 → NUMBER(13)');
eq(C.mapType('Edm.Int64'), { code: 13, name: 'NUMBER' }, 'Int64 → NUMBER(13)');
eq(C.mapType('Edm.Double'), { code: 14, name: 'SIGNED' }, 'Double → SIGNED(14)');
eq(C.mapType('Edm.Decimal'), { code: 14, name: 'SIGNED' }, 'Decimal → SIGNED(14)');
eq(C.mapType('Edm.Date'), { code: 9, name: 'DATE' }, 'Date → DATE(9)');
eq(C.mapType('Edm.DateTimeOffset'), { code: 4, name: 'DATETIME' }, 'DateTimeOffset → DATETIME(4)');
eq(C.mapType('Edm.Binary'), { code: 10, name: 'FILE' }, 'Binary → FILE(10)');
eq(C.mapType('Edm.Guid'), { code: 3, name: 'SHORT' }, 'Guid → SHORT(3)');
eq(C.mapType('Edm.String'), { code: 8, name: 'CHARS' }, 'String (no MaxLength) → CHARS(8)');
eq(C.mapType('Edm.String', '300'), { code: 8, name: 'CHARS' }, 'String MaxLength>127 → CHARS(8)');
eq(C.mapType('Edm.String', '25'), { code: 3, name: 'SHORT' }, 'String MaxLength<=127 → SHORT(3)');
eq(C.mapType('Edm.Whatever'), { code: 8, name: 'CHARS' }, 'unknown → CHARS(8) fallback');

console.log('=== classifyEntity (prefix → human type) ===');
eq(C.classifyEntity('Catalog_Номенклатура'), 'Справочник', 'Catalog_ → Справочник');
eq(C.classifyEntity('Document_ЗаказКлиента'), 'Документ', 'Document_ → Документ');
eq(C.classifyEntity('InformationRegister_КурсыВалют'), 'Регистр сведений', 'InformationRegister_ → Регистр сведений');
eq(C.classifyEntity('AccumulationRegister_Остатки'), 'Регистр накопления', 'AccumulationRegister_ → Регистр накопления');
eq(C.classifyEntity('Constant_ВалютаУчёта'), 'Константа', 'Constant_ → Константа');
eq(C.classifyEntity('SomethingElse'), 'Прочее', 'unknown prefix → Прочее');

console.log('=== extractSynonym (drop OData prefix) ===');
eq(C.extractSynonym('Catalog_Номенклатура'), 'Номенклатура', 'Catalog_Номенклатура → Номенклатура');
eq(C.extractSynonym('NoPrefix'), 'NoPrefix', 'no underscore → unchanged');

console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
