// Test for issue #2288: dashboard charts can be limited to selected rows.
// Before the fix, dashCollectPanelData always used every .f-item row and the
// visualization settings modal could not persist row-level selection.

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

function extractFunctionIfPresent(name) {
    return source.indexOf('function ' + name + '(') === -1 ? '' : extractFunction(name);
}

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, message + ' (expected ' + expected + ', got ' + actual + ')');
}

function makeCell(rgCol, value) {
    return {
        dataset: rgCol ? { rgCol: rgCol } : {},
        textContent: String(value),
        querySelectorAll() { return []; }
    };
}

function makeHeadTh(text) {
    return {
        getAttribute(name) {
            if (name === 'data-rg-col') return null;
            return null;
        },
        textContent: text
    };
}

function makeItemRow(id, name, cells) {
    return {
        id: id,
        getAttribute(attr) { return attr === 'item-name' ? name : null; },
        querySelector(selector) {
            return selector === 'td.f-cell' ? cells[0] || null : null;
        },
        querySelectorAll(selector) {
            if (selector === 'td.f-cell') return cells;
            return [];
        }
    };
}

function makePanelEl(headThs, itemRows) {
    return {
        querySelector(selector) {
            if (selector === 'thead .f-subhead') return null;
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

function makeSettingsItem(rowChecks) {
    const fieldSelect = { name: 'barMode', value: 'stacked' };
    const nodes = {
        '.dash-viz-check': { checked: true },
        '.dash-viz-default': { checked: false }
    };
    return {
        dataset: { vizType: 'bar' },
        querySelector(selector) {
            return nodes[selector] || null;
        },
        querySelectorAll(selector) {
            if (selector === '.dash-viz-fieldmap .dash-viz-field-select') return [fieldSelect];
            if (selector === '.dash-viz-row-check') return rowChecks;
            return [];
        }
    };
}

const code = `
${extractFunction('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashPanelGetColumns')}
${extractFunction('dashPanelGetRows')}
${extractFunctionIfPresent('dashNormalizeSelectedRows')}
${extractFunctionIfPresent('dashPanelGetRowKey')}
${extractFunctionIfPresent('dashPanelGetRowName')}
${extractFunctionIfPresent('dashPanelFilterRows')}
${extractFunctionIfPresent('dashCollectVizSelectedRows')}
${extractFunction('dashCollectPanelData')}
function dashCollectVizSize() { return null; }
${extractFunction('dashVizModalCollectSettings')}
`;

const ctx = { console, document: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const headThs = [makeHeadTh(''), makeHeadTh('Jan'), makeHeadTh('Feb')];
    const rows = [
        makeItemRow('row-a', 'Metric A', [makeCell('Jan', '10'), makeCell('Feb', '20')]),
        makeItemRow('row-b', 'Metric B', [makeCell('Jan', '30'), makeCell('Feb', '40')]),
        makeItemRow('row-c', 'Metric C', [makeCell('Jan', '50'), makeCell('Feb', '60')])
    ];
    const data = ctx.dashCollectPanelData(makePanelEl(headThs, rows), { selectedRows: ['row-b'] });

    assertEqual(data.labels.length, 2, 'column labels are preserved when rows are filtered');
    assertEqual(data.datasets.length, 1, 'only the selected row becomes a chart dataset');
    assertEqual(data.datasets[0].label, 'Metric B', 'selected row label is used');
    assertEqual(data.datasets[0].data[0], 30, 'selected row Jan value is used');
    assertEqual(data.datasets[0].data[1], 40, 'selected row Feb value is used');
}

{
    const headThs = [makeHeadTh('')];
    const rows = [
        makeItemRow('row-a', 'Metric A', [makeCell(null, '7')]),
        makeItemRow('row-b', 'Metric B', [makeCell(null, '9')])
    ];
    const data = ctx.dashCollectPanelData(makePanelEl(headThs, rows), { selectedRows: ['row-b'] });

    assertEqual(data.labels.length, 1, 'single-value chart keeps only selected row label');
    assertEqual(data.labels[0], 'Metric B', 'single-value label is selected row');
    assertEqual(data.datasets[0].data.length, 1, 'single-value chart keeps only selected row value');
    assertEqual(data.datasets[0].data[0], 9, 'single-value chart uses selected row value');
}

{
    const headThs = [makeHeadTh(''), makeHeadTh('Jan')];
    const rows = [
        makeItemRow('row-a', 'Metric A', [makeCell('Jan', '10')]),
        makeItemRow('row-b', 'Metric B', [makeCell('Jan', '30')])
    ];
    const data = ctx.dashCollectPanelData(makePanelEl(headThs, rows), { selectedRows: [] });

    assertEqual(data.datasets.length, 0, 'empty selectedRows intentionally renders no row datasets');
}

{
    const item = makeSettingsItem([
        { value: 'row-a', checked: false },
        { value: 'row-b', checked: true },
        { value: 'row-c', checked: false }
    ]);
    const accordion = {
        querySelectorAll(selector) {
            if (selector === '.dash-viz-accordion-item') return [item];
            return [];
        }
    };
    ctx.document = {
        getElementById(id) {
            return id === 'dash-viz-accordion' ? accordion : null;
        }
    };
    const settings = ctx.dashVizModalCollectSettings();

    assertEqual(settings.length, 1, 'checked visualization is collected');
    assertEqual(settings[0].fieldMap.barMode, 'stacked', 'existing chart field settings are preserved');
    assert(Array.isArray(settings[0].selectedRows), 'selected rows are serialized');
    assertEqual(settings[0].selectedRows.length, 1, 'only checked rows are serialized');
    assertEqual(settings[0].selectedRows[0], 'row-b', 'selected row id is serialized');
}

{
    const item = makeSettingsItem([
        { value: 'row-a', checked: true },
        { value: 'row-b', checked: true }
    ]);
    const accordion = {
        querySelectorAll(selector) {
            if (selector === '.dash-viz-accordion-item') return [item];
            return [];
        }
    };
    ctx.document = {
        getElementById(id) {
            return id === 'dash-viz-accordion' ? accordion : null;
        }
    };
    const settings = ctx.dashVizModalCollectSettings();

    assert(settings[0].selectedRows === undefined, 'all checked rows are stored as default all rows');
}

console.log('\nissue-2288 dashboard selected chart rows: ok');
