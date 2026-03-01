/**
 * Test script for ddls with fieldHooks extraParams logic
 *
 * This tests the URL manipulation logic that applies extraParams
 * from fieldHooks to ddls override URLs.
 */

// Simulate the new logic
function applyExtraParamsToUrl(overrideUrl, extraParams, baseOrigin) {
    if (extraParams && Object.keys(extraParams).length > 0) {
        const url = new URL(overrideUrl, baseOrigin);
        for (const [key, value] of Object.entries(extraParams)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    }
    return overrideUrl;
}

const tests = [
    {
        name: 'Absolute URL with extraParams',
        input: {
            url: 'https://api.example.com/report/5230?JSON_KV',
            extraParams: { FR_partners: '!%' },
            origin: 'https://localhost'
        },
        check: (result) => {
            // Should have FR_partners added
            return result.includes('FR_partners=') && result.startsWith('https://api.example.com/report/5230');
        }
    },
    {
        name: 'URL with existing params - extraParams should add',
        input: {
            url: 'https://api.example.com/report/5230?JSON_KV&existing=1',
            extraParams: { FR_partners: '%' },
            origin: 'https://localhost'
        },
        check: (result) => {
            return result.includes('FR_partners=') && result.includes('existing=1');
        }
    },
    {
        name: 'Empty extraParams should not modify URL',
        input: {
            url: 'https://api.example.com/report/5230?JSON_KV',
            extraParams: {},
            origin: 'https://localhost'
        },
        check: (result) => {
            return result === 'https://api.example.com/report/5230?JSON_KV';
        }
    },
    {
        name: 'URL without query params - extraParams should add them',
        input: {
            url: 'https://api.example.com/report/5230',
            extraParams: { FR_partners: '!%' },
            origin: 'https://localhost'
        },
        check: (result) => {
            return result.includes('?') && result.includes('FR_partners=');
        }
    },
    {
        name: 'Multiple extraParams should all be added',
        input: {
            url: 'https://api.example.com/report/5230?JSON_KV',
            extraParams: { FR_partners: '%', FR_status: 'active', limit: '100' },
            origin: 'https://localhost'
        },
        check: (result) => {
            return result.includes('FR_partners=') &&
                   result.includes('FR_status=active') &&
                   result.includes('limit=100');
        }
    }
];

console.log('Testing ddls with fieldHooks extraParams logic\n');
console.log('=' .repeat(60));

let passCount = 0;
let failCount = 0;

tests.forEach((test, index) => {
    const result = applyExtraParamsToUrl(test.input.url, test.input.extraParams, test.input.origin);
    const passed = test.check(result);

    if (passed) {
        passCount++;
        console.log(`✅ Test ${index + 1}: ${test.name}`);
    } else {
        failCount++;
        console.log(`❌ Test ${index + 1}: ${test.name}`);
    }
    console.log(`   Input: ${test.input.url}`);
    console.log(`   Extra params: ${JSON.stringify(test.input.extraParams)}`);
    console.log(`   Result: ${result}`);
    console.log();
});

console.log('=' .repeat(60));
console.log(`Summary: ${passCount} passed, ${failCount} failed`);

if (failCount === 0) {
    console.log('\n✅ All tests passed!');
    process.exit(0);
} else {
    console.log('\n❌ Some tests failed.');
    process.exit(1);
}
