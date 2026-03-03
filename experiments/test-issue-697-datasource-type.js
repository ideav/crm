/**
 * Test for issue #697: Verify getDataSourceType() returns correct type based on URL patterns
 *
 * Problem: Tables accessed via /table/18 URLs with data-api-url="/ru2/metadata/18"
 * were incorrectly identified as 'report' instead of 'table' because the code
 * was using this.options.dataSource (defaults to 'report') instead of getDataSourceType()
 * which correctly detects the type from URL patterns.
 *
 * Fix: Replace all uses of this.options.dataSource === 'table' with this.getDataSourceType() === 'table'
 */

// Mock IntegramTable class for testing
class MockIntegramTable {
    constructor(apiUrl, dataSource = 'report') {
        this.options = {
            apiUrl: apiUrl,
            dataSource: dataSource
        };
    }

    /**
     * Original getDataSourceType implementation
     */
    getDataSourceType() {
        const url = this.options.apiUrl;
        if (url && /\/report\//.test(url)) {
            return 'report';
        }
        if (url && /\/metadata\//.test(url)) {
            return 'table';
        }
        // Fallback to configured dataSource option
        return this.options.dataSource;
    }
}

// Test cases
function runTests() {
    console.log('Testing getDataSourceType() behavior for issue #697\n');

    const testCases = [
        {
            name: 'URL with /metadata/ should return "table"',
            apiUrl: '/ru2/metadata/18',
            dataSourceOption: 'report',  // Default value
            expected: 'table'
        },
        {
            name: 'URL with /report/ should return "report"',
            apiUrl: '/ru2/report/18',
            dataSourceOption: 'report',
            expected: 'report'
        },
        {
            name: 'URL with /metadata/ should return "table" regardless of dataSource option',
            apiUrl: '/db/metadata/123',
            dataSourceOption: 'report',  // Even with report option
            expected: 'table'
        },
        {
            name: 'URL without /metadata/ or /report/ should fallback to dataSource option',
            apiUrl: '/api/custom/endpoint',
            dataSourceOption: 'table',
            expected: 'table'
        },
        {
            name: 'URL without /metadata/ or /report/ with default option should return "report"',
            apiUrl: '/api/custom/endpoint',
            dataSourceOption: 'report',
            expected: 'report'
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of testCases) {
        const instance = new MockIntegramTable(testCase.apiUrl, testCase.dataSourceOption);
        const result = instance.getDataSourceType();

        if (result === testCase.expected) {
            console.log(`✅ PASS: ${testCase.name}`);
            console.log(`   apiUrl: "${testCase.apiUrl}", dataSourceOption: "${testCase.dataSourceOption}"`);
            console.log(`   Result: "${result}" (expected: "${testCase.expected}")\n`);
            passed++;
        } else {
            console.log(`❌ FAIL: ${testCase.name}`);
            console.log(`   apiUrl: "${testCase.apiUrl}", dataSourceOption: "${testCase.dataSourceOption}"`);
            console.log(`   Result: "${result}" (expected: "${testCase.expected}")\n`);
            failed++;
        }
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed`);

    // Demonstrate the issue
    console.log('\n--- Issue #697 Demonstration ---');
    console.log('When accessing https://ideav.ru/ru2/table/18, the template produces:');
    console.log('  data-api-url="/ru2/metadata/18"');
    console.log('');

    const problemInstance = new MockIntegramTable('/ru2/metadata/18', 'report');
    console.log('Before fix (using options.dataSource):');
    console.log(`  options.dataSource === 'table' → ${problemInstance.options.dataSource === 'table'} (WRONG - should be true)`);
    console.log('');
    console.log('After fix (using getDataSourceType()):');
    console.log(`  getDataSourceType() === 'table' → ${problemInstance.getDataSourceType() === 'table'} (CORRECT)`);

    return failed === 0;
}

// Run the tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runTests, MockIntegramTable };
}

runTests();
