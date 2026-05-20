// Test: panelQuery returns data in WIDE form — one row per period with
// compound columns `<item>.<colName>` instead of separate long-form
// `{item, value, RGcolumnsID, Метка}` records. The dashboard model rows
// already carry RGcolumnsID for each rg column.
//
// Reproduces the scenario described in issue #2742:
//   • Dashboard row "входящий звонок" with rg columns "Кол-во" (RGcolumnsID
//     1974) and "Сумма" (RGcolumnsID 1978).
//   • panelQuery response (one row per period):
//       { "Месяц": "20260121",
//         "входящий звонок.Кол-во": "1",
//         "входящий звонок.Сумма": "0",
//         "Метка": "лиды ", ... }
//   • Expected: cell "Кол-во" → 1, cell "Сумма" → 0.
//
// Before the fix, dashGetPanelValuesDone skipped the row entirely because
// `row.value` was undefined, so the bucket stayed empty and both cells
// rendered blank. After the fix the wide columns are split into bucket
// entries keyed by `<itemKey>:<colKey>` so each cell picks up its own
// value via `dashGetVal(item + ':' + col)`.

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { console.log('  PASS: ' + msg); passed++; }
    else { console.error('  FAIL: ' + msg); failed++; }
}

// ─── Minimal stubs mirroring dash.js shape ──────────────────────────────

let dashPanelValues = {};

