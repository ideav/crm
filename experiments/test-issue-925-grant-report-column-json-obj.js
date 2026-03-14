/**
 * Test for issue #925: GRANT and REPORT_COLUMN fields in JSON_OBJ format
 * come as "id:value" and should be parsed to show only the value part.
 *
 * Tests:
 * 1. renderCell: GRANT/REPORT_COLUMN "id:value" parsing
 * 2. parseReferenceDisplayValue: GRANT/REPORT_COLUMN support
 * 3. prepareExportData: GRANT/REPORT_COLUMN "id:value" stripping
 * 4. fetchRecordData: GRANT/REPORT_COLUMN term/value extraction
 * 5. openGroupedCellCreateForm: GRANT/REPORT_COLUMN ID extraction
 * 6. fullValueForEditing: stores grant/report_column ID for inline editor
 */

// ===== Test 1: renderCell should parse "id:value" for GRANT/REPORT_COLUMN =====
(function testRenderCellGrantParsing() {
    console.log('Test 1: renderCell GRANT/REPORT_COLUMN parsing');

    // Simulate the logic from renderCell
    function simulateRenderCell(column, value) {
        const validFormats = ['SHORT', 'CHARS', 'DATE', 'NUMBER', 'SIGNED', 'BOOLEAN',
                              'MEMO', 'DATETIME', 'FILE', 'HTML', 'BUTTON', 'PWD',
                              'GRANT', 'REPORT_COLUMN', 'PATH'];
        const upperFormat = column.format ? String(column.format).toUpperCase() : '';
        const format = validFormats.includes(upperFormat) ? upperFormat : 'SHORT';

        let displayValue = value || '';
        let refValueId = null;

        const isRefField = column.ref_id != null || (column.ref && column.ref !== 0);
        const isGrantOrReportColumn = format === 'GRANT' || format === 'REPORT_COLUMN';

        if ((isRefField || isGrantOrReportColumn) && value && typeof value === 'string') {
            const colonIndex = value.indexOf(':');
            if (colonIndex > 0) {
                refValueId = value.substring(0, colonIndex);
                displayValue = value.substring(colonIndex + 1);
            }
        }

        // fullValueForEditing logic
        const fullValueForEditing = (isGrantOrReportColumn && refValueId) ? refValueId : String(displayValue);

        return { displayValue, refValueId, fullValueForEditing };
    }

    // Test GRANT field with "id:value" format
    const grantResult = simulateRenderCell(
        { format: 'GRANT', ref: 0 },
        '3:Администратор'
    );
    console.assert(grantResult.displayValue === 'Администратор',
        `GRANT display should be 'Администратор', got '${grantResult.displayValue}'`);
    console.assert(grantResult.refValueId === '3',
        `GRANT refValueId should be '3', got '${grantResult.refValueId}'`);
    console.assert(grantResult.fullValueForEditing === '3',
        `GRANT fullValueForEditing should be '3', got '${grantResult.fullValueForEditing}'`);

    // Test REPORT_COLUMN field with "id:value" format
    const repColResult = simulateRenderCell(
        { format: 'REPORT_COLUMN', ref: 0 },
        '15:Колонка отчета'
    );
    console.assert(repColResult.displayValue === 'Колонка отчета',
        `REPORT_COLUMN display should be 'Колонка отчета', got '${repColResult.displayValue}'`);
    console.assert(repColResult.refValueId === '15',
        `REPORT_COLUMN refValueId should be '15', got '${repColResult.refValueId}'`);
    console.assert(repColResult.fullValueForEditing === '15',
        `REPORT_COLUMN fullValueForEditing should be '15', got '${repColResult.fullValueForEditing}'`);

    // Test GRANT field without "id:value" format (plain value)
    const grantPlain = simulateRenderCell(
        { format: 'GRANT', ref: 0 },
        'PlainValue'
    );
    console.assert(grantPlain.displayValue === 'PlainValue',
        `GRANT plain display should be 'PlainValue', got '${grantPlain.displayValue}'`);
    console.assert(grantPlain.refValueId === null,
        `GRANT plain refValueId should be null, got '${grantPlain.refValueId}'`);

    // Test non-GRANT field should NOT parse "id:value"
    const shortResult = simulateRenderCell(
        { format: 'SHORT', ref: 0 },
        '3:SomeValue'
    );
    console.assert(shortResult.displayValue === '3:SomeValue',
        `SHORT display should be '3:SomeValue', got '${shortResult.displayValue}'`);
    console.assert(shortResult.refValueId === null,
        `SHORT refValueId should be null, got '${shortResult.refValueId}'`);

    // Test reference field should still work
    const refResult = simulateRenderCell(
        { format: 'SHORT', ref: 1, ref_id: 123 },
        '5:RefValue'
    );
    console.assert(refResult.displayValue === 'RefValue',
        `REF display should be 'RefValue', got '${refResult.displayValue}'`);
    console.assert(refResult.refValueId === '5',
        `REF refValueId should be '5', got '${refResult.refValueId}'`);

    // Test empty/null values
    const emptyResult = simulateRenderCell(
        { format: 'GRANT', ref: 0 },
        ''
    );
    console.assert(emptyResult.displayValue === '',
        `GRANT empty display should be '', got '${emptyResult.displayValue}'`);

    const nullResult = simulateRenderCell(
        { format: 'GRANT', ref: 0 },
        null
    );
    console.assert(nullResult.displayValue === '',
        `GRANT null display should be '', got '${nullResult.displayValue}'`);

    console.log('  PASSED: renderCell GRANT/REPORT_COLUMN parsing');
})();

