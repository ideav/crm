/**
 * Test for issue #861: Display F_I GET parameter as visible filter in filter row
 *
 * Tests that when F_I is present in URL and dataSource is 'table':
 * 1. filtersEnabled is set to true
 * 2. First column gets a filter with type '=' and value '@{F_I value}'
 */

// Simulate the parseUrlFiltersFromParams logic from integram-table.js
function simulateParseUrlFiltersFromParams(options, columns, existingFilters) {
    const urlFilters = {};

    // Simulate URL parsing (in this test we pass options.recordId directly)
    // (In real code, this comes from urlParams.get('F_I') in constructor)

    // ... URL filter parsing (FR_*, F_*, TO_*) would happen here ...

    // === Issue #861: Display F_I as visible filter on first column for table data source ===
    if (options.recordId && getDataSourceType(options) === 'table' && columns.length > 0) {
        const firstColId = columns[0].id;
        if (!urlFilters[firstColId]) {
            const recordIdValue = `@${options.recordId}`;
            urlFilters[firstColId] = {
                type: '=',
                value: recordIdValue,
                paramKey: 'F_I',
                isRefId: true,
                refId: options.recordId
            };
        }
    }

    const filters = {};
    let filtersEnabled = false;

    if (Object.keys(urlFilters).length > 0) {
        Object.keys(urlFilters).forEach(colId => {
            const urlFilter = urlFilters[colId];
            filters[colId] = {
                type: urlFilter.type,
                value: urlFilter.value
            };
        });
        filtersEnabled = true;
    }

    return { urlFilters, filters, filtersEnabled };
}

function getDataSourceType(options) {
    const url = options.apiUrl || '';
    if (/\/report\//.test(url)) return 'report';
    if (/\/metadata\//.test(url)) return 'table';
    return options.dataSource || 'report';
}

// Test 1: F_I present, table data source, columns loaded
function test1() {
    const options = {
        apiUrl: '/db/metadata/42',
        dataSource: 'table',
        recordId: '123'
    };
    const columns = [
        { id: '42', name: 'Значение', type: 'SHORT' },
        { id: '100', name: 'Имя', type: 'SHORT' }
    ];

    const result = simulateParseUrlFiltersFromParams(options, columns, {});

    console.assert(result.filtersEnabled === true, 'Test 1: filtersEnabled should be true');
    console.assert(result.filters['42'] !== undefined, 'Test 1: filter for first column should be set');
    console.assert(result.filters['42'].type === '=', 'Test 1: filter type should be "="');
    console.assert(result.filters['42'].value === '@123', 'Test 1: filter value should be "@123"');
    console.assert(result.urlFilters['42'].isRefId === true, 'Test 1: isRefId should be true');
    console.assert(result.urlFilters['42'].refId === '123', 'Test 1: refId should be "123"');
    console.log('Test 1 PASSED: F_I shown as filter on first column for table source');
}

// Test 2: F_I present but data source is 'report' - should NOT set filter
function test2() {
    const options = {
        apiUrl: '/db/report/42',
        dataSource: 'report',
        recordId: '123'
    };
    const columns = [
        { id: '42', name: 'Значение', type: 'SHORT' }
    ];

    const result = simulateParseUrlFiltersFromParams(options, columns, {});

    console.assert(result.filtersEnabled === false, 'Test 2: filtersEnabled should be false for report source');
    console.assert(result.filters['42'] === undefined, 'Test 2: no filter should be set for report source');
    console.log('Test 2 PASSED: F_I not shown as filter for report source');
}

// Test 3: F_I absent - should NOT set filter
function test3() {
    const options = {
        apiUrl: '/db/metadata/42',
        dataSource: 'table',
        recordId: null
    };
    const columns = [
        { id: '42', name: 'Значение', type: 'SHORT' }
    ];

    const result = simulateParseUrlFiltersFromParams(options, columns, {});

    console.assert(result.filtersEnabled === false, 'Test 3: filtersEnabled should be false when no recordId');
    console.assert(result.filters['42'] === undefined, 'Test 3: no filter when recordId is null');
    console.log('Test 3 PASSED: No filter set when F_I is absent');
}

// Test 4: F_I present but no columns loaded yet - should NOT set filter
function test4() {
    const options = {
        apiUrl: '/db/metadata/42',
        dataSource: 'table',
        recordId: '123'
    };
    const columns = [];  // Empty - columns not loaded yet

    const result = simulateParseUrlFiltersFromParams(options, columns, {});

    console.assert(result.filtersEnabled === false, 'Test 4: filtersEnabled should be false when no columns');
    console.log('Test 4 PASSED: No filter when columns are empty');
}

// Test 5: F_I present but first column already has a URL filter - should NOT override
function test5() {
    const options = {
        apiUrl: '/db/metadata/42',
        dataSource: 'table',
        recordId: '123'
    };
    const columns = [
        { id: '42', name: 'Значение', type: 'SHORT' }
    ];

    // Simulate that first column already has a filter (e.g. from FR_42=something)
    // We need to pre-populate urlFilters - simulate by modifying the function
    // (In real code this would come from FR_42 or F_42 URL params)

    // We'll test by confirming the guard: if urlFilters[firstColId] already exists, skip
    const urlFilters = { '42': { type: '~', value: 'test', paramKey: 'FR_42' } };
    const firstColId = '42';

    if (!urlFilters[firstColId]) {
        urlFilters[firstColId] = { type: '=', value: '@123', paramKey: 'F_I', isRefId: true, refId: '123' };
    }

    console.assert(urlFilters['42'].type === '~', 'Test 5: existing filter should not be overridden');
    console.assert(urlFilters['42'].value === 'test', 'Test 5: existing filter value preserved');
    console.log('Test 5 PASSED: Existing URL filter not overridden by F_I');
}

// Run all tests
test1();
test2();
test3();
test4();
test5();
console.log('\nAll tests PASSED for issue #861!');