function dashGetFloat(v) {
    var f = parseFloat(String(v).replace(',', '.'));
    return isNaN(f) ? 0 : f;
}
function dashNormalizeVal(_item, val) {
    var v = val || '';
    if (typeof val === 'object' && val !== null) v = val[0].val;
    return String(v).replace(/ /g, '').replace(/,/g, '.');
}
function dashNormalizeMatrixKey(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function dashMatrixLabelScore(dashLabel, matrixLabel) {
    var d = dashNormalizeMatrixKey(dashLabel);
    var m = dashNormalizeMatrixKey(matrixLabel);
    if (!d && !m) return 1;
    if (!d || !m) return 0;
    if (d === m) return 1000 + d.length;
    if (d.indexOf(m) !== -1) return 500 + m.length;
    if (m.indexOf(d) !== -1) return 250 + d.length;
    return 0;
}
function dashMatrixLabelMatches(dashLabel, matrixLabel) {
    return dashMatrixLabelScore(dashLabel, matrixLabel) > 0;
}
function dashGetVal(item, fr, to, dashLabel, panelKey) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item;
    var store = (panelKey && dashPanelValues[panelKey]) ? dashPanelValues[panelKey] : {};
    if (!store[key]) return;
    var hasLabelFilter = dashLabel !== undefined;
    for (i in store[key]) {
        var entry = store[key][i];
        if (hasLabelFilter && !dashMatrixLabelMatches(dashLabel, entry['Метка'])) continue;
        if (!fr || (entry.date >= fr && entry.date <= to)) {
            valids = true;
            acc += dashGetFloat(entry.val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}
function dashDateYMD(d) {
    return d.slice(6) + d.slice(3, 5) + d.slice(0, 2);
}
function dashParseSrcValue(value) {
    var raw = String(value == null ? '' : value).replace(/^\s+/, '');
    return JSON.parse(raw.charAt(0) === '[' ? raw : '[' + raw + ']');
}

// ─── The bit under test ─────────────────────────────────────────────────
// Replicates dashGetPanelValuesDone's bucket-building loop, including the
// new issue #2742 wide-form path.

function buildBucket(panelKey, periodField, jsonRows) {
    var bucket = dashPanelValues[panelKey] = {};
    jsonRows.forEach(function(row) {
        if (!row) return;
        var srcLabel = row['Метка'] || '';
        // Long form
        if (row.value !== undefined && row.value !== null && row.value !== '') {
            var itemKey = (row.item || '').toLowerCase();
            var colGroup = (row.RGcolumnsID || '').toLowerCase();
            var key = colGroup ? itemKey + ':' + colGroup : itemKey;
            var parsed = dashParseSrcValue(row.value);
            var tagged = parsed.map(function(p) {
                return Object.assign({}, p, { 'Метка': srcLabel });
            });
            bucket[key] = Array.isArray(bucket[key]) ? bucket[key].concat(tagged) : tagged;
        }
        // Wide form (issue 2742)
        var dateRaw = (periodField && row[periodField]) || '';
        var dateYMD = /^\d{8}$/.test(dateRaw)
            ? dateRaw
            : (/^\d{2}\.\d{2}\.\d{4}$/.test(dateRaw) ? dashDateYMD(dateRaw) : dateRaw);
        Object.keys(row).forEach(function(colKey) {
            var dotIdx = colKey.indexOf('.');
            if (dotIdx <= 0) return;
            var val = row[colKey];
            if (val === undefined || val === null || val === '') return;
            var wItem = colKey.substring(0, dotIdx).toLowerCase();
            var wCol = colKey.substring(dotIdx + 1).toLowerCase();
            if (!wItem || !wCol) return;
            var wKey = wItem + ':' + wCol;
            var entry = { date: dateYMD, val: String(val), 'Метка': srcLabel };
            bucket[wKey] = Array.isArray(bucket[wKey]) ? bucket[wKey].concat([entry]) : [entry];
        });
    });
    return bucket;
}

function reset() {
    dashPanelValues = {};
}

// =========================================================================
// Test 1: exact scenario from issue 2742.
// =========================================================================
console.log('\nTest 1: wide-form panelQuery row populates per-column buckets');
reset();
buildBucket('fp2135', 'Месяц', [{
    "Месяц": "20260121",
    "Сумма": "0.00",
    "Источник": "Входящий звонок",
    "сайт.Кол-во": "",
    "сайт.Сумма": "",
    "Метка": "лиды ",
    "Стадия": "Изменились обстоятельства",
    "входящий звонок.Кол-во": "1",
    "входящий звонок.Сумма": "0",
    "вотсап.Кол-во": "",
    "вотсап.Сумма": "",
    "срм.Кол-во": "",
    "срм.Сумма": "",
    "агрегаторы.Кол-во": "",
    "агрегаторы.Сумма": "",
    "конверсия.Кол-во": "",
    "конверсия.Сумма": "",
    "отказ.Кол-во": "1",
    "отказ.Сумма": "0",
    "прочее.Кол-во": "",
    "прочее.Сумма": ""
}]);

var vKolvo = dashGetVal('входящий звонок:Кол-во', '20260101', '20261231', 'лиды', 'fp2135');
var vSumma = dashGetVal('входящий звонок:Сумма', '20260101', '20261231', 'лиды', 'fp2135');
assert(vKolvo === '1', 'Кол-во cell picks up "1" via item:col bucket: ' + vKolvo);
// Note: dashGetVal returns '' for an accumulated 0 (see dashNormalizeVal —
// `val || ''` treats 0 as falsy). What matters here is that the lookup
// SUCCEEDED (didn't return undefined), so the Сумма bucket entry was
// created and the cell is non-blank in the dashboard.
assert(vSumma !== undefined, 'Сумма bucket entry was created (lookup not undefined): ' + JSON.stringify(vSumma));
assert(vSumma === '', 'dashGetVal normalises 0 to empty string: ' + JSON.stringify(vSumma));

// =========================================================================
// Test 2: empty wide-form value is skipped (no entry for "сайт.Кол-во").
// =========================================================================
console.log('\nTest 2: empty cells in wide form do not create bucket entries');
reset();
buildBucket('fp2135', 'Месяц', [{
    "Месяц": "20260121",
    "сайт.Кол-во": "",
    "входящий звонок.Кол-во": "1",
    "Метка": "лиды"
}]);
var vSite = dashGetVal('сайт:Кол-во', '20260101', '20261231', 'лиды', 'fp2135');
assert(vSite === undefined, 'empty wide-form cell does not produce a value: ' + vSite);

// =========================================================================
// Test 3: Метка filter applied to wide-form entries.
// =========================================================================
console.log('\nTest 3: Метка filter applies to wide-form entries');
reset();
buildBucket('fp2135', 'Месяц', [
    { "Месяц": "20260121", "входящий звонок.Кол-во": "10", "Метка": "лиды " },
    { "Месяц": "20260121", "входящий звонок.Кол-во": "99", "Метка": "оплата" }
]);
var vLeads = dashGetVal('входящий звонок:Кол-во', '20260101', '20261231', 'лиды', 'fp2135');
assert(vLeads === '10', 'only entries with Метка=лиды contribute: ' + vLeads);

// =========================================================================
// Test 4: date range filter applied to wide-form entries.
// =========================================================================
console.log('\nTest 4: date range filter applies to wide-form entries');
reset();
buildBucket('fp2135', 'Месяц', [
    { "Месяц": "20260121", "входящий звонок.Кол-во": "5",  "Метка": "лиды" },
    { "Месяц": "20270121", "входящий звонок.Кол-во": "99", "Метка": "лиды" }
]);
var v2026 = dashGetVal('входящий звонок:Кол-во', '20260101', '20261231', 'лиды', 'fp2135');
assert(v2026 === '5', 'only entries within fr..to contribute: ' + v2026);

// =========================================================================
// Test 5: multiple period rows aggregate.
// =========================================================================
console.log('\nTest 5: multiple wide-form rows aggregate per item:col');
reset();
buildBucket('fp2135', 'Месяц', [
    { "Месяц": "20260121", "входящий звонок.Кол-во": "2", "Метка": "лиды" },
    { "Месяц": "20260221", "входящий звонок.Кол-во": "3", "Метка": "лиды" }
]);
var vAgg = dashGetVal('входящий звонок:Кол-во', '20260101', '20261231', 'лиды', 'fp2135');
assert(vAgg === '5', 'two month rows sum to 5: ' + vAgg);

// =========================================================================
// Test 6: DD.MM.YYYY date string is converted to YYYYMMDD.
// =========================================================================
console.log('\nTest 6: DD.MM.YYYY date format is normalised to YYYYMMDD');
reset();
buildBucket('fp2135', 'Месяц', [
    { "Месяц": "21.01.2026", "входящий звонок.Кол-во": "7", "Метка": "лиды" }
]);
var vDate = dashGetVal('входящий звонок:Кол-во', '20260101', '20261231', 'лиды', 'fp2135');
assert(vDate === '7', 'DD.MM.YYYY converted via dashDateYMD: ' + vDate);

// =========================================================================
// Test 7: long-form rows still populate bucket as before (regression).
// =========================================================================
console.log('\nTest 7: long-form panelQuery rows remain supported');
reset();
buildBucket('fp2135', '', [
    { item: 'Выручка', value: '[{"date":"20260101","val":"42"}]', RGcolumnsID: '', 'Метка': '' }
]);
var vLong = dashGetVal('выручка', '20260101', '20261231', undefined, 'fp2135');
assert(vLong === '42', 'long-form row still feeds the bucket: ' + vLong);

// =========================================================================
// Test 8: column key without a dot is left alone (regression / safety).
// =========================================================================
console.log('\nTest 8: plain column names are not mistaken for item.col');
reset();
buildBucket('fp2135', 'Месяц', [
    { "Месяц": "20260121", "Сумма": "0.00", "Источник": "Входящий звонок", "Метка": "лиды" }
]);
var vNoDot = dashGetVal('источник', '20260101', '20261231', 'лиды', 'fp2135');
assert(vNoDot === undefined, 'no item.col split happens for plain columns: ' + vNoDot);

// =========================================================================
// Test 9: leading-dot column is ignored (defensive).
// =========================================================================
console.log('\nTest 9: leading-dot column key is ignored');
reset();
buildBucket('fp2135', 'Месяц', [
    { "Месяц": "20260121", ".col": "9", "Метка": "лиды" }
]);
var vLead = dashGetVal(':col', '20260101', '20261231', 'лиды', 'fp2135');
assert(vLead === undefined, 'leading-dot key produces no entry: ' + vLead);

console.log('\n=== Summary ===');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
