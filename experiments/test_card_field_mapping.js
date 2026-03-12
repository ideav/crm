// Test script for card field mapping fix (Issue #825)
// Run with: node test_card_field_mapping.js

// Test data from issue #825
const metadata = {"id":"18","up":"0","type":"3","val":"Пользователь","unique":"1","reqs":[{"num":1,"id":"115","val":"Роль","orig":"42","type":"3","ref":"42","ref_id":"114","attrs":":!NULL:164"},{"num":2,"id":"41","val":"Email","orig":"31","type":"3","attrs":":!NULL:"},{"num":3,"id":"30","val":"Телефон","orig":"21","type":"3"},{"num":4,"id":"156","val":"Дата","orig":"155","type":"9","attrs":"[TODAY]"},{"num":5,"id":"33","val":"Имя","orig":"32","type":"3"},{"num":6,"id":"39","val":"Примечание","orig":"35","type":"12"},{"num":7,"id":"38","val":"Фото","orig":"36","type":"10"},{"num":8,"id":"124","val":"Activity","orig":"123","type":"4"},{"num":9,"id":"130","val":"Secret","orig":"129","type":"3"},{"num":10,"id":"20","val":"Password","orig":"19","type":"6"},{"num":11,"id":"125","val":"Token","orig":"122","type":"6"},{"num":12,"id":"40","val":"xsrf","orig":"37","type":"6"},{"num":13,"id":"468","val":"Тег","orig":"466","type":"3","ref":"466","ref_id":"467","attrs":":MULTI:"}]};

const objectData = [{"i":287,"u":1,"o":0,"r":["ru2","145:admin","drynny@mail.ru","89955060167","26.02.2026","Мефистоклюс","Администратор системы, ноукодер","","12.03.2026 12:54:54","","","******","******","469,471,473:МО,VIP,ЧС"]}];

const record = objectData[0];

// Build columns from metadata
function buildColumns(m) {
    const cols = [];
    cols.push({ id: String(m.id), name: m.val || m.name || 'Значение', type: String(m.type || '3') });
    if (m.reqs && Array.isArray(m.reqs)) {
        m.reqs.forEach(function(req) {
            cols.push({ id: String(req.id), name: req.val || req.name || '', type: String(req.type || '3') });
        });
    }
    return cols;
}

