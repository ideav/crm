// Test script for Role badge fix (Issue #835)
// Verifies that reference fields (with 'ref' attribute) are detected as status/badge fields
// Run with: node test_role_badge_fix.js

// Test data from issue #825 (metadata includes Роль field with ref attribute)
const metadata = {
    "id": "18",
    "up": "0",
    "type": "3",
    "val": "Пользователь",
    "unique": "1",
    "reqs": [
        {"num": 1, "id": "115", "val": "Роль", "orig": "42", "type": "3", "ref": "42", "ref_id": "114", "attrs": ":!NULL:164"},
        {"num": 2, "id": "41", "val": "Email", "orig": "31", "type": "3", "attrs": ":!NULL:"},
        {"num": 3, "id": "30", "val": "Телефон", "orig": "21", "type": "3"},
        {"num": 4, "id": "156", "val": "Дата", "orig": "155", "type": "9", "attrs": "[TODAY]"},
        {"num": 5, "id": "33", "val": "Имя", "orig": "32", "type": "3"},
        {"num": 6, "id": "39", "val": "Примечание", "orig": "35", "type": "12"},
        {"num": 7, "id": "38", "val": "Фото", "orig": "36", "type": "10"},
        {"num": 8, "id": "124", "val": "Activity", "orig": "123", "type": "4"},
        {"num": 9, "id": "130", "val": "Secret", "orig": "129", "type": "3"},
        {"num": 10, "id": "20", "val": "Password", "orig": "19", "type": "6"},
        {"num": 11, "id": "125", "val": "Token", "orig": "122", "type": "6"},
        {"num": 12, "id": "40", "val": "xsrf", "orig": "37", "type": "6"},
        {"num": 13, "id": "468", "val": "Тег", "orig": "466", "type": "3", "ref": "466", "ref_id": "467", "attrs": ":MULTI:"}
    ]
};

const objectData = [{"i": 287, "u": 1, "o": 0, "r": ["ru2", "145:admin", "drynny@mail.ru", "89955060167", "26.02.2026", "Мефистоклюс", "Администратор системы, ноукодер", "", "12.03.2026 12:54:54", "", "", "******", "******", "469,471,473:МО,VIP,ЧС"]}];

// Type helpers (same as in cards.html)
const TEXT_TYPES = new Set(['3', '8', '12', '17']);
const DATE_TYPES = new Set(['9', '4']);
const NUM_TYPES = new Set(['13', '14']);
const LIST_TYPES = new Set(['5', '16']);

function isTextType(t) { return TEXT_TYPES.has(String(t)); }
function isDateType(t) { return DATE_TYPES.has(String(t)); }
function isNumType(t) { return NUM_TYPES.has(String(t)); }
function isListType(t) { return LIST_TYPES.has(String(t)); }
function isRefField(col) { return col && col.ref != null && col.ref !== ''; }

function isPhoneField(name) { return /телефон|phone/i.test(name); }
function isEmailField(name) { return /email|почта/i.test(name); }
function isColorField(name) { return /цвет|color/i.test(name); }

// Build columns from metadata (FIXED: includes ref attribute)
function buildColumnsFromMetadata(m) {
    const cols = [];
    cols.push({ id: String(m.id), name: m.val || m.name || 'Значение', type: String(m.type || '3'), ref: m.ref || null });
    if (m.reqs && Array.isArray(m.reqs)) {
        m.reqs.forEach(function(req) {
            cols.push({ id: String(req.id), name: req.val || req.name || '', type: String(req.type || '3'), ref: req.ref || null });
        });
    }
    return cols;
}

// OLD buggy detection (doesn't detect reference fields)
function detectAutoFieldsOld(cols) {
    const textIdx = [];
    const dateIdx = [];
    const numIdx = [];
    const listIdx = [];
    let phoneIdx = -1;
    let emailIdx = -1;
    let colorIdx = -1;

    for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const t = col.type;
        const name = col.name || '';

        if (isPhoneField(name)) {
            phoneIdx = i;
        } else if (isEmailField(name)) {
            emailIdx = i;
        } else if (isColorField(name)) {
            colorIdx = i;
        } else if (isTextType(t)) {
            textIdx.push(i);
        } else if (isDateType(t)) {
            dateIdx.push(i);
        } else if (isNumType(t)) {
            numIdx.push(i);
        } else if (isListType(t)) {
            listIdx.push(i);
        }
    }

    return { textIdx, dateIdx, numIdx, listIdx, phoneIdx, emailIdx, colorIdx };
}

