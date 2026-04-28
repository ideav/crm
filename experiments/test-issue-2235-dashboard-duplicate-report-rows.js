const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/dash.html', 'utf8');

if (!source.includes('dashIsDuplicateModelRow(previousItem, json[i])')) {
    throw new Error('dashGetModel should detect consecutive duplicate rows while parsing the model');
}
if (!source.includes('dashRememberReportSource(itemTargetId')) {
    throw new Error('dashGetModel should register duplicate report formulas on the visible row');
}

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

function extractFunctionMaybe(name) {
    const marker = 'function ' + name + '(';
    return source.indexOf(marker) === -1 ? '' : extractFunction(name);
}

const code = `
const repRegex = /^\\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\\]$/;
let dashReports = {};
let dashReportNames = {};
let dashReportKeys = {};
let dashReportSources = {};
let dashFormulas = {};
let rowsById = {};

let document = {
    getElementById(id) {
        return rowsById[id] || null;
    }
};

function makeCell(groupName, range) {
    return {
        innerHTML: '',
        attrs: { range: range || '20260101-20261231', ready: '0' },
        dataset: groupName ? { rgCol: groupName } : {},
        getAttribute(name) { return this.attrs[name]; },
        setAttribute(name, value) { this.attrs[name] = value; },
        closest() { return null; }
    };
}

function makeRow(cells) {
    return {
        querySelectorAll() {
            return cells;
        }
    };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

${extractFunction('dashGetFloat')}
${extractFunction('dashNormalizeVal')}
${extractFunctionMaybe('dashNormalizePanelFilter')}
${extractFunctionMaybe('dashReportKey')}
${extractFunctionMaybe('dashParseReportFormula')}
${extractFunctionMaybe('dashReportFieldName')}
${extractFunctionMaybe('dashReportHasField')}
${extractFunctionMaybe('dashReportSumField')}
${extractFunctionMaybe('dashNormalizeGroupName')}
${extractFunctionMaybe('dashSameGroupName')}
${extractFunctionMaybe('dashCellRgColumn')}
${extractFunctionMaybe('dashCellReportGroup')}
${extractFunctionMaybe('dashCollectReportGroups')}
${extractFunctionMaybe('dashIsDuplicateModelRow')}
${extractFunctionMaybe('dashReportGroupMatches')}
${extractFunctionMaybe('dashResolveReportCellValue')}
${extractFunction('dashGetRepVals')}

assert(typeof dashIsDuplicateModelRow === 'function',
    'dash model parser should expose duplicate-row detection');
assert(dashIsDuplicateModelRow(
    { panelID: '1035', itemID: 'row1', item: 'Закрыто из взятых в работу', level: '2' },
    { panelID: '1035', itemID: 'row2', item: 'Закрыто из взятых в работу', level: '2' }
), 'same-name consecutive rows in the same panel and level should merge into the previous row');
assert(!dashIsDuplicateModelRow(
    { panelID: '1035', itemID: 'row1', item: 'Закрыто из взятых в работу', level: '2' },
    { panelID: '1035', itemID: 'row3', item: 'Средний TTS', level: '2' }
), 'different row names should remain separate');

const row1Plan = makeCell('Подбор персонала и адаптация');
const row1Strategy = makeCell('Стратегия');
const row2Plan = makeCell('Подбор персонала и адаптация');
const row2Strategy = makeCell('Стратегия');

rowsById.row1 = makeRow([row1Plan, row1Strategy]);
rowsById.row2 = makeRow([row2Plan, row2Strategy]);

const reportA = dashReportKey('Подбор персонала и адаптация', '');
const reportB = dashReportKey('Стратегия', '');

dashReportNames[reportA] = 'Подбор персонала и адаптация';
dashReportNames[reportB] = 'Стратегия';
dashReportKeys.row1 = reportA;
dashReportKeys.row2 = reportB;
dashFormulas.row1 = '[Подбор персонала и адаптация.Закрыто]';
dashFormulas.row2 = '[Стратегия.Закрыто]';
dashReportSources.row1 = [
    { formula: dashFormulas.row1, reportKey: reportA },
    { formula: dashFormulas.row2, reportKey: reportB }
];
dashReports[reportA] = [{ Date: '20260101', 'Закрыто': '3' }];
dashReports[reportB] = [{ Date: '20260101', 'Закрыто': '4' }];

dashGetRepVals();

assert(row1Plan.innerHTML === '3',
    'first duplicate formula should fill the matching group on the visible row');
assert(row1Strategy.innerHTML === '4',
    'second duplicate formula should fill the next matching group on the visible row');
`;

vm.runInNewContext(code, { console });
console.log('issue-2235 dashboard duplicate report rows: ok');
