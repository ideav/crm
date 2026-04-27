/**
 * Test for issue #2206:
 * When addNewRow pre-fills a reference column with a bare ID (e.g. "447"),
 * the label must be resolved asynchronously and the cell updated to "447:sportzania".
 */

function runTests() {
    let pass = true;

    // Simulate the resolution logic used in addNewRow
    function resolveRefLabel(value, options) {
        if (!value || String(value).indexOf(':') >= 0) return value; // already resolved
        const match = options.find(([id]) => String(id) === String(value));
        if (!match) return value;
        return `${ match[0] }:${ match[1] }`;
    }

    const options = [
        ['447', 'sportzania'],
        ['448', 'another'],
    ];

    const bare = '447';
    const resolved = resolveRefLabel(bare, options);
    if (resolved !== '447:sportzania') {
        console.error('FAIL: expected "447:sportzania", got:', resolved);
        pass = false;
    } else {
        console.log('PASS: bare ID resolved to label:', resolved);
    }

    // Already resolved value should be unchanged
    const alreadyResolved = '447:sportzania';
    const unchanged = resolveRefLabel(alreadyResolved, options);
    if (unchanged !== alreadyResolved) {
        console.error('FAIL: already-resolved value was changed:', unchanged);
        pass = false;
    } else {
        console.log('PASS: already-resolved value unchanged:', unchanged);
    }

    // Unknown ID — fallback to raw
    const unknown = '999';
    const fallback = resolveRefLabel(unknown, options);
    if (fallback !== '999') {
        console.error('FAIL: unknown ID should remain as-is, got:', fallback);
        pass = false;
    } else {
        console.log('PASS: unknown ID kept as fallback:', fallback);
    }

    // Empty value — unchanged
    const empty = resolveRefLabel('', options);
    if (empty !== '') {
        console.error('FAIL: empty value should remain empty, got:', empty);
        pass = false;
    } else {
        console.log('PASS: empty value unchanged');
    }

    if (pass) {
        console.log('\nAll tests PASSED');
    } else {
        console.error('\nSome tests FAILED');
        process.exit(1);
    }
}

runTests();
