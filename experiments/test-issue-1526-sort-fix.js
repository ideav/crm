// Test the fix for issue #1526

const regularFields = [
    { num: 1, id: "115", val: "Роль" },
    { num: 2, id: "41", val: "Email" },
    { num: 3, id: "39", val: "Примечание" },
    { num: 4, id: "30", val: "Телефон" },
    { num: 5, id: "156", val: "Дата" },
    { num: 6, id: "33", val: "Имя" },
    { num: 7, id: "38", val: "Фото" },
    { num: 8, id: "124", val: "Activity" },
    { num: 9, id: "130", val: "Secret" },
    { num: 10, id: "20", val: "Password" },
    { num: 11, id: "125", val: "Token" },
    { num: 12, id: "40", val: "xsrf" },
    { num: 13, id: "301", val: "Retries" }
];

function sortWithFixedAlgorithm(regularFields, savedFieldOrder) {
    const sortedFields = [...regularFields];
    if (savedFieldOrder.length > 0) {
        const scale = regularFields.length + 1;

        const savedIndex = new Map();
        regularFields.forEach(req => {
            savedIndex.set(req.id, savedFieldOrder.indexOf(String(req.id)));
        });

        const sortKey = new Map();
        regularFields.forEach((req, natIdx) => {
            const idx = savedIndex.get(req.id);
            if (idx !== -1) {
                sortKey.set(req.id, idx * scale);
            } else {
                let nextSavedIdx = savedFieldOrder.length;
                for (let i = natIdx + 1; i < regularFields.length; i++) {
                    const si = savedIndex.get(regularFields[i].id);
                    if (si !== -1) { nextSavedIdx = si; break; }
                }
                sortKey.set(req.id, nextSavedIdx * scale - scale + natIdx + 1);
            }
        });

        sortedFields.sort((a, b) => sortKey.get(a.id) - sortKey.get(b.id));
    }
    return sortedFields;
}

function sortWithOldAlgorithm(regularFields, savedFieldOrder) {
    const sortedFields = [...regularFields];
    if (savedFieldOrder.length > 0) {
        sortedFields.sort((a, b) => {
            const idxA = savedFieldOrder.indexOf(String(a.id));
            const idxB = savedFieldOrder.indexOf(String(b.id));
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
    }
    return sortedFields;
}

function testCase(name, regularFields, savedOrder, expectedNums, newAlgo, oldAlgo) {
    const newResult = newAlgo(regularFields, savedOrder);
    const oldResult = oldAlgo(regularFields, savedOrder);
    const newNums = newResult.map(r => r.num).join(',');
    const oldNums = oldResult.map(r => r.num).join(',');
    const expected = expectedNums.join(',');
    const pass = newNums === expected;
    console.log(`${name}:`);
    console.log(`  Expected: ${expectedNums.map((n, i) => regularFields.find(r => r.num === n)?.val + '(' + n + ')').join(', ')}`);
    console.log(`  Old algo: ${oldResult.map(r => `${r.val}(${r.num})`).join(', ')}`);
    console.log(`  New algo: ${newResult.map(r => `${r.val}(${r.num})`).join(', ')}`);
    console.log(`  New algo: ${pass ? 'PASS ✓' : 'FAIL ✗'}`);
    return pass;
}

let allPassed = true;

// Test 1: Issue scenario - missing Фото ('38') and Password ('20')
{
    const savedOrder = ['115', '41', '39', '30', '156', '33', '124', '130', '125', '40', '301'];
    const pass = testCase(
        'Test 1: Missing Фото (38) and Password (20)',
        regularFields, savedOrder,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    allPassed = allPassed && pass;
}

// Test 2: All fields in savedFieldOrder (correct order)
{
    const savedOrder = ['115', '41', '39', '30', '156', '33', '38', '124', '130', '20', '125', '40', '301'];
    const pass = testCase(
        'Test 2: All fields saved (correct order)',
        regularFields, savedOrder,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    allPassed = allPassed && pass;
}

// Test 3: savedFieldOrder with custom user order (Password moved to position 3)
{
    const savedOrder = ['115', '41', '20', '39', '30', '156', '33', '38', '124', '130', '125', '40', '301'];
    const pass = testCase(
        'Test 3: Custom order (Password moved to pos 3)',
        regularFields, savedOrder,
        [1, 2, 10, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13], // Password(10) at pos 3
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    allPassed = allPassed && pass;
}

// Test 4: Empty savedFieldOrder (no cookie)
{
    const savedOrder = [];
    const pass = testCase(
        'Test 4: Empty savedFieldOrder',
        regularFields, savedOrder,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    allPassed = allPassed && pass;
}

// Test 5: savedFieldOrder missing only Retries ('301')
{
    const savedOrder = ['115', '41', '39', '30', '156', '33', '38', '124', '130', '20', '125', '40'];
    const pass = testCase(
        'Test 5: Missing only Retries (301)',
        regularFields, savedOrder,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    allPassed = allPassed && pass;
}

// Test 6: savedFieldOrder missing multiple consecutive fields (Activity, Secret, Password)
{
    const savedOrder = ['115', '41', '39', '30', '156', '33', '38', '125', '40', '301'];
    const pass = testCase(
        'Test 6: Missing consecutive Activity(8), Secret(9), Password(10)',
        regularFields, savedOrder,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    allPassed = allPassed && pass;
}

// Test 7: savedFieldOrder with only one field (edge case)
{
    const savedOrder = ['130']; // Only Secret
    const pass = testCase(
        'Test 7: Only one saved field (Secret)',
        regularFields, savedOrder,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], // Unsaved fields in natural order, Secret at pos 9
        sortWithFixedAlgorithm, sortWithOldAlgorithm
    );
    // The expected result for this test: fields before Secret in natural order,
    // then Secret, then fields after Secret
    // But since savedOrder only has Secret, fields before Secret are unsaved (nextSavedIdx=7 for all)
    // and fields after Secret are unsaved (nextSavedIdx=savedFieldOrder.length=1 for all → after Secret)
    // Let's see what the algorithm gives:
    const newResult = sortWithFixedAlgorithm(regularFields, savedOrder);
    console.log(`  Actual new algo result: ${newResult.map(r => `${r.val}(${r.num})`).join(', ')}`);
    allPassed = allPassed && pass;
}

console.log(`\n${allPassed ? 'All tests PASSED ✓' : 'SOME TESTS FAILED ✗'}`);
