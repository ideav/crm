/**
 * Test script for metadata caching in forms.html
 * Issue #727: Cache and reuse metadata instead of fetching for each table
 *
 * Run with: node experiments/test-metadata-caching.js
 */

// Mock FormConstructor with metadataCache
const FormConstructor = {
    metadataCache: {},
    db: 'test_db',
    xsrf: 'test_xsrf',
    token: 'test_token'
};

// Track API calls
let apiCallCount = 0;
const apiCallLog = [];

// Mock apiRequest
function apiRequest(method, endpoint, data, callback) {
    apiCallCount++;
    apiCallLog.push({ method, endpoint, data });

    // Simulate response for metadata endpoints
    if (endpoint.startsWith('metadata/')) {
        const tableId = endpoint.match(/metadata\/(\d+)/)?.[1];
        callback({
            id: parseInt(tableId),
            val: `Table ${tableId}`,
            reqs: [
                { id: 161, val: 'Report', type: 'ref' },
                { id: 184, val: 'Type', type: 'string' },
                { id: 254, val: 'Color', type: 'color' }
            ]
        });
    }
}

// ============================================================
// Get Metadata with Caching (same as in forms.html)
// ============================================================
function getMetadata(tableId, callback) {
    // Check cache first
    if (FormConstructor.metadataCache[tableId]) {
        callback(FormConstructor.metadataCache[tableId]);
        return;
    }

    // Fetch and cache
    apiRequest('GET', 'metadata/' + tableId + '?JSON', null, function(json) {
        if (json) {
            FormConstructor.metadataCache[tableId] = json;
        }
        callback(json);
    });
}

// ============================================================
// Test Cases
// ============================================================

console.log('Testing metadata caching...\n');

// Test 1: First call should make an API request
console.log('Test 1: First call to getMetadata(138)');
apiCallCount = 0;
getMetadata(138, (result) => {
    console.log(`  Result: ${JSON.stringify(result.val)}`);
    console.log(`  API calls made: ${apiCallCount}`);
    console.log(`  Expected: 1 API call`);
    console.log(`  ${apiCallCount === 1 ? '[PASS]' : '[FAIL]'}`);
});

// Test 2: Second call should use cache (no API request)
console.log('\nTest 2: Second call to getMetadata(138) - should use cache');
apiCallCount = 0;
getMetadata(138, (result) => {
    console.log(`  Result: ${JSON.stringify(result.val)}`);
    console.log(`  API calls made: ${apiCallCount}`);
    console.log(`  Expected: 0 API calls (cached)`);
    console.log(`  ${apiCallCount === 0 ? '[PASS]' : '[FAIL]'}`);
});

// Test 3: Call for different table should make a new API request
console.log('\nTest 3: First call to getMetadata(150)');
apiCallCount = 0;
getMetadata(150, (result) => {
    console.log(`  Result: ${JSON.stringify(result.val)}`);
    console.log(`  API calls made: ${apiCallCount}`);
    console.log(`  Expected: 1 API call`);
    console.log(`  ${apiCallCount === 1 ? '[PASS]' : '[FAIL]'}`);
});

// Test 4: Multiple calls for same table should all use cache
console.log('\nTest 4: Multiple calls to getMetadata(138) - all should use cache');
apiCallCount = 0;
for (let i = 0; i < 5; i++) {
    getMetadata(138, (result) => {});
}
console.log(`  API calls made: ${apiCallCount}`);
console.log(`  Expected: 0 API calls (all cached)`);
console.log(`  ${apiCallCount === 0 ? '[PASS]' : '[FAIL]'}`);

// Show cache state
console.log('\n========================================');
console.log('Final cache state:');
console.log(`  Tables cached: ${Object.keys(FormConstructor.metadataCache).join(', ')}`);
console.log('========================================');
