/**
 * Test for Issue #699: tableTypeId auto-detection from URL
 *
 * This test verifies that tableTypeId is correctly auto-detected from apiUrl
 * when not explicitly provided in options.
 *
 * Run: node experiments/test-issue-699-tableTypeId-autodetect.js
 */

// Test cases for URL patterns
const testCases = [
    {
        name: 'URL with /object/{id} pattern',
        apiUrl: '/crm/object/3596/?JSON_OBJ&F_U=1',
        expected: '3596'
    },
    {
        name: 'URL with /metadata/{id} pattern',
        apiUrl: '/crm/metadata/332',
        expected: '332'
    },
    {
        name: 'URL with /metadata/{id} pattern (without leading path)',
        apiUrl: '/metadata/332',
        expected: '332'
    },
    {
        name: 'URL with generic /{id} pattern',
        apiUrl: '/crm/type/123/?JSON',
        expected: '123'
    },
    {
        name: 'URL with /object/{id}/ pattern (trailing slash)',
        apiUrl: '/object/456/',
        expected: '456'
    },
    {
        name: 'URL with query params but numeric ID',
        apiUrl: '/api/789?param=value',
        expected: '789'
    }
];

// Extract typeId logic (same as in loadDataFromTable fix)
function extractTypeIdFromUrl(apiUrl) {
    let typeId = null;

    // Try /object/{id} pattern first
    const objectMatch = apiUrl && apiUrl.match(/\/object\/(\d+)/);
    if (objectMatch) {
        typeId = objectMatch[1];
    }

    // Try /metadata/{id} pattern
    if (!typeId) {
        const metadataMatch = apiUrl && apiUrl.match(/\/metadata\/(\d+)/);
        if (metadataMatch) {
            typeId = metadataMatch[1];
        }
    }

    // Try to extract from any /{database}/{endpoint}/{id} pattern
    if (!typeId && apiUrl) {
        const genericMatch = apiUrl.match(/\/(\d+)(?:\/|\?|$)/);
        if (genericMatch) {
            typeId = genericMatch[1];
        }
    }

    return typeId;
}

// Run tests
console.log('Testing Issue #699: tableTypeId auto-detection from URL\n');
console.log('=' .repeat(60));

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
    const result = extractTypeIdFromUrl(testCase.apiUrl);
    const success = result === testCase.expected;

    if (success) {
        console.log(`✓ PASS: ${testCase.name}`);
        console.log(`  URL: ${testCase.apiUrl}`);
        console.log(`  Expected: ${testCase.expected}, Got: ${result}`);
        passed++;
    } else {
        console.log(`✗ FAIL: ${testCase.name}`);
        console.log(`  URL: ${testCase.apiUrl}`);
        console.log(`  Expected: ${testCase.expected}, Got: ${result}`);
        failed++;
    }
    console.log();
}

console.log('=' .repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
