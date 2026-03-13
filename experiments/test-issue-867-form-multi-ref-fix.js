/**
 * Test for issue #867: form multi-select reference editor still shows raw IDs.
 *
 * Root cause: initFormMultiReferenceEditor naively split currentRawValue by ','
 * getting ["469", "471", "473:М'О \"врот\"", "VIP", "ЧС"] (5 items) instead of
 * parsing the "id1,id2,...:val1,val2,..." format to get IDs ["469","471","473"].
 *
 * Fix: check for ':' in currentRawValue and use the ids:values parsing path
 * (same logic as renderMultiReferenceEditor in the inline table editor).
 */

// Simulate options returned by fetchReferenceOptions
const options = [
    ['469', 'М\'О "врот"'],
    ['471', 'VIP'],
    ['473', 'ЧС'],
    ['474', 'Other'],
];

// Raw value as stored in the record (issue #863 format)
const RAW_VALUE = '469,471,473:М\'О "врот",VIP,ЧС';

// --- OLD (broken) logic ---
function oldParsing(currentRawValue, options) {
    const currentTexts = currentRawValue
        ? currentRawValue.split(',').map(v => v.trim()).filter(v => v.length > 0)
        : [];
    const selectedItems = [];
    for (const text of currentTexts) {
        const match = options.find(([id, t]) => t === text);
        if (match) {
            selectedItems.push({ id: match[0], text: match[1] });
        } else if (text) {
            selectedItems.push({ id: '', text });
        }
    }
    return selectedItems;
}

// --- NEW (fixed) logic ---
function newParsing(currentRawValue, options) {
    const selectedItems = [];
    const rawColonIndex = currentRawValue.indexOf(':');
    if (currentRawValue && rawColonIndex > 0) {
        const ids = currentRawValue.substring(0, rawColonIndex).split(',').map(v => v.trim()).filter(v => v.length > 0);
        for (const id of ids) {
            const match = options.find(([optId]) => String(optId) === id);
            if (match) {
                selectedItems.push({ id: match[0], text: match[1] });
            } else {
                selectedItems.push({ id, text: id });
            }
        }
    } else {
        const currentTexts = currentRawValue
            ? currentRawValue.split(',').map(v => v.trim()).filter(v => v.length > 0)
            : [];
        for (const text of currentTexts) {
            const match = options.find(([id, t]) => t === text);
            if (match) {
                selectedItems.push({ id: match[0], text: match[1] });
            } else if (text) {
                selectedItems.push({ id: '', text });
            }
        }
    }
    return selectedItems;
}

let allPassed = true;

// Test 1: OLD logic produces wrong 5-item result (reproduces the bug)
{
    const result = oldParsing(RAW_VALUE, options);
    const expected = [
        { id: '', text: '469' },
        { id: '', text: '471' },
        { id: '', text: '473:М\'О "врот"' },
        { id: '471', text: 'VIP' },
        { id: '473', text: 'ЧС' },
    ];
    const pass = result.length === 5
        && result[0].id === '' && result[0].text === '469'
        && result[2].text === '473:М\'О "врот"'
        && result[3].id === '471';
    if (pass) {
        console.log('PASS [old logic reproduces bug]: got 5 wrong items including "469" with empty id');
    } else {
        console.error('UNEXPECTED [old logic]: did not reproduce expected bug pattern');
        console.error('  got:', JSON.stringify(result));
        allPassed = false;
    }
}

// Test 2: NEW logic produces correct 3-item result
{
    const result = newParsing(RAW_VALUE, options);
    if (result.length !== 3) {
        console.error(`FAIL [new logic count]: expected 3 items, got ${result.length}`);
        console.error('  items:', JSON.stringify(result));
        allPassed = false;
    } else if (result[0].id !== '469' || result[0].text !== 'М\'О "врот"') {
        console.error(`FAIL [new logic item 0]: expected {id:'469', text:"М'О \"врот\""}, got`, JSON.stringify(result[0]));
        allPassed = false;
    } else if (result[1].id !== '471' || result[1].text !== 'VIP') {
        console.error(`FAIL [new logic item 1]: expected {id:'471', text:'VIP'}, got`, JSON.stringify(result[1]));
        allPassed = false;
    } else if (result[2].id !== '473' || result[2].text !== 'ЧС') {
        console.error(`FAIL [new logic item 2]: expected {id:'473', text:'ЧС'}, got`, JSON.stringify(result[2]));
        allPassed = false;
    } else {
        console.log('PASS [new logic]: 3 correct items');
        result.forEach(({ id, text }) => console.log(`  id=${id}, text=${text}`));
    }
}

// Test 3: Fallback path still works (plain comma-separated display names, no colon)
{
    const plainValue = 'VIP,ЧС';
    const result = newParsing(plainValue, options);
    if (result.length !== 2 || result[0].id !== '471' || result[1].id !== '473') {
        console.error('FAIL [fallback path]: plain value not parsed correctly', JSON.stringify(result));
        allPassed = false;
    } else {
        console.log('PASS [fallback path]: plain display names resolved correctly');
    }
}

// Test 4: Empty value
{
    const result = newParsing('', options);
    if (result.length !== 0) {
        console.error('FAIL [empty value]:', JSON.stringify(result));
        allPassed = false;
    } else {
        console.log('PASS [empty value]: empty string returns empty array');
    }
}

// Test 5: Single value with id:value format (single colon)
{
    const singleValue = '469:М\'О "врот"';
    const result = newParsing(singleValue, options);
    if (result.length !== 1 || result[0].id !== '469') {
        console.error('FAIL [single value]:', JSON.stringify(result));
        allPassed = false;
    } else {
        console.log('PASS [single value]: single ids:values item resolved correctly');
    }
}

console.log(allPassed ? '\n✓ All tests passed' : '\n✗ Some tests failed');
