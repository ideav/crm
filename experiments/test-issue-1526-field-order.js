// Test for issue #1526: Password field position after PR #1509

// Simulate the metadata from the issue
const metadata = {
    id: "18",
    up: "0",
    type: "3",
    val: "Пользователь",
    unique: "0",
    granted: "WRITE",
    referenced: "486",
    export: "1",
    delete: "1",
    reqs: [
        { num: 1, id: "115", val: "Роль", orig: "42", type: "3", ref: "42", ref_id: "114", attrs: ":!NULL:164" },
        { num: 2, id: "41", val: "Email", orig: "31", type: "3", attrs: ":!NULL:" },
        { num: 3, id: "39", val: "Примечание", orig: "35", type: "12" },
        { num: 4, id: "30", val: "Телефон", orig: "21", type: "3" },
        { num: 5, id: "156", val: "Дата", orig: "155", type: "9", attrs: "[TODAY]" },
        { num: 6, id: "33", val: "Имя", orig: "32", type: "3" },
        { num: 7, id: "38", val: "Фото", orig: "36", type: "10" },
        { num: 8, id: "124", val: "Activity", orig: "123", type: "4" },
        { num: 9, id: "130", val: "Secret", orig: "129", type: "3" },
        { num: 10, id: "20", val: "Password", orig: "19", type: "6" },
        { num: 11, id: "125", val: "Token", orig: "122", type: "6" },
        { num: 12, id: "40", val: "xsrf", orig: "37", type: "6" },
        { num: 13, id: "301", val: "Retries", orig: "300", type: "13" }
    ]
};

// Simulate fetchRecordData - builds recordReqs with order: idx
function buildRecordReqs(metadataReqs) {
    const recordReqs = {};
    metadataReqs.forEach((req, idx) => {
        recordReqs[req.id] = {
            value: `value_${req.id}`,
            base: req.type,
            order: idx
        };
    });
    return recordReqs;
}

// Simulate the sort in renderEditFormModal
function sortReqs(reqs, recordReqs) {
    return reqs.sort((a, b) => {
        const orderA = recordReqs[a.id] ? recordReqs[a.id].order || 0 : 0;
        const orderB = recordReqs[b.id] ? recordReqs[b.id].order || 0 : 0;
        return orderA - orderB;
    });
}

// Test 1: First form open
console.log("=== Test 1: Initial metadata order ===");
const metadataReqs1 = [...metadata.reqs]; // Copy to avoid mutation
const recordReqs1 = buildRecordReqs(metadataReqs1);
console.log("recordReqs orders:", Object.fromEntries(Object.entries(recordReqs1).map(([k, v]) => [k, v.order])));
console.log("Expected order:", metadataReqs1.map(r => `${r.val}(${r.num})`).join(', '));

// The sort in renderEditFormModal mutates the array in-place
const sortedReqs1 = sortReqs([...metadataReqs1], recordReqs1);
console.log("After sort:", sortedReqs1.map(r => `${r.val}(${r.num})`).join(', '));

// Test 2: Check applyFormFieldSettings - FILE type ID issue
console.log("\n=== Test 2: applyFormFieldSettings groupMap key for FILE field ===");

// Simulate querySelector finding 'field-38-file' for the FILE field
const fileInputId = 'field-38-file';
const regex = /^field-(.+?)(-search|-picker)?$/;
const match = fileInputId.match(regex);
console.log(`Input ID: "${fileInputId}"`);
console.log(`Regex match[1]: "${match ? match[1] : 'NO MATCH'}"`);
console.log(`Expected: "38", Got: "${match ? match[1] : 'NO MATCH'}"`);
console.log(`Bug exists: ${match && match[1] !== '38'}`);

// Also check normal inputs
const normalInputIds = ['field-20', 'field-125', 'field-40'];
normalInputIds.forEach(id => {
    const m = id.match(regex);
    console.log(`"${id}" -> match[1]: "${m ? m[1] : 'NO MATCH'}"`);
});

// Test 3: Simulate applyFormFieldSettings with saved order containing '38'
console.log("\n=== Test 3: applyFormFieldSettings with saved order ===");
const savedOrder = ['115', '41', '39', '30', '156', '33', '38', '124', '130', '20', '125', '40', '301'];

// Build groupMap as the function does
const groupMap = {};
const fieldIds = ['115', '41', '39', '30', '156', '33', '38-file', '124', '130', '20', '125', '40', '301']; // FILE field has 'file' suffix
fieldIds.forEach(id => {
    groupMap[id] = `<div id="${id}-group">`;
});

// Add 'main' group
groupMap['main'] = '<div id="main-group">';

const orderedGroups = [];
const usedIds = new Set();
if (groupMap['main']) {
    orderedGroups.push(groupMap['main']);
    usedIds.add('main');
}

savedOrder.forEach(fieldId => {
    if (groupMap[fieldId] && !usedIds.has(fieldId)) {
        orderedGroups.push(groupMap[fieldId]);
        usedIds.add(fieldId);
        console.log(`Found in savedOrder: "${fieldId}" -> added`);
    } else {
        console.log(`NOT in groupMap for savedOrder: "${fieldId}" -> SKIP`);
    }
});

// Remaining groups
Object.keys(groupMap).forEach(key => {
    if (!usedIds.has(key)) {
        console.log(`Remaining (appended at end): "${key}"`);
    }
});

// Test 4: Check renderAttributesForm sort with savedFieldOrder
console.log("\n=== Test 4: renderAttributesForm sort with savedFieldOrder ===");
const savedFieldOrder = ['115', '41', '39', '30', '156', '33', '38', '124', '130', '20', '125', '40', '301'];

const regularFields = metadata.reqs.filter(req => !req.arr_id);
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

console.log("sortedFields order:", sortedFields.map(r => `${r.val}(${r.num})`).join(', '));

// Test 5: What if savedFieldOrder doesn't have '20' (Password)?
console.log("\n=== Test 5: savedFieldOrder missing Password ('20') ===");
const savedFieldOrderMissing20 = ['115', '41', '39', '30', '156', '33', '38', '124', '130', '125', '40', '301'];

const sortedFields2 = [...regularFields];
if (savedFieldOrderMissing20.length > 0) {
    sortedFields2.sort((a, b) => {
        const idxA = savedFieldOrderMissing20.indexOf(String(a.id));
        const idxB = savedFieldOrderMissing20.indexOf(String(b.id));
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
}

console.log("sortedFields2 order (missing '20'):", sortedFields2.map(r => `${r.val}(${r.num})`).join(', '));
