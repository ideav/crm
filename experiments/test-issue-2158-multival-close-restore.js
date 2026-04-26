/**
 * Test for issue #2158: When multiple values found and user clicks "Закрыть",
 * the cell should revert to the original value, not keep the new (unsaved) value.
 */

const fs = require('fs');
const path = require('path');

const dashHtml = fs.readFileSync(path.join(__dirname, '../templates/dash.html'), 'utf8');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) {
        console.log('PASS:', msg);
        passed++;
    } else {
        console.error('FAIL:', msg);
        failed++;
    }
}

// Test 1: dashShowMultivalModal accepts originalVal parameter and stores it
assert(
    dashHtml.includes('function dashShowMultivalModal(records, baseUrl, td, newVal, options, originalVal)'),
    'dashShowMultivalModal accepts originalVal parameter'
);

assert(
    dashHtml.includes('originalVal: originalVal'),
    'dashShowMultivalModal stores originalVal in ctx'
);

// Test 2: dashSaveCell passes originalVal
assert(
    dashHtml.includes('function dashSaveCell(td, newVal, originalVal)'),
    'dashSaveCell accepts originalVal'
);

assert(
    dashHtml.includes('dashSaveMatrixValue(td, newVal, originalVal)'),
    'dashSaveCell passes originalVal to dashSaveMatrixValue'
);

assert(
    dashHtml.includes('dashSaveValue(td, newVal, originalVal)'),
    'dashSaveCell passes originalVal to dashSaveValue'
);

// Test 3: dashSaveMatrixValue passes originalVal in search ctx
assert(
    dashHtml.includes('function dashSaveMatrixValue(td, newVal, originalVal)'),
    'dashSaveMatrixValue accepts originalVal'
);

assert(
    dashHtml.includes('{ td: td, newVal: newVal, originalVal: originalVal, searchUrl: searchUrl }'),
    'dashSaveMatrixValue passes originalVal in search context'
);

// Test 4: dashMatrixValueSearchDone passes originalVal to modal
assert(
    dashHtml.includes('}, ctx.originalVal);') && dashHtml.indexOf('}, ctx.originalVal);') > dashHtml.indexOf('saveCallback: \'dashMatrixValueSaveDone\''),
    'dashMatrixValueSearchDone passes ctx.originalVal to dashShowMultivalModal'
);

// Test 5: dashSaveValue passes originalVal in search ctx
assert(
    dashHtml.includes('function dashSaveValue(td, newVal, originalVal)'),
    'dashSaveValue accepts originalVal'
);

assert(
    dashHtml.includes('{ td: td, newVal: newVal, originalVal: originalVal, itemRef: itemRef'),
    'dashSaveValue passes originalVal in search context'
);

// Test 6: dashValueSearchDone passes originalVal to modal
assert(
    dashHtml.includes("dashShowMultivalModal(json, dashValueSearchUrl(td).replace('JSON_OBJ', '').replace(/&&/g, '&'), td, newVal, {}, ctx.originalVal)"),
    'dashValueSearchDone passes ctx.originalVal to dashShowMultivalModal'
);

// Test 7: commit() passes currentVal to dashSaveCell
assert(
    dashHtml.includes('dashSaveCell(td, newVal, currentVal)'),
    'commit() passes currentVal as originalVal to dashSaveCell'
);

// Test 8: close button handler restores original value
const closeHandlerMatch = dashHtml.match(/dash-multival-close.*?\.addEventListener.*?\{[\s\S]*?dashMultivalCtx = null;\s*\}\s*\}\s*\)\s*;/);
assert(
    closeHandlerMatch !== null,
    'close button handler found'
);

assert(
    dashHtml.includes('td.textContent = dashMultivalCtx.originalVal'),
    'close button handler restores td.textContent to originalVal'
);

assert(
    dashHtml.includes("td.style.backgroundColor = ''") && dashHtml.indexOf("td.style.backgroundColor = ''") > dashHtml.indexOf('dash-multival-close'),
    'close button handler resets backgroundColor'
);

console.log('\nResults:', passed, 'passed,', failed, 'failed');
process.exit(failed > 0 ? 1 : 0);
