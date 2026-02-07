/**
 * Test script to verify the getApiBase() fix for issue #299
 *
 * This script tests that getApiBase() correctly extracts the base URL
 * from various input patterns including /metadata/ URLs.
 */

// Mock the getApiBase function with the fix
function getApiBase(apiUrl) {
    const url = apiUrl;
    if (!url) {
        return '';
    }
    const match = url.match(/^(.*?\/(report|type|metadata)\/\d+)/);
    if (match) {
        return match[1].replace(/\/(report|type|metadata)\/\d+$/, '');
    }
    // Fallback: remove everything after ? or last /
    return url.split('?')[0].replace(/\/[^\/]*$/, '');
}

// Test cases
const testCases = [
    {
        input: '/crm/metadata/332',
        expected: '/crm',
        description: 'metadata URL (issue #299 case)'
    },
    {
        input: '/crm/report/4283?JSON',
        expected: '/crm',
        description: 'report URL with query params'
    },
    {
        input: '/crm/type/123',
        expected: '/crm',
        description: 'type URL'
    },
    {
        input: '/{_global_.z}/report/4283?JSON',
        expected: '/{_global_.z}',
        description: 'report URL with template variable'
    },
    {
        input: '/demo/report-data.json',
        expected: '/demo',
        description: 'static JSON file'
    }
];

console.log('Testing getApiBase() fix for issue #299\n');
console.log('='.repeat(60));

let passedTests = 0;
let failedTests = 0;

testCases.forEach((test, index) => {
    const result = getApiBase(test.input);
    const passed = result === test.expected;

    console.log(`\nTest ${index + 1}: ${test.description}`);
    console.log(`  Input:    "${test.input}"`);
    console.log(`  Expected: "${test.expected}"`);
    console.log(`  Got:      "${result}"`);
    console.log(`  Status:   ${passed ? '✓ PASS' : '✗ FAIL'}`);

    if (passed) {
        passedTests++;
    } else {
        failedTests++;
    }
});

console.log('\n' + '='.repeat(60));
console.log(`\nResults: ${passedTests} passed, ${failedTests} failed`);

// Test the specific bug from issue #299
console.log('\n' + '='.repeat(60));
console.log('\nSpecific bug test from issue #299:');
console.log('When data-api-url="/crm/metadata/332"');
const apiBase = getApiBase('/crm/metadata/332');
console.log(`  getApiBase() returns: "${apiBase}"`);
console.log(`  Fetch URL would be: "${apiBase}/metadata"`);
console.log(`  Expected: "/crm/metadata"`);
console.log(`  Status: ${apiBase + '/metadata' === '/crm/metadata' ? '✓ PASS - Bug is FIXED!' : '✗ FAIL - Bug still exists'}`);

process.exit(failedTests > 0 ? 1 : 0);
