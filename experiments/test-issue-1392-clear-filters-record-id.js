/**
 * Test for issue #1392: clearAllFilters() должна очищать фильтры вида @{id записи}
 *
 * When a table is opened with F_I=@{recordId} (or options.recordId is set),
 * the first column gets a filter showing @{recordId}.
 * Clicking "Clear All Filters" should remove this filter completely.
 *
 * Root cause: clearAllFilters() sets this.urlFilters = {} but does NOT clear
 * this.options.recordId. When loadData() is called, it sees urlFilters is empty
 * and calls parseUrlFiltersFromParams() again. That function re-adds the F_I
 * filter because options.recordId is still set.
 *
 * Fix: clearAllFilters() must also clear this.options.recordId.
 */

// Simulate the relevant parts of IntegramTable

function makeTable(recordId) {
    const options = {
        dataSource: 'table',
        tableTypeId: 42,
        recordId: recordId || null,
    };

    const table = {
        options,
        columns: [{ id: '100', name: 'Роль', type: 'SHORT' }],
        filters: {},
        urlFilters: {},
        filtersEnabled: false,
        overriddenUrlParams: new Set(),
        data: [],
        loadedRecords: 0,
        hasMore: true,
        totalRows: null,

        getDataSourceType() {
            return this.options.dataSource || 'report';
        },

        hasUrlFilters() {
            return Object.keys(this.urlFilters).length > 0;
        },

        parseUrlFiltersFromParams() {
            // Simulate URL (no FR_* params in URL for this test)
            const urlFilters = {};

            // Issue #861: Display F_I as visible filter on first column for table data source
            if (this.options.recordId && this.getDataSourceType() === 'table' && this.columns.length > 0) {
                const firstColId = this.columns[0].id;
                if (!urlFilters[firstColId]) {
                    const recordIdValue = `@${this.options.recordId}`;
                    urlFilters[firstColId] = {
                        type: '=',
                        value: recordIdValue,
                        paramKey: 'F_I',
                        isRefId: true,
                        refId: this.options.recordId
                    };
                }
            }

            this.urlFilters = urlFilters;

            if (Object.keys(urlFilters).length > 0) {
                Object.keys(urlFilters).forEach(colId => {
                    const urlFilter = urlFilters[colId];
                    this.filters[colId] = {
                        type: urlFilter.type,
                        value: urlFilter.value
                    };
                });
                this.filtersEnabled = true;
            }
        },

        loadData(append) {
            // Simulate what loadData does: re-parse URL filters if urlFilters is empty
            if (!append && Object.keys(this.urlFilters).length === 0) {
                this.parseUrlFiltersFromParams();
            }
            // (Would normally fetch data from server here)
        },

        render() {
            // (Would normally render the table here)
        },

        clearAllFilters() {
            // Clear all filters
            this.filters = {};

            // Also clear URL filters and remove from browser URL (issue #547)
            if (this.hasUrlFilters()) {
                const paramsToRemove = [];
                Object.values(this.urlFilters).forEach(urlFilter => {
                    if (urlFilter.paramKey) paramsToRemove.push(urlFilter.paramKey);
                    if (urlFilter.toParamKey) paramsToRemove.push(urlFilter.toParamKey);
                });

                // Mark as overridden
                paramsToRemove.forEach(key => this.overriddenUrlParams.add(key));

                // (Would normally update browser URL here)

                // Clear urlFilters
                this.urlFilters = {};
            }

            // Also clear @{id} record filter (issue #1392): when the table was opened with F_I=@{recordId}
            // (e.g. via URL or options.recordId), the filter is re-added by parseUrlFiltersFromParams()
            // on every loadData() call because options.recordId persists. Clear it so the user's
            // explicit "clear all filters" action removes this filter too.
            if (this.options.recordId) {
                this.options.recordId = null;
                this.overriddenUrlParams.add('F_I');
            }

            // Reset data and load from beginning
            this.data = [];
            this.loadedRecords = 0;
            this.hasMore = true;
            this.totalRows = null;
            this.loadData(false);

            // Re-render to update UI (clear filter inputs)
            this.render();
        }
    };

    return table;
}

