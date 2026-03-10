/**
 * Experiment to verify the fix for issue #793:
 * When filtering a table with object source, filters should use field IDs
 * (FR_18, FR_115, etc.) not sequential indices (FR_0, FR_1, FR_6, etc.)
 */

// Simulate the metadata from the issue
const metadata = {
    "id": "18",
    "up": "0",
    "type": "3",
    "val": "Пользователь",
    "unique": "1",
    "reqs": [
        { "num": 1, "id": "115", "val": "Роль", "orig": "42", "type": "3", "ref": "42", "ref_id": "114", "attrs": ":!NULL:164" },
        { "num": 2, "id": "41",  "val": "Email", "orig": "31", "type": "3", "attrs": ":!NULL:" },
        { "num": 3, "id": "30",  "val": "Телефон", "orig": "21", "type": "3" },
        { "num": 4, "id": "156", "val": "Дата", "orig": "155", "type": "9", "attrs": "[TODAY]" },
        { "num": 5, "id": "33",  "val": "Имя", "orig": "32", "type": "3" },
        { "num": 6, "id": "39",  "val": "Примечание", "orig": "35", "type": "12" },
    ]
};

// BEFORE FIX (sequential indices)
const columnsBefore = [];
columnsBefore.push({ id: '0', paramId: metadata.id });
metadata.reqs.forEach((req, idx) => {
    columnsBefore.push({ id: String(idx + 1), paramId: req.id });
});

console.log("=== BEFORE FIX (sequential indices) ===");
columnsBefore.forEach((col, i) => {
    const fieldName = i === 0 ? 'Пользователь' : metadata.reqs[i-1].val;
    console.log(`Column "${fieldName}": id=${col.id} -> filter key: FR_${col.id}`);
});

// AFTER FIX (real field IDs)
const columnsAfter = [];
columnsAfter.push({ id: String(metadata.id), paramId: metadata.id });
metadata.reqs.forEach((req, idx) => {
    columnsAfter.push({ id: String(req.id), paramId: req.id });
});

console.log("\n=== AFTER FIX (real field IDs) ===");
columnsAfter.forEach((col, i) => {
    const fieldName = i === 0 ? 'Пользователь' : metadata.reqs[i-1].val;
    console.log(`Column "${fieldName}": id=${col.id} -> filter key: FR_${col.id}`);
});

// Simulate what URL would be generated for filters: "Пользователь" starts with "ru", "Email" starts with "ad", "Примечание" starts with "vtv"
console.log("\n=== URL Parameters Generated ===");
console.log("BEFORE FIX (wrong):");
const filtersBefore = { '0': { value: 'ru%' }, '1': { value: 'ad%' }, '6': { value: 'vtv%' } };
Object.entries(filtersBefore).forEach(([colId, filter]) => {
    console.log(`  FR_${colId}=${filter.value}`);
});

console.log("AFTER FIX (correct):");
// Filter keys now use actual field IDs
const filtersAfter = { '18': { value: 'ru%' }, '41': { value: 'ad%' }, '39': { value: 'vtv%' } };
Object.entries(filtersAfter).forEach(([colId, filter]) => {
    console.log(`  FR_${colId}=${filter.value}`);
});

console.log("\n=== From issue: BAD URL ===");
console.log("https://ideav.ru/ru2/object/18/?JSON_OBJ&LIMIT=0,21&FR_0=ru%25&FR_1=ad%25&FR_6=vtv%25");
console.log("\n=== FIXED URL should be ===");
console.log("https://ideav.ru/ru2/object/18/?JSON_OBJ&LIMIT=0,21&FR_18=ru%25&FR_41=ad%25&FR_39=vtv%25");
