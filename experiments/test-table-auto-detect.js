// Test the auto-detection logic for table.html
// Simulates the URL parsing and get_record handling

function testUrlParsing() {
    const testCases = [
        { pathname: '/mydb/table/1144', expected: { found: true, id: '1144' } },
        { pathname: '/mydb/table/291', expected: { found: true, id: '291' } },
        { pathname: '/mydb/kanban/1144', expected: { found: false, id: null } },
        { pathname: '/mydb/table/', expected: { found: false, id: null } },
        { pathname: '/mydb/table/abc', expected: { found: true, id: 'abc', isInteger: false } },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach(({ pathname, expected }) => {
        const pathParts = pathname.split('/').filter(p => p !== '');
        let tableIdx = -1;
        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i] === 'table') { tableIdx = i; break; }
        }

        const found = tableIdx !== -1 && tableIdx + 1 < pathParts.length;
        const rawId = found ? pathParts[tableIdx + 1] : null;
        const isInteger = rawId ? /^\d+$/.test(rawId) : false;

        const result = { found, id: rawId, isInteger };

        const pass = (found === expected.found) && (rawId === expected.id);
        if (pass) {
            passed++;
            console.log(`✓ ${pathname} → id=${rawId}, found=${found}`);
        } else {
            failed++;
            console.log(`✗ ${pathname} → expected id=${expected.id}/found=${expected.found}, got id=${rawId}/found=${found}`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
}

function testObjDetection() {
    console.log('\n--- obj detection ---');
    const cases = [
        { obj: '22', expected: 'report' },
        { obj: '18', expected: 'table' },
        { obj: 22, expected: 'report' },
        { obj: null, expected: 'table' },
        { obj: undefined, expected: 'table' },
    ];

    let passed = 0;
    let failed = 0;

    cases.forEach(({ obj, expected }) => {
        const type = String(obj) === '22' ? 'report' : 'table';
        if (type === expected) {
            passed++;
            console.log(`✓ obj=${JSON.stringify(obj)} → ${type}`);
        } else {
            failed++;
            console.log(`✗ obj=${JSON.stringify(obj)} → expected ${expected}, got ${type}`);
        }
    });

    console.log(`\n${passed} passed, ${failed} failed`);
}

testUrlParsing();
testObjDetection();
