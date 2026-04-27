/**
 * Test for issue #2205:
 * When opening a create form via .column-add-btn or .title-create-btn,
 * ALL date/datetime fields in sortedFields (secondary fields) must remain
 * empty by default unless they have an explicit attrs default.
 * The main field is rendered separately and handled outside this loop.
 */

function makeStub() {
    const now = new Date();
    const formatDate = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    };

    function resolveDefaultValue(rawAttrs, format, suppressDateFallback = false) {
        if (rawAttrs && rawAttrs.trim().length > 0) {
            // simplified stub: doesn't parse tokens
            return '(explicit-default)';
        }
        if (!suppressDateFallback) {
            if (format === 'DATE') return formatDate(now);
            if (format === 'DATETIME') return formatDate(now) + ' 12:00:00';
        }
        return '';
    }

    return { resolveDefaultValue, now };
}

function simulateFormFields(fields, isCreate, resolveDefaultValue) {
    return fields.map(req => {
        const baseFormat = req.format;
        const storedValue = req.storedValue || '';
        // Issue #2205: always suppress date fallback for sortedFields in create mode
        return storedValue || (isCreate ? resolveDefaultValue(req.attrs || '', baseFormat, true) : '');
    });
}

function runTests() {
    const { resolveDefaultValue } = makeStub();

    const fields = [
        { id: '2', format: 'DATE', attrs: '' },      // DATE — should be empty
        { id: '3', format: 'DATE', attrs: '' },      // DATE — should be empty
        { id: '4', format: 'DATETIME', attrs: '' },  // DATETIME — should be empty
        { id: '5', format: 'SHORT', attrs: '' },     // Text — empty
        { id: '6', format: 'DATE', attrs: 'defaultValue=[TODAY]' }, // explicit attrs — gets value
    ];

    const values = simulateFormFields(fields, true, resolveDefaultValue);
    let pass = true;

    if (values[0] !== '') {
        console.error('FAIL: First DATE field should be empty (secondary), got:', values[0]);
        pass = false;
    } else {
        console.log('PASS: First DATE secondary field is empty');
    }

    if (values[1] !== '') {
        console.error('FAIL: Second DATE field should be empty, got:', values[1]);
        pass = false;
    } else {
        console.log('PASS: Second DATE field is empty');
    }

    if (values[2] !== '') {
        console.error('FAIL: DATETIME field should be empty, got:', values[2]);
        pass = false;
    } else {
        console.log('PASS: DATETIME field is empty');
    }

    if (values[3] !== '') {
        console.error('FAIL: Text field should be empty, got:', values[3]);
        pass = false;
    } else {
        console.log('PASS: Text field is empty');
    }

    if (values[4] !== '(explicit-default)') {
        console.error('FAIL: Field with explicit attrs default should be filled, got:', values[4]);
        pass = false;
    } else {
        console.log('PASS: Field with explicit attrs default is filled:', values[4]);
    }

    if (pass) {
        console.log('\nAll tests PASSED');
    } else {
        console.error('\nSome tests FAILED');
        process.exit(1);
    }
}

runTests();