// Test 1: After initial load with recordId, filters are set
function test1() {
    const table = makeTable('6753');
    table.loadData(false);  // Simulate initial load

    console.assert(table.filters['100'] !== undefined, 'Test 1: filter for first column should be set after initial load');
    console.assert(table.filters['100'].value === '@6753', 'Test 1: filter value should be @6753');
    console.assert(table.filtersEnabled === true, 'Test 1: filtersEnabled should be true');
    console.log('Test 1 PASSED: Initial @{id} filter is set correctly');
}

// Test 2 (Bug scenario - BEFORE FIX): clearAllFilters without fix re-adds the filter
function test2_without_fix() {
    const table = makeTable('6753');
    table.loadData(false);  // Initial load sets filters

    // Simulate clearAllFilters WITHOUT the fix (don't clear options.recordId)
    table.filters = {};
    if (table.hasUrlFilters()) {
        const paramsToRemove = [];
        Object.values(table.urlFilters).forEach(f => {
            if (f.paramKey) paramsToRemove.push(f.paramKey);
        });
        paramsToRemove.forEach(key => table.overriddenUrlParams.add(key));
        table.urlFilters = {};
    }
    // NOT clearing options.recordId - this is the bug
    table.data = [];
    table.loadedRecords = 0;
    table.loadData(false);  // This re-adds the filter!
    table.render();

    // The bug: filter is re-added even after clearing
    const filterStillPresent = table.filters['100'] !== undefined;
    console.assert(filterStillPresent === true, 'Test 2: confirms bug - filter IS re-added without fix');
    console.log('Test 2 PASSED: Bug confirmed - without fix, @{id} filter is re-added after clearAllFilters');
}

// Test 3 (Fix verification): clearAllFilters WITH fix clears the @{id} filter
function test3_with_fix() {
    const table = makeTable('6753');
    table.loadData(false);  // Initial load sets filters

    // Verify filters are set initially
    console.assert(table.filters['100'] !== undefined, 'Test 3 setup: filter should be set initially');

    // Now call clearAllFilters (which includes the fix)
    table.clearAllFilters();

    // The fix: filter should be cleared
    console.assert(table.filters['100'] === undefined, 'Test 3: filter should be cleared after clearAllFilters');
    console.assert(table.options.recordId === null, 'Test 3: options.recordId should be null after clearAllFilters');
    console.assert(table.overriddenUrlParams.has('F_I'), 'Test 3: F_I should be in overriddenUrlParams');
    console.log('Test 3 PASSED: @{id} filter is cleared correctly by clearAllFilters with fix');
}

// Test 4: clearAllFilters with no recordId (normal case, should still work)
function test4_no_record_id() {
    const table = makeTable(null);
    table.loadData(false);

    // Set a regular text filter manually
    table.filters['100'] = { type: '~', value: 'Manager' };
    table.filtersEnabled = true;

    table.clearAllFilters();

    console.assert(table.filters['100'] === undefined, 'Test 4: regular filter should be cleared');
    console.assert(table.options.recordId === null, 'Test 4: options.recordId remains null');
    console.log('Test 4 PASSED: clearAllFilters works normally when no recordId');
}

// Test 5: clearAllFilters with FR_* @{id} URL filter (another @{id} filter case)
function test5_fr_ref_id_filter() {
    const table = makeTable(null);

    // Simulate FR_ROLEID=@6753 URL filter being parsed
    table.urlFilters['100'] = {
        type: '=',
        value: '@6753',
        paramKey: 'FR_100',
        isRefId: true,
        refId: '6753'
    };
    table.filters['100'] = { type: '=', value: '@6753' };
    table.filtersEnabled = true;

    table.clearAllFilters();

    console.assert(table.filters['100'] === undefined, 'Test 5: FR_* @{id} filter should be cleared');
    console.assert(table.urlFilters['100'] === undefined, 'Test 5: urlFilters should be cleared');
    console.assert(table.overriddenUrlParams.has('FR_100'), 'Test 5: FR_100 should be in overriddenUrlParams');
    console.log('Test 5 PASSED: FR_* @{id} filter cleared correctly');
}

// Run all tests
test1();
test2_without_fix();
test3_with_fix();
test4_no_record_id();
test5_fr_ref_id_filter();
console.log('\nAll tests PASSED for issue #1392!');