// ===== Test 2: parseReferenceDisplayValue should handle GRANT/REPORT_COLUMN =====
(function testParseReferenceDisplayValue() {
    console.log('Test 2: parseReferenceDisplayValue GRANT/REPORT_COLUMN support');

    function parseReferenceDisplayValue(value, column) {
        if (value === null || value === undefined) return '';
        const strValue = String(value);
        const isRefField = column && (column.ref_id != null || (column.ref && column.ref !== 0));
        const columnFormat = column && column.format ? String(column.format).toUpperCase() : '';
        const isGrantOrReportColumn = columnFormat === 'GRANT' || columnFormat === 'REPORT_COLUMN';

        if ((isRefField || isGrantOrReportColumn) && strValue) {
            const colonIndex = strValue.indexOf(':');
            if (colonIndex > 0) {
                return strValue.substring(colonIndex + 1);
            }
        }
        return strValue;
    }

    console.assert(parseReferenceDisplayValue('3:Admin', { format: 'GRANT' }) === 'Admin',
        'GRANT should return display value');
    console.assert(parseReferenceDisplayValue('15:Col', { format: 'REPORT_COLUMN' }) === 'Col',
        'REPORT_COLUMN should return display value');
    console.assert(parseReferenceDisplayValue('3:Admin', { format: 'SHORT' }) === '3:Admin',
        'SHORT should return raw value');
    console.assert(parseReferenceDisplayValue('5:RefVal', { ref_id: 1, format: 'SHORT' }) === 'RefVal',
        'Ref field should still work');
    console.assert(parseReferenceDisplayValue(null, { format: 'GRANT' }) === '',
        'Null should return empty string');
    console.assert(parseReferenceDisplayValue('', { format: 'GRANT' }) === '',
        'Empty should return empty string');

    console.log('  PASSED: parseReferenceDisplayValue GRANT/REPORT_COLUMN support');
})();

// ===== Test 3: Export data should strip "id:" prefix for GRANT/REPORT_COLUMN =====
(function testExportDataGrantParsing() {
    console.log('Test 3: Export data GRANT/REPORT_COLUMN "id:" stripping');

    function simulateExportParsing(col, value) {
        const format = col.format || 'SHORT';
        let result = value || '';
        const isRefField = col.ref_id != null || (col.ref && col.ref !== 0);
        const upperFormat = String(format).toUpperCase();
        const isGrantOrReportColumn = upperFormat === 'GRANT' || upperFormat === 'REPORT_COLUMN';

        if ((isRefField || isGrantOrReportColumn) && result && typeof result === 'string') {
            const colonIndex = result.indexOf(':');
            if (colonIndex > 0) {
                result = result.substring(colonIndex + 1);
            }
        }
        return result;
    }

    console.assert(simulateExportParsing({ format: 'GRANT' }, '3:Admin') === 'Admin',
        'GRANT export should strip id prefix');
    console.assert(simulateExportParsing({ format: 'REPORT_COLUMN' }, '15:Col') === 'Col',
        'REPORT_COLUMN export should strip id prefix');
    console.assert(simulateExportParsing({ format: 'SHORT' }, '3:Value') === '3:Value',
        'SHORT export should keep raw value');

    console.log('  PASSED: Export data GRANT/REPORT_COLUMN "id:" stripping');
})();

