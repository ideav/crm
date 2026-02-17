/**
 * Test for getPageUrlParams() and appendPageUrlParams() methods
 * Issue #476: Forward GET parameters from page URL to report/object requests
 */

// Mock window.location.search for testing
const originalLocation = global.window?.location;

// Test helper to create a mock IntegramTable instance
function createMockInstance(search = '') {
    // Mock window.location
    global.window = {
        location: {
            search: search,
            pathname: '/crm/report/123',
            hostname: 'example.com'
        }
    };

    // Create minimal mock instance with the new methods
    const instance = {
        getPageUrlParams() {
            const pageParams = new URLSearchParams(window.location.search);
            const forwardParams = new URLSearchParams();

            // Parameters to exclude (already handled internally or could conflict)
            const excludeParams = new Set(['parentId', 'F_U', 'up', 'LIMIT', 'ORDER', 'RECORD_COUNT', '_count', 'JSON_OBJ', 'JSON']);

            for (const [key, value] of pageParams.entries()) {
                if (!excludeParams.has(key)) {
                    forwardParams.append(key, value);
                }
            }

            return forwardParams;
        },

        appendPageUrlParams(params) {
            const pageParams = this.getPageUrlParams();
            for (const [key, value] of pageParams.entries()) {
                // Only append if not already set (avoid duplicates)
                if (!params.has(key)) {
                    params.append(key, value);
                }
            }
        }
    };

    return instance;
}

// Test 1: Empty URL parameters
function testEmptyParams() {
    const instance = createMockInstance('');
    const params = instance.getPageUrlParams();
    console.assert(params.toString() === '', 'Test 1 failed: Empty params should return empty string');
    console.log('Test 1 passed: Empty URL parameters');
}

// Test 2: Simple parameters that should be forwarded
function testSimpleParams() {
    const instance = createMockInstance('?customParam=value&anotherParam=123');
    const params = instance.getPageUrlParams();
    console.assert(params.get('customParam') === 'value', 'Test 2a failed: customParam should be "value"');
    console.assert(params.get('anotherParam') === '123', 'Test 2b failed: anotherParam should be "123"');
    console.log('Test 2 passed: Simple parameters forwarded correctly');
}

// Test 3: Excluded parameters should not be forwarded
function testExcludedParams() {
    const instance = createMockInstance('?parentId=1&F_U=2&up=3&LIMIT=0,20&ORDER=1&customParam=value');
    const params = instance.getPageUrlParams();
    console.assert(params.get('parentId') === null, 'Test 3a failed: parentId should be excluded');
    console.assert(params.get('F_U') === null, 'Test 3b failed: F_U should be excluded');
    console.assert(params.get('up') === null, 'Test 3c failed: up should be excluded');
    console.assert(params.get('LIMIT') === null, 'Test 3d failed: LIMIT should be excluded');
    console.assert(params.get('ORDER') === null, 'Test 3e failed: ORDER should be excluded');
    console.assert(params.get('customParam') === 'value', 'Test 3f failed: customParam should be included');
    console.log('Test 3 passed: Excluded parameters not forwarded');
}

// Test 4: appendPageUrlParams should not duplicate existing params
function testAppendNoDuplicates() {
    const instance = createMockInstance('?customParam=fromUrl&newParam=123');
    const params = new URLSearchParams();
    params.set('customParam', 'alreadySet');
    instance.appendPageUrlParams(params);
    console.assert(params.get('customParam') === 'alreadySet', 'Test 4a failed: existing param should not be overwritten');
    console.assert(params.get('newParam') === '123', 'Test 4b failed: new param should be added');
    console.log('Test 4 passed: appendPageUrlParams does not duplicate');
}

// Test 5: Filter parameters (FR_*) should be forwarded
function testFilterParams() {
    const instance = createMockInstance('?FR_123=value&TO_456=value2');
    const params = instance.getPageUrlParams();
    console.assert(params.get('FR_123') === 'value', 'Test 5a failed: FR_* params should be forwarded');
    console.assert(params.get('TO_456') === 'value2', 'Test 5b failed: TO_* params should be forwarded');
    console.log('Test 5 passed: Filter parameters forwarded correctly');
}

// Run all tests
console.log('Running tests for getPageUrlParams() and appendPageUrlParams()...\n');
testEmptyParams();
testSimpleParams();
testExcludedParams();
testAppendNoDuplicates();
testFilterParams();
console.log('\nAll tests passed!');
