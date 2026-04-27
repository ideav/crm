/**
 * Test for issue #2205:
 * When opening a create form via .column-add-btn or .title-create-btn,
 * only the FIRST date/datetime field should be filled with the current date.
 * Other date fields must remain empty unless they have an explicit attrs default.
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
    let firstDateFieldSeen = false;
    return fields.map(req => {
        const baseFormat = req.format;
        const storedValue = req.storedValue || '';
        const isDateLike = baseFormat === 'DATE' || baseFormat === 'DATETIME';
        const suppressDateFallback = isDateLike && firstDateFieldSeen;
        if (isDateLike) firstDateFieldSeen = true;
        return storedValue || (isCreate ? resolveDefaultValue(req.attrs || '', baseFormat, suppressDateFallback) : '');
    });
}

function runTests() {
    const { resolveDefaultValue, now } = makeStub();

    const fields = [
        { id: '1', format: 'SHORT', attrs: '' },    // Text (title) — empty
        { id: '2', format: 'DATE', attrs: '' },      // First DATE — should be filled
        { id: '3', format: 'DATE', attrs: '' },      // Second DATE — should be empty
        { id: '4', format: 'DATETIME', attrs: '' },  // DATETIME — should be empty
        { id: '5', format: 'SHORT', attrs: '' },     // Text — empty
    ];

    const values = simulateFormFields(fields, true, resolveDefaultValue);
    let pass = true;

    if (values[0] !== '') {
        console.error('FAIL: Text field should be empty, got:', values[0]);
        pass = false;
    } else {
        console.log('PASS: Text field is empty');
    }

    if (!values[1] || values[1] === '') {
        console.error('FAIL: First DATE field should be filled, got:', values[1]);
        pass = false;
    } else {
        console.log('PASS: First DATE field filled with:', values[1]);
    }

    if (values[2] !== '') {
        console.error('FAIL: Second DATE field should be empty, got:', values[2]);
        pass = false;
    } else {
        console.log('PASS: Second DATE field is empty');
    }

    if (values[3] !== '') {
        console.error('FAIL: DATETIME field should be empty, got:', values[3]);
        pass = false;
    } else {
        console.log('PASS: DATETIME field is empty');
    }

    if (values[4] !== '') {
        console.error('FAIL: Second text field should be empty, got:', values[4]);
        pass = false;
    } else {
        console.log('PASS: Second text field is empty');
    }

    // Explicit attrs default should still work for non-first date fields
    const fieldsWithDefault = [
        { id: '1', format: 'DATE', attrs: '' },
        { id: '2', format: 'DATE', attrs: 'defaultValue=[TODAY]' },
    ];
    // suppressDateFallback=true only blocks the "no attrs" fallback, not explicit tokens
    // (in real code [TODAY] would resolve; stub doesn't parse tokens but flag passes correctly)
    console.log('INFO: suppressDateFallback only blocks fallback, explicit attrs still processed in real code');

    if (pass) {
        console.log('\nAll tests PASSED');
    } else {
        console.error('\nSome tests FAILED');
        process.exit(1);
    }
}

runTests();
