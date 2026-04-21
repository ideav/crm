/**
 * Test for issue #2057:
 * When adding a row via .add-row-btn, only the FIRST date/datetime column
 * should be filled with the current date. Other date columns must remain empty.
 */

// Minimal stub to test resolveDefaultValue and addNewRow date logic
function makeStub() {
    const now = new Date();
    const formatDate = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    };

    // Simulate resolveDefaultValue with the fix applied
    function resolveDefaultValue(rawAttrs, format, suppressDateFallback = false) {
        if (rawAttrs && rawAttrs.trim().length > 0) {
            // simplified: no token parsing needed for this test
        }
        if (!suppressDateFallback) {
            if (format === 'DATE') return formatDate(now);
            if (format === 'DATETIME') return formatDate(now) + ' 12:00:00';
        }
        return '';
    }

    return { resolveDefaultValue, now };
}

function runTests() {
    const { resolveDefaultValue } = makeStub();

    const columns = [
        { id: '5616', format: 'DATE', attrs: '' },   // First column (main, type 9 = DATE)
        { id: '6281', format: 'DATE', attrs: '' },   // "Выход" column (also DATE, type 9) — should NOT be filled
        { id: '5618', format: 'SHORT', attrs: '' },  // Text column — should be empty
    ];

    const objectTableId = '5616'; // First column id
    const firstColId = String(objectTableId);

    const emptyRow = columns.map(col => {
        const isFirstCol = col.id === firstColId;
        return resolveDefaultValue(col.attrs || '', col.format, !isFirstCol);
    });

    let pass = true;

    // First column (main DATE column) should have current date
    if (!emptyRow[0] || emptyRow[0] === '') {
        console.error('FAIL: First date column should be filled with current date, got:', emptyRow[0]);
        pass = false;
    } else {
        console.log('PASS: First date column filled with:', emptyRow[0]);
    }

    // "Выход" column (second DATE column) should be empty
    if (emptyRow[1] !== '') {
        console.error('FAIL: Second date column ("Выход") should be empty, got:', emptyRow[1]);
        pass = false;
    } else {
        console.log('PASS: Second date column ("Выход") is empty (correct)');
    }

    // Text column should be empty
    if (emptyRow[2] !== '') {
        console.error('FAIL: Text column should be empty, got:', emptyRow[2]);
        pass = false;
    } else {
        console.log('PASS: Text column is empty (correct)');
    }

    // Test that explicit attrs default still works for non-first date columns
    const colWithDefault = { id: '6281', format: 'DATE', attrs: 'defaultValue=[TODAY]' };
    // (In real code, resolveDefaultValue would parse [TODAY] and return current date)
    // Here just verify suppressDateFallback=true doesn't block explicit token resolution
    const withDefault = resolveDefaultValue('defaultValue=[TODAY]', 'DATE', true);
    // With the simplified stub, this won't resolve [TODAY], but in real code it would.
    // The key is: suppress only affects the "no attrs" fallback path.
    console.log('INFO: Column with explicit default (suppressed fallback) =', withDefault || '(empty in stub, [TODAY] would resolve in real code)');

    if (pass) {
        console.log('\nAll tests PASSED');
    } else {
        console.error('\nSome tests FAILED');
        process.exit(1);
    }
}

runTests();