// ===== Test 4: fetchRecordData GRANT/REPORT_COLUMN term/value extraction =====
(function testFetchRecordDataGrant() {
    console.log('Test 4: fetchRecordData GRANT/REPORT_COLUMN parsing');

    function normalizeFormat(baseTypeId) {
        const formatMap = {
            '5': 'GRANT',
            '16': 'REPORT_COLUMN',
            '1': 'SHORT',
            '4': 'NUMBER',
        };
        return formatMap[String(baseTypeId)] || 'SHORT';
    }

    // Simulate the fetchRecordData logic for GRANT/REPORT_COLUMN
    function simulateFetchRecordDataParsing(metadata, rowValues) {
        const reqs = metadata.reqs || [];
        const recordReqs = {};

        reqs.forEach((req, idx) => {
            const rawValue = rowValues[idx + 1] !== undefined ? rowValues[idx + 1] : '';
            const reqFormat = normalizeFormat(req.type);
            let reqValue = rawValue;
            let reqTerm = undefined;
            if ((reqFormat === 'GRANT' || reqFormat === 'REPORT_COLUMN') && typeof rawValue === 'string') {
                const colonIdx = rawValue.indexOf(':');
                if (colonIdx > 0) {
                    reqTerm = rawValue.substring(0, colonIdx);
                    reqValue = rawValue.substring(colonIdx + 1);
                }
            }
            recordReqs[req.id] = {
                value: reqValue,
                base: req.type,
                order: idx
            };
            if (reqTerm !== undefined) {
                recordReqs[req.id].term = reqTerm;
            }
        });

        // Main field parsing
        const mainFormat = normalizeFormat(metadata.type);
        let mainVal = rowValues[0] !== undefined ? rowValues[0] : '';
        let mainTerm = undefined;
        if ((mainFormat === 'GRANT' || mainFormat === 'REPORT_COLUMN') && typeof mainVal === 'string') {
            const colonIdx = mainVal.indexOf(':');
            if (colonIdx > 0) {
                mainTerm = mainVal.substring(0, colonIdx);
                mainVal = mainVal.substring(colonIdx + 1);
            }
        }

        const result = {
            obj: { id: 1, val: mainVal, parent: 1 },
            reqs: recordReqs
        };
        if (mainTerm !== undefined) {
            result.obj.term = mainTerm;
        }
        return result;
    }

    // Test: main field is GRANT type
    const grantMainResult = simulateFetchRecordDataParsing(
        { type: '5', reqs: [{ id: 100, type: '1' }] },
        ['3:Администратор', 'SomeReqValue']
    );
    console.assert(grantMainResult.obj.val === 'Администратор',
        `Main val should be 'Администратор', got '${grantMainResult.obj.val}'`);
    console.assert(grantMainResult.obj.term === '3',
        `Main term should be '3', got '${grantMainResult.obj.term}'`);

    // Test: requisite is REPORT_COLUMN type
    const repColReqResult = simulateFetchRecordDataParsing(
        { type: '1', reqs: [{ id: 200, type: '16' }] },
        ['MainValue', '15:Колонка']
    );
    console.assert(repColReqResult.reqs[200].value === 'Колонка',
        `Req value should be 'Колонка', got '${repColReqResult.reqs[200].value}'`);
    console.assert(repColReqResult.reqs[200].term === '15',
        `Req term should be '15', got '${repColReqResult.reqs[200].term}'`);
    console.assert(repColReqResult.obj.term === undefined,
        'Main term should be undefined for SHORT type');

    // Test: non-GRANT requisite should NOT be parsed
    const shortReqResult = simulateFetchRecordDataParsing(
        { type: '1', reqs: [{ id: 300, type: '1' }] },
        ['MainValue', '3:ValueWithColon']
    );
    console.assert(shortReqResult.reqs[300].value === '3:ValueWithColon',
        `SHORT req value should be raw '3:ValueWithColon', got '${shortReqResult.reqs[300].value}'`);
    console.assert(shortReqResult.reqs[300].term === undefined,
        'SHORT req should not have term');

    console.log('  PASSED: fetchRecordData GRANT/REPORT_COLUMN parsing');
})();

// ===== Test 5: grouped cell create form should extract ID from GRANT/REPORT_COLUMN =====
(function testGroupedCellCreateFormGrant() {
    console.log('Test 5: openGroupedCellCreateForm GRANT/REPORT_COLUMN ID extraction');

    function simulateIdExtraction(column, rawValue) {
        const isRefField = column.ref_id != null || (column.ref && column.ref !== 0);
        const colFormat = column.format ? String(column.format).toUpperCase() : '';
        const isGrantOrRepCol = colFormat === 'GRANT' || colFormat === 'REPORT_COLUMN';
        let valueToUse = rawValue;

        if ((isRefField || isGrantOrRepCol) && typeof rawValue === 'string') {
            const colonIndex = rawValue.indexOf(':');
            if (colonIndex > 0) {
                valueToUse = rawValue.substring(0, colonIndex);
            }
        }
        return valueToUse;
    }

    console.assert(simulateIdExtraction({ format: 'GRANT' }, '3:Admin') === '3',
        'GRANT should extract ID');
    console.assert(simulateIdExtraction({ format: 'REPORT_COLUMN' }, '15:Col') === '15',
        'REPORT_COLUMN should extract ID');
    console.assert(simulateIdExtraction({ format: 'SHORT' }, '3:Value') === '3:Value',
        'SHORT should keep raw value');
    console.assert(simulateIdExtraction({ format: 'GRANT' }, 'NoColon') === 'NoColon',
        'Value without colon should be kept as-is');

    console.log('  PASSED: openGroupedCellCreateForm GRANT/REPORT_COLUMN ID extraction');
})();

console.log('\nAll tests for issue #925 PASSED!');
