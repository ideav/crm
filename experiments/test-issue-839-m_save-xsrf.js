/**
 * Test script for issue #839 - _m_edit -> _m_save fix with XSRF token
 *
 * This test verifies that:
 * 1. The saveEditedRecord function uses _m_save endpoint instead of _m_edit
 * 2. The XSRF token is added to both FormData and URLSearchParams requests
 */

const fs = require('fs');
const path = require('path');

// Read the integram-table.js file
const filePath = path.join(__dirname, '..', 'js', 'integram-table.js');
const content = fs.readFileSync(filePath, 'utf8');

// Test 1: Verify _m_save is used instead of _m_edit in saveEditedRecord
const saveEditedRecordMatch = content.match(/async saveEditedRecord[\s\S]*?^\s{4}\}/m);
if (!saveEditedRecordMatch) {
    console.error('FAIL: Could not find saveEditedRecord function');
    process.exit(1);
}

const saveEditedRecordContent = saveEditedRecordMatch[0];

// Check that _m_edit is NOT used
if (saveEditedRecordContent.includes('_m_edit')) {
    console.error('FAIL: saveEditedRecord still uses _m_edit endpoint');
    process.exit(1);
}
console.log('PASS: _m_edit is not used in saveEditedRecord');

// Check that _m_save IS used
if (!saveEditedRecordContent.includes('_m_save')) {
    console.error('FAIL: saveEditedRecord does not use _m_save endpoint');
    process.exit(1);
}
console.log('PASS: _m_save is used in saveEditedRecord');

// Test 2: Verify XSRF token is added for FormData (file uploads)
const xsrfFormDataPattern = /if\s*\(\s*hasFiles\s*\)\s*\{[\s\S]*?_xsrf/;
if (!xsrfFormDataPattern.test(saveEditedRecordContent)) {
    console.error('FAIL: XSRF token is not added for FormData (file uploads)');
    process.exit(1);
}
console.log('PASS: XSRF token is added for FormData (file uploads)');

// Test 3: Verify XSRF token is added for URLSearchParams (non-file submissions)
const xsrfParamsPattern = /const params = new URLSearchParams[\s\S]*?_xsrf/;
if (!xsrfParamsPattern.test(saveEditedRecordContent)) {
    console.error('FAIL: XSRF token is not added for URLSearchParams');
    process.exit(1);
}
console.log('PASS: XSRF token is added for URLSearchParams');

// Test 4: Verify the pattern matches the existing convention (typeof xsrf !== 'undefined')
const xsrfCheckPattern = /typeof xsrf !== 'undefined'/g;
const xsrfChecks = saveEditedRecordContent.match(xsrfCheckPattern);
if (!xsrfChecks || xsrfChecks.length < 2) {
    console.error('FAIL: Expected at least 2 XSRF checks (for FormData and URLSearchParams)');
    process.exit(1);
}
console.log(`PASS: Found ${xsrfChecks.length} XSRF checks in saveEditedRecord`);

console.log('\n=== All tests passed! ===');
console.log('Issue #839 fix verified:');
console.log('  - Changed _m_edit to _m_save endpoint');
console.log('  - Added XSRF token for file uploads (FormData)');
console.log('  - Added XSRF token for non-file submissions (URLSearchParams)');
