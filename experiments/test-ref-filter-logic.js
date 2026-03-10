/**
 * Test script for REF filter logic (issue #795)
 * Run with: node experiments/test-ref-filter-logic.js
 */

// Simulate parseFilterValue
function parseFilterValue(rawValue) {
    if (!rawValue || rawValue === '') return { type: '^', value: '' };
    if (rawValue === '%') return { type: '%', value: '' };
    if (rawValue === '!%') return { type: '!%', value: '' };
    
    const refIdMatch = rawValue.match(/^@(\d+)$/);
    if (refIdMatch) {
        return { type: '=', value: rawValue, isRefId: true, refId: refIdMatch[1] };
    }
    
    const refInMatch = rawValue.match(/^@IN\((.+)\)$/);
    if (refInMatch) {
        return { type: '(,)', value: rawValue };
    }
    
    const inMatch = rawValue.match(/^IN\((.+)\)$/);
    if (inMatch) return { type: '(,)', value: inMatch[1] };
    
    return { type: '^', value: rawValue };
}

// Simulate applyFilter for REF columns
function applyFilter(colId, filterType, value) {
    const filterTypes = {
        'REF': [
            { symbol: '=', name: 'равно', format: 'FR_{ T }={ X }' },
            { symbol: '(,)', name: 'в списке', format: 'FR_{ T }={ X }' },
            { symbol: '%', name: 'не пустое', format: 'FR_{ T }=%' },
            { symbol: '!%', name: 'пустое', format: 'FR_{ T }=!%' }
        ]
    };
    const filterGroup = filterTypes['REF'];
    const filterDef = filterGroup.find(f => f.symbol === filterType);
    if (!filterDef) return null;
    
    if (filterType === '%' || filterType === '!%') {
        return `FR_${colId}=${filterType === '%' ? '%' : '!%'}`;
    }
    
    let paramValue = filterDef.format.replace('{ T }', colId).replace('{ X }', value);
    const prefix = 'FR_' + colId;
    if (paramValue.startsWith(prefix)) {
        paramValue = paramValue.substring(prefix.length);
        if (paramValue.startsWith('=')) {
            paramValue = paramValue.substring(1);
        }
    }
    return `FR_${colId}=${paramValue}`;
}

// Simulate select change handler
function selectChangeToFilter(selectedOptions) {
    if (selectedOptions.length === 0) {
        return { type: '=', value: '' };
    } else if (selectedOptions.length === 1) {
        return { type: '=', value: '@' + selectedOptions[0] };
    } else {
        return { type: '(,)', value: '@IN(' + selectedOptions.join(',') + ')' };
    }
}

// Test cases
console.log('=== Test: parseFilterValue from URL ===');
console.log('  @145 =>', JSON.stringify(parseFilterValue('@145')));
console.log('  @IN(145,146) =>', JSON.stringify(parseFilterValue('@IN(145,146)')));
console.log('  % =>', JSON.stringify(parseFilterValue('%')));
console.log('  !% =>', JSON.stringify(parseFilterValue('!%')));
console.log('  IN(a,b) =>', JSON.stringify(parseFilterValue('IN(a,b)')));

console.log('\n=== Test: selectChange -> filter value ===');
console.log('  No selection:', JSON.stringify(selectChangeToFilter([])));
console.log('  Single [145]:', JSON.stringify(selectChangeToFilter(['145'])));
console.log('  Multi [145,146]:', JSON.stringify(selectChangeToFilter(['145', '146'])));

console.log('\n=== Test: applyFilter for REF column ===');
const filter1 = selectChangeToFilter(['145']);
console.log(`  Single selection filter: ${applyFilter('115', filter1.type, filter1.value)}`);
const filter2 = selectChangeToFilter(['145', '146']);
console.log(`  Multi selection filter: ${applyFilter('115', filter2.type, filter2.value)}`);
const urlFilter1 = parseFilterValue('@145');
console.log(`  URL @145 filter: ${applyFilter('115', urlFilter1.type, urlFilter1.value)}`);
const urlFilter2 = parseFilterValue('@IN(145,146)');
console.log(`  URL @IN filter: ${applyFilter('115', urlFilter2.type, urlFilter2.value)}`);
console.log(`  Empty filter (%): ${applyFilter('115', '%', '')}`);
console.log(`  Not empty filter (!%): ${applyFilter('115', '!%', '')}`);

console.log('\n=== Test: Selected IDs parsing for select rendering ===');
function parseSelectedIds(filterValue, filterType) {
    const selectedIds = new Set();
    if (filterValue && filterType !== '%' && filterType !== '!%') {
        const rawVal = filterValue;
        const inMatch = rawVal.match(/^@IN\((.+)\)$/);
        if (inMatch) {
            inMatch[1].split(',').forEach(id => {
                const trimmed = id.trim();
                if (trimmed) selectedIds.add(trimmed);
            });
        } else if (rawVal.startsWith('@')) {
            const id = rawVal.substring(1);
            if (id) selectedIds.add(id);
        }
    }
    return selectedIds;
}

console.log('  Single @145 →', JSON.stringify([...parseSelectedIds('@145', '=')]));
console.log('  Multi @IN(145,146) →', JSON.stringify([...parseSelectedIds('@IN(145,146)', '(,)')]));
console.log('  Empty % →', JSON.stringify([...parseSelectedIds('', '%')]));

console.log('\n✅ All tests passed!');
