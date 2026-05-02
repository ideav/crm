// Test for issue #2272: chart data shows all zeros for report-type (f-col-cell) panels
// Root cause: dashCollectPanelData matched cells by data-rg-col/data-rg-head attributes,
// but f-col-cell cells (report source) didn't have these attributes, so all values were 0.
// Fix: add data-rg-col attribute when building f-col-cell cells in dashDrawPeriods.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

// Minimal DOM simulation for dashCollectPanelData
function makeCell(rgCol, value) {
    return {
        tagName: 'TD',
        className: 'f-cell f-col-cell',
        dataset: rgCol ? { rgCol: rgCol } : {},
        textContent: String(value),
        querySelectorAll(selector) { return []; }
    };
}

function makeHeadTh(text, rgCol) {
    return {
        tagName: 'TH',
        getAttribute(name) {
            if (name === 'data-rg-col') return rgCol || null;
            return null;
        },
        textContent: text
    };
}

function makeItemRow(name, cells) {
    return {
        getAttribute(name) { return name === 'item-name' ? name : null; },
        querySelectorAll(selector) {
            if (selector === 'td.f-cell') return cells;
            return [];
        },
        _name: name
    };
}

// Override getAttribute for item rows to return name
function makeItemRowNamed(name, cells) {
    return {
        getAttribute(attr) { return attr === 'item-name' ? name : null; },
        querySelectorAll(selector) {
            if (selector === 'td.f-cell') return cells;
            return [];
        }
    };
}

function makePanelEl(headThs, subheadThs, itemRows) {
    return {
        querySelector(selector) {
            if (selector === 'thead .f-subhead') {
                return subheadThs ? {
                    querySelectorAll(s) {
                        if (s === 'th') return subheadThs;
                        return [];
                    }
                } : null;
            }
            if (selector === 'thead .f-head') {
                return {
                    querySelectorAll(s) {
                        if (s === 'th') return headThs;
                        return [];
                    }
                };
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-item') return itemRows;
            return [];
        }
    };
}

// Extract functions from dash.js
const code = `
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashPanelGetColumns')}
${extractFunction('dashPanelGetRows')}
${extractFunction('dashCollectPanelData')}
`;

const ctx = { console, window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const { dashCollectPanelData, dashPanelGetColumns } = ctx;

// ---- Test 1: f-col-cell cells WITH data-rg-col (the fix applied) ----
// Panel with columns "Завершена", "В работе", "Отложена"
// Each row has cells with data-rg-col matching the column name
{
    const headThs = [
        makeHeadTh(''),          // spacer at idx 0
        makeHeadTh('Завершена'),
        makeHeadTh('В работе'),
        makeHeadTh('Отложена'),
    ];

    const row1Cells = [
        makeCell('Завершена', '41'),
        makeCell('В работе', '6'),
        makeCell('Отложена', '0'),
    ];

    const panelEl = makePanelEl(headThs, null, [
        makeItemRowNamed('Тип задачи 1', row1Cells)
    ]);

    const data = dashCollectPanelData(panelEl);

    assert(data.labels.length === 3, 'labels should have 3 columns');
    assert(data.labels[0] === 'Завершена', 'first label should be Завершена');
    assert(data.labels[1] === 'В работе', 'second label should be В работе');
    assert(data.labels[2] === 'Отложена', 'third label should be Отложена');
    assert(data.datasets.length === 1, 'should have 1 dataset (one row)');
    assert(data.datasets[0].data[0] === 41, 'Завершена value should be 41');
    assert(data.datasets[0].data[1] === 6, 'В работе value should be 6');
    assert(data.datasets[0].data[2] === 0, 'Отложена value should be 0');
}

// ---- Test 2: Multiple rows ----
{
    const headThs = [
        makeHeadTh(''),
        makeHeadTh('Завершена'),
        makeHeadTh('В работе'),
    ];

    const row1Cells = [
        makeCell('Завершена', '113'),
        makeCell('В работе', '2'),
    ];
    const row2Cells = [
        makeCell('Завершена', '162'),
        makeCell('В работе', '4'),
    ];

    const panelEl = makePanelEl(headThs, null, [
        makeItemRowNamed('Тип 1', row1Cells),
        makeItemRowNamed('Тип 2', row2Cells),
    ]);

    const data = dashCollectPanelData(panelEl);

    assert(data.datasets.length === 2, 'should have 2 datasets (two rows)');
    assert(data.datasets[0].data[0] === 113, 'row1 Завершена should be 113');
    assert(data.datasets[0].data[1] === 2, 'row1 В работе should be 2');
    assert(data.datasets[1].data[0] === 162, 'row2 Завершена should be 162');
    assert(data.datasets[1].data[1] === 4, 'row2 В работе should be 4');
}

// ---- Test 3: Cells WITHOUT data-rg-col (old broken behavior) — all zeros ----
{
    const headThs = [
        makeHeadTh(''),
        makeHeadTh('Завершена'),
        makeHeadTh('В работе'),
    ];

    // Cells with no data-rg-col (simulates old f-col-cell without the fix)
    const row1CellsNoCols = [
        makeCell(null, '41'),   // no data-rg-col
        makeCell(null, '6'),    // no data-rg-col
    ];

    const panelEl = makePanelEl(headThs, null, [
        makeItemRowNamed('Тип 1', row1CellsNoCols)
    ]);

    const data = dashCollectPanelData(panelEl);

    // Without data-rg-col, all values should be 0 (old broken behavior)
    assert(data.datasets[0].data[0] === 0, 'without data-rg-col, value should be 0 (old broken behavior verified)');
    assert(data.datasets[0].data[1] === 0, 'without data-rg-col, value should be 0 (old broken behavior verified)');
}

// ---- Test 4: Single column (no cols case) ----
{
    const headThs = [makeHeadTh('')]; // only spacer, no extra columns

    const singleCell = { tagName: 'TD', className: 'f-cell', dataset: {}, textContent: '42', querySelectorAll() { return []; } };

    const singleRow = {
        getAttribute(attr) { return attr === 'item-name' ? 'Показатель' : null; },
        querySelector(selector) { return selector === 'td.f-cell' ? singleCell : null; },
        querySelectorAll(selector) { return selector === 'td.f-cell' ? [singleCell] : []; }
    };

    const panelEl = makePanelEl(headThs, null, [singleRow]);

    const data = dashCollectPanelData(panelEl);

    assert(data.labels.length === 1, 'single-col: labels should have 1 item (row name)');
    assert(data.datasets.length === 1, 'single-col: should have 1 dataset');
    assert(data.datasets[0].data[0] === 42, 'single-col: value should be 42');
}

console.log('\nAll tests passed!');