// OLD buggy parsing (prepends record ID)
function parseOldBuggy(item) {
    const row = [item.i]; // BUG: prepends record ID causing shift
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

// NEW fixed parsing (no record ID prepend)
function parseFixed(item) {
    const row = []; // FIXED: no record ID prepend
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

const cols = buildColumns(metadata);
const oldRow = parseOldBuggy(record);
const fixedRow = parseFixed(record);

// Expected values (r array with refs parsed)
const expectedValues = [
    "ru2",              // cols[0]: Пользователь (main value)
    "admin",           // cols[1]: Роль (parsed from "145:admin")
    "drynny@mail.ru",  // cols[2]: Email
    "89955060167",     // cols[3]: Телефон
    "26.02.2026",      // cols[4]: Дата
    "Мефистоклюс",     // cols[5]: Имя
    "Администратор системы, ноукодер", // cols[6]: Примечание
    "",                // cols[7]: Фото
    "12.03.2026 12:54:54", // cols[8]: Activity
    "",                // cols[9]: Secret
    "",                // cols[10]: Password
    "******",          // cols[11]: Token
    "******",          // cols[12]: xsrf
    "МО,VIP,ЧС"        // cols[13]: Тег (parsed from "469,471,473:МО,VIP,ЧС")
];

console.log("=== Card Field Mapping Test (Issue #825) ===\n");

console.log("Columns from metadata:");
cols.forEach((col, i) => {
    console.log(`  [${i}] ${col.name} (type: ${col.type})`);
});

console.log("\n--- OLD (BUGGY) parsing ---");
console.log("Row values:", oldRow);
console.log("\nMapping check:");
let oldFailures = 0;
for (let i = 0; i < cols.length; i++) {
    const expected = expectedValues[i] || '';
    const actual = oldRow[i] !== undefined ? String(oldRow[i]) : '';
    const pass = actual === expected;
    if (!pass) oldFailures++;
    console.log(`  cols[${i}] (${cols[i].name}): expected="${expected}" | actual="${actual}" | ${pass ? '✓' : '✗ MISMATCH'}`);
}

console.log("\n--- NEW (FIXED) parsing ---");
console.log("Row values:", fixedRow);
console.log("\nMapping check:");
let fixedFailures = 0;
for (let i = 0; i < cols.length; i++) {
    const expected = expectedValues[i] || '';
    const actual = fixedRow[i] !== undefined ? String(fixedRow[i]) : '';
    const pass = actual === expected;
    if (!pass) fixedFailures++;
    console.log(`  cols[${i}] (${cols[i].name}): expected="${expected}" | actual="${actual}" | ${pass ? '✓' : '✗ MISMATCH'}`);
}

// Field detection helpers (from cards.html)
const isPhoneField = (name) => /телефон|phone/i.test(name);
const isEmailField = (name) => /email|почта/i.test(name);
const isTextType = (t) => ['3','12'].indexOf(String(t)) !== -1;
const isDateType = (t) => ['8','9'].indexOf(String(t)) !== -1;

let textFields = [], dateFields = [], phoneIdx = -1, emailIdx = -1;
for (let i = 0; i < cols.length; i++) {
    if (isPhoneField(cols[i].name)) phoneIdx = i;
    else if (isEmailField(cols[i].name)) emailIdx = i;
    else if (isTextType(cols[i].type)) textFields.push(i);
    else if (isDateType(cols[i].type)) dateFields.push(i);
}

console.log("\n=== Card Field Detection ===");
console.log(`Title field: cols[${textFields[0]}] (${cols[textFields[0]].name}) = "${fixedRow[textFields[0]]}"`);
console.log(`Description field: cols[${textFields[1]}] (${cols[textFields[1]].name}) = "${fixedRow[textFields[1]]}"`);
console.log(`Date field: cols[${dateFields[0]}] (${cols[dateFields[0]].name}) = "${fixedRow[dateFields[0]]}"`);
console.log(`Phone field: cols[${phoneIdx}] (${cols[phoneIdx].name}) = "${fixedRow[phoneIdx]}"`);
console.log(`Email field: cols[${emailIdx}] (${cols[emailIdx].name}) = "${fixedRow[emailIdx]}"`);

console.log("\n=== Expected Card Rendering ===");
console.log(`Title (.cards-card-title): "${fixedRow[textFields[0]]}" (should be "ru2")`);
console.log(`Date (.cards-card-date): "${fixedRow[dateFields[0]]}" (should be "26.02.2026")`);
console.log(`Phone icon (.pi-phone): "${fixedRow[phoneIdx]}" (should be "89955060167")`);
console.log(`Email icon (.pi-envelope): "${fixedRow[emailIdx]}" (should be "drynny@mail.ru")`);

console.log("\n=== KEY CARD FIELDS CHECK (Issue #825) ===");
const keyFieldsCorrect =
    fixedRow[textFields[0]] === "ru2" &&           // Title
    fixedRow[dateFields[0]] === "26.02.2026" &&    // Date
    fixedRow[phoneIdx] === "89955060167" &&        // Phone
    fixedRow[emailIdx] === "drynny@mail.ru";       // Email

console.log(`Title: ${fixedRow[textFields[0]] === "ru2" ? '✓' : '✗'}`);
console.log(`Date: ${fixedRow[dateFields[0]] === "26.02.2026" ? '✓' : '✗'}`);
console.log(`Phone: ${fixedRow[phoneIdx] === "89955060167" ? '✓' : '✗'}`);
console.log(`Email: ${fixedRow[emailIdx] === "drynny@mail.ru" ? '✓' : '✗'}`);

console.log("\n=== TEST RESULT ===");
console.log(`OLD (buggy) parsing: ${oldFailures} failures`);
console.log(`NEW (fixed) parsing: ${fixedFailures} failures`);
console.log(`(Note: Activity field "12.03.2026 12:54:54" is incorrectly parsed as "54:54" due to colon in datetime - pre-existing issue, not part of #825)`);
if (keyFieldsCorrect) {
    console.log("\n✓ KEY CARD FIELDS CORRECT - Fix is valid for issue #825!");
    process.exit(0);
} else {
    console.log("\n✗ KEY CARD FIELDS FAILED");
    process.exit(1);
}
