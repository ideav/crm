/**
 * Test script for issue #587 - Suggestions deduplication
 * Tests the searchMetadata deduplication logic
 */

// Simulated metadata with duplicates
const globalMetadata = [
    { val: 'Поле', type: 4, id: 1 },  // Integer type
    { val: 'Поле', type: 4, id: 2 },  // Same name and type - should be deduplicated
    { val: 'Пользователь', type: 1, id: 3, referenced: true },  // Short string with reference
    { val: 'Название поля', type: 1, id: 4 },
    {
        val: 'Таблица',
        type: 1,
        id: 5,
        reqs: [
            { val: 'Поле', type: 4 },  // Same as top-level - should be deduplicated
            { val: 'Описание', type: 2 }
        ]
    }
];

// Simulated base types
const baseTypes = [
    { id: 1, name: 'Короткая строка (до 127 символов)' },
    { id: 2, name: 'Длинная строка' },
    { id: 4, name: 'Целое число' }
];

// Get base type name by id
const getBaseTypeName = (typeId) => {
    const type = baseTypes.find(t => t.id === parseInt(typeId));
    return type ? type.name : `Тип ${typeId}`;
};

// NEW searchMetadata function with deduplication (issue #587)
const searchMetadata = (searchTerm) => {
    if (!globalMetadata || !searchTerm || searchTerm.length < 1) {
        return [];
    }

    const term = searchTerm.toLowerCase();
    const results = [];
    // Track seen suggestions to prevent duplicates (issue #587)
    const seen = new Set();

    // Helper to create unique key for deduplication
    const getKey = (name, type, isReference) => `${name.toLowerCase()}|${type}|${isReference}`;

    // Search in top-level metadata items (tables)
    for (const item of globalMetadata) {
        const name = item.val || item.value || item.name || '';
        if (name.toLowerCase().includes(term)) {
            const type = item.type || item.id;
            const key = getKey(name, type, false);
            // Add as regular suggestion if not already seen
            if (!seen.has(key)) {
                seen.add(key);
                results.push({
                    name: name,
                    type: type,
                    isReference: false,
                    source: 'table',
                    item: item
                });
            }

            // If item has "referenced" key, add additional suggestion as "Справочник {Name}"
            if (item.referenced) {
                const refKey = getKey(name, type, true);
                if (!seen.has(refKey)) {
                    seen.add(refKey);
                    results.push({
                        name: name,
                        type: type,
                        isReference: true,
                        source: 'table',
                        item: item
                    });
                }
            }
        }

        // Also check if "Справочник {name}" matches the search term
        if (item.referenced && `справочник ${name}`.toLowerCase().includes(term)) {
            const type = item.type || item.id;
            const refKey = getKey(name, type, true);
            // Check if we haven't already added this reference suggestion
            if (!seen.has(refKey)) {
                seen.add(refKey);
                results.push({
                    name: name,
                    type: type,
                    isReference: true,
                    source: 'table',
                    item: item
                });
            }
        }

        // Search in reqs (requisites) of this item
        if (item.reqs && Array.isArray(item.reqs)) {
            for (const req of item.reqs) {
                const reqName = req.val || req.value || req.name || '';
                if (reqName.toLowerCase().includes(term)) {
                    const reqType = req.type;
                    const reqKey = getKey(reqName, reqType, false);
                    if (!seen.has(reqKey)) {
                        seen.add(reqKey);
                        results.push({
                            name: reqName,
                            type: reqType,
                            isReference: false,
                            source: 'requisite',
                            item: req
                        });
                    }
                }
            }
        }
    }

    // Return top 10 results
    return results.slice(0, 10);
};

// Test 1: Search "По" - should return unique results
console.log('Test 1: Search "По"');
const results1 = searchMetadata('По');
console.log(`Results count: ${results1.length}`);
results1.forEach((r, i) => {
    const typeName = getBaseTypeName(r.type);
    const displayName = r.isReference ? `Справочник ${r.name}` : r.name;
    console.log(`  ${i + 1}. ${displayName} (${typeName})`);
});

// Count "Поле (Целое число)" occurrences
const fieldCount = results1.filter(r =>
    r.name === 'Поле' && r.type === 4 && !r.isReference
).length;
console.log(`\n"Поле (Целое число)" occurrences: ${fieldCount}`);
console.log(fieldCount === 1 ? '✓ PASS: No duplicates' : '✗ FAIL: Duplicates found');

// Test 2: Search "Пользователь" - should include reference variant
console.log('\n\nTest 2: Search "Пользователь"');
const results2 = searchMetadata('Пользователь');
results2.forEach((r, i) => {
    const typeName = getBaseTypeName(r.type);
    const displayName = r.isReference ? `Справочник ${r.name}` : r.name;
    console.log(`  ${i + 1}. ${displayName} (${typeName})`);
});

// Should have both regular and reference
const hasRegular = results2.some(r => r.name === 'Пользователь' && !r.isReference);
const hasReference = results2.some(r => r.name === 'Пользователь' && r.isReference);
console.log(`\nHas regular: ${hasRegular}, Has reference: ${hasReference}`);
console.log(hasRegular && hasReference ? '✓ PASS: Both variants present' : '✗ FAIL');

console.log('\n--- All tests completed ---');
