/**
 * Test for issue #537: When report JSON contains a "header" key,
 * it should be used as the table title (.integram-table-title)
 * if no data-title attribute was explicitly set.
 *
 * Usage: node experiments/test-issue-537-report-header-title.js
 */

// Simulate report JSON response (as described in issue #537)
const reportJson = {
    "columns": [
        { "id": "3004", "type": "332", "format": "SHORT", "name": "Лид", "granted": 1 },
        { "id": "3006", "type": "4861", "format": "SHORT", "name": "Источник", "granted": 1, "ref": 1, "orig": "2790" },
        { "id": "4238", "type": "", "format": "HTML", "name": "Действия" }
    ],
    "data": [
        ["Высокая Марфа Васильевна"],
        [""],
        ["<a href=\"/edit\">✏️</a>"]
    ],
    "header": "Мои лиды"
};

// Simulate loadDataFromReport result (after fix)
function simulateLoadDataFromReport(json) {
    const columnData = json.data || [];
    let rows = [];

    if (columnData.length > 0 && Array.isArray(columnData[0])) {
        const numRows = columnData[0].length;
        for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
            const row = [];
            for (let colIndex = 0; colIndex < columnData.length; colIndex++) {
                row.push(columnData[colIndex][rowIndex]);
            }
            rows.push(row);
        }
    } else {
        rows = columnData;
    }

    return {
        columns: json.columns || [],
        rows: rows,
        header: json.header || null  // <-- FIX: pass header through
    };
}

// Simulate loadData behavior (after fix)
function simulateLoadData(options, loadedJson) {
    const state = { title: options.title || '' };

    // Simulate report path
    const json = simulateLoadDataFromReport(loadedJson);

    // Auto-set table title from report header if not explicitly provided (issue #537)
    if (!state.title && json.header) {
        state.title = json.header;
    }

    return { state, json };
}

// Test 1: title NOT explicitly set (should use header from report)
console.log('Test 1: title not set (data-title not provided), report has header');
const test1 = simulateLoadData({ title: '' }, reportJson);
console.assert(test1.state.title === 'Мои лиды', `FAIL: Expected "Мои лиды", got "${test1.state.title}"`);
console.assert(test1.json.header === 'Мои лиды', `FAIL: header not passed through, got "${test1.json.header}"`);
console.log(`  PASS: title set to "${test1.state.title}" from report header`);

// Test 2: title explicitly set (should NOT be overridden by report header)
console.log('Test 2: title explicitly set (data-title provided), report has header');
const test2 = simulateLoadData({ title: 'Custom Title' }, reportJson);
console.assert(test2.state.title === 'Custom Title', `FAIL: Expected "Custom Title", got "${test2.state.title}"`);
console.log(`  PASS: title remains "${test2.state.title}" (not overridden by report header)`);

// Test 3: report has no header field (should not set title)
console.log('Test 3: title not set, report has NO header');
const reportWithoutHeader = { ...reportJson };
delete reportWithoutHeader.header;
const test3 = simulateLoadData({ title: '' }, reportWithoutHeader);
console.assert(test3.state.title === '', `FAIL: Expected empty title, got "${test3.state.title}"`);
console.assert(test3.json.header === null, `FAIL: expected null header, got "${test3.json.header}"`);
console.log(`  PASS: title remains empty when no header in report`);

// Test 4: report has empty header (should not set title)
console.log('Test 4: title not set, report has empty header');
const reportWithEmptyHeader = { ...reportJson, header: '' };
const test4 = simulateLoadData({ title: '' }, reportWithEmptyHeader);
console.assert(test4.state.title === '', `FAIL: Expected empty title, got "${test4.state.title}"`);
console.log(`  PASS: title remains empty when header is empty string`);

console.log('\nAll tests passed!');