// NEW fixed detection (treats reference fields as list/status fields)
function detectAutoFieldsFixed(cols) {
    const textIdx = [];
    const dateIdx = [];
    const numIdx = [];
    const listIdx = [];
    let phoneIdx = -1;
    let emailIdx = -1;
    let colorIdx = -1;

    for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const t = col.type;
        const name = col.name || '';

        if (isPhoneField(name)) {
            phoneIdx = i;
        } else if (isEmailField(name)) {
            emailIdx = i;
        } else if (isColorField(name)) {
            colorIdx = i;
        } else if (isListType(t) || isRefField(col)) {
            // Reference fields (справочник) should also be treated as list/status fields for badge display
            listIdx.push(i);
        } else if (isTextType(t)) {
            textIdx.push(i);
        } else if (isDateType(t)) {
            dateIdx.push(i);
        } else if (isNumType(t)) {
            numIdx.push(i);
        }
    }

    return { textIdx, dateIdx, numIdx, listIdx, phoneIdx, emailIdx, colorIdx };
}

// Parse row values (same logic as in cards.html, with PR #826 fix)
function parseRow(item) {
    const row = [];
    const vals = item.r || [];
    for (let i = 0; i < vals.length; i++) {
        let v = vals[i];
        if (typeof v === 'string' && v.indexOf(':') !== -1) {
            const parts = v.split(':');
            row.push(parts.slice(1).join(':'));
        } else {
            row.push(v);
        }
    }
    return row;
}

// Main test
console.log("=== Role Badge Fix Test (Issue #835) ===\n");

const cols = buildColumnsFromMetadata(metadata);
const row = parseRow(objectData[0]);

console.log("Columns built from metadata:");
cols.forEach((col, i) => {
    const refInfo = col.ref ? ` [ref: ${col.ref}]` : '';
    console.log(`  [${i}] ${col.name} (type: ${col.type})${refInfo}`);
});

console.log("\n--- OLD (BUGGY) field detection ---");
const oldFields = detectAutoFieldsOld(cols);
console.log("List/Status field indices:", oldFields.listIdx);
console.log("Text field indices:", oldFields.textIdx);

// Check if Роль (index 1) is detected as a list/status field
const roleIdx = 1;  // Роль is the first req, so it's at index 1
const roleInOldList = oldFields.listIdx.includes(roleIdx);
console.log(`Роль field (index ${roleIdx}) in list/status?: ${roleInOldList ? 'YES' : 'NO'}`);
if (oldFields.listIdx.length > 0) {
    console.log(`First status field will be: ${cols[oldFields.listIdx[0]].name} = "${row[oldFields.listIdx[0]]}"`);
} else {
    console.log("No status field will be shown (bug!)");
}

console.log("\n--- NEW (FIXED) field detection ---");
const fixedFields = detectAutoFieldsFixed(cols);
console.log("List/Status field indices:", fixedFields.listIdx);
console.log("Text field indices:", fixedFields.textIdx);

const roleInFixedList = fixedFields.listIdx.includes(roleIdx);
console.log(`Роль field (index ${roleIdx}) in list/status?: ${roleInFixedList ? 'YES' : 'NO'}`);
if (fixedFields.listIdx.length > 0) {
    console.log(`First status field will be: ${cols[fixedFields.listIdx[0]].name} = "${row[fixedFields.listIdx[0]]}"`);
}

console.log("\n=== Expected Card Rendering ===");
console.log(`Title (.cards-card-title): "${row[fixedFields.textIdx[0]]}" (from ${cols[fixedFields.textIdx[0]].name})`);
console.log(`Description (.cards-card-description): "${row[fixedFields.textIdx[1]]}" (from ${cols[fixedFields.textIdx[1]].name})`);
console.log(`Date (.cards-card-date): "${row[fixedFields.dateIdx[0]]}" (from ${cols[fixedFields.dateIdx[0]].name})`);
console.log(`Status badge (.cards-card-status): "${row[fixedFields.listIdx[0]]}" (from ${cols[fixedFields.listIdx[0]].name})`);
console.log(`Phone (.pi-phone): "${row[fixedFields.phoneIdx]}" (from ${cols[fixedFields.phoneIdx].name})`);
console.log(`Email (.pi-envelope): "${row[fixedFields.emailIdx]}" (from ${cols[fixedFields.emailIdx].name})`);

console.log("\n=== TEST RESULTS ===");
const tests = {
    "Роль has ref attribute": isRefField(cols[roleIdx]),
    "Роль NOT in OLD list (bug exists)": !roleInOldList,
    "Роль IN FIXED list (bug fixed)": roleInFixedList,
    "Title is ru2": row[fixedFields.textIdx[0]] === "ru2",
    "Status badge shows admin": row[fixedFields.listIdx[0]] === "admin",
    "Phone shows 89955060167": row[fixedFields.phoneIdx] === "89955060167",
    "Email shows drynny@mail.ru": row[fixedFields.emailIdx] === "drynny@mail.ru"
};

let allPassed = true;
for (const [testName, passed] of Object.entries(tests)) {
    console.log(`${passed ? '✓' : '✗'} ${testName}`);
    if (!passed) allPassed = false;
}

console.log("\n" + (allPassed ? "✓ ALL TESTS PASSED - Role badge fix is valid!" : "✗ SOME TESTS FAILED"));
process.exit(allPassed ? 0 : 1);
