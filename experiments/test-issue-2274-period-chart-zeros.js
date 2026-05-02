// Test for issue #2274: chart still shows all zeros for period-based (rg-type) panels
// Root cause: dashCollectPanelData matched cells by data-rg-col attribute, but
// f-rg-cell cells for period-based panels (rg type, single column per period) had
// no data-rg-col — only a range attribute. The fix adds data-rg-col = period label
// to these cells so dashCollectPanelData can match them correctly.

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

// Simulate a cell with the data-rg-col attribute set to the period label (WITH fix)
function makeCellWithRgCol(rgCol, value) {
    return {
        tagName: 'TD',
        className: 'f-cell f-rg-cell',
        dataset: { rgCol: rgCol },
        getAttribute(name) { return name === 'data-rg-col' ? rgCol : null; },
        textContent: String(value),
        querySelectorAll() { return []; }
    };
}

// Simulate a cell WITHOUT data-rg-col (old broken behavior — no fix applied)
function makeCellWithoutRgCol(value) {
    return {
        tagName: 'TD',
        className: 'f-cell f-rg-cell',
        dataset: {},
        getAttribute() { return null; },
        textContent: String(value),
        querySelectorAll() { return []; }
    };
}

function makeHeadTh(text) {
    return {
        tagName: 'TH',
        getAttribute(name) { return null; },
        textContent: text
    };
}

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
                    querySelectorAll(s) { return s === 'th' ? subheadThs : []; }
                } : null;
            }
            if (selector === 'thead .f-head') {
                return { querySelectorAll(s) { return s === 'th' ? headThs : []; } };
            }
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-item') return itemRows;
            return [];
        }
    };
}

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
const { dashCollectPanelData } = ctx;

// ---- Test 1: period-based panel WITH data-rg-col (the fix applied) ----
// Panel: 3 rows (metrics), 12 period columns (months)
// Each cell has data-rg-col = period label  →  values should be read correctly
{
    const periods = ['янв 26', 'фев 26', 'мар 26'];
    const headThs = [makeHeadTh('')].concat(periods.map(makeHeadTh));

    // Row 1: "Кол-во задач в работе" — values 5, 3, 7
    // Row 2: "Кол-во закрытых задач" — values 10, 12, 8
    const rows = [
        makeItemRowNamed('Кол-во задач в работе', periods.map((p, i) => makeCellWithRgCol(p, [5, 3, 7][i]))),
        makeItemRowNamed('Кол-во закрытых задач', periods.map((p, i) => makeCellWithRgCol(p, [10, 12, 8][i]))),
    ];

    const data = dashCollectPanelData(makePanelEl(headThs, null, rows));

    assert(data.labels.length === 3, 'period panel: labels should have 3 periods');
    assert(data.labels[0] === 'янв 26', 'period panel: first label should be "янв 26"');
    assert(data.labels[1] === 'фев 26', 'period panel: second label should be "фев 26"');
    assert(data.labels[2] === 'мар 26', 'period panel: third label should be "мар 26"');
    assert(data.datasets.length === 2, 'period panel: should have 2 datasets');
    assert(data.datasets[0].label === 'Кол-во задач в работе', 'period panel: first dataset label');
    assert(data.datasets[0].data[0] === 5, 'period panel: row1 янв 26 = 5');
    assert(data.datasets[0].data[1] === 3, 'period panel: row1 фев 26 = 3');
    assert(data.datasets[0].data[2] === 7, 'period panel: row1 мар 26 = 7');
    assert(data.datasets[1].data[0] === 10, 'period panel: row2 янв 26 = 10');
    assert(data.datasets[1].data[1] === 12, 'period panel: row2 фев 26 = 12');
    assert(data.datasets[1].data[2] === 8, 'period panel: row2 мар 26 = 8');
}

// ---- Test 2: period-based panel WITHOUT data-rg-col (old broken behavior) ----
// Cells have no data-rg-col → all values should be 0
{
    const periods = ['янв 26', 'фев 26'];
    const headThs = [makeHeadTh('')].concat(periods.map(makeHeadTh));

    const rows = [
        makeItemRowNamed('Метрика', periods.map(() => makeCellWithoutRgCol(42))),
    ];

    const data = dashCollectPanelData(makePanelEl(headThs, null, rows));

    assert(data.datasets[0].data[0] === 0, 'no data-rg-col: value should be 0 (old broken behavior confirmed)');
    assert(data.datasets[0].data[1] === 0, 'no data-rg-col: value should be 0 (old broken behavior confirmed)');
}

console.log('\nAll tests passed!');
