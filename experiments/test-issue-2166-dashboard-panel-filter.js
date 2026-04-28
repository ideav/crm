const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/dash.html', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
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

assert(source.includes('json[i].panelFilter'), 'dashboard model parser must read panelFilter from model rows');

const code = `
let calls = [];
let dashReports = {};
let dashReportNames = {};
let dashReportKeys = {};
let dashFormulas = {};
let dashAjaxes = 0;
const repRegex = /^\\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\\]$/;

function newApi(method, url, callback, vars, index) {
    calls.push({ method, url, callback, vars, index });
}

function dashDrawPeriods() {}

${extractFunctionMaybe('dashNormalizePanelFilter')}
${extractFunctionMaybe('dashReportKey')}
${extractFunctionMaybe('dashReportUrl')}
${extractFunction('dashGetFloat')}
${extractFunction('dashNormalizeVal')}
${extractFunctionMaybe('dashParseReportFormula')}
${extractFunctionMaybe('dashReportFieldName')}
${extractFunctionMaybe('dashReportHasField')}
${extractFunctionMaybe('dashReportSumField')}
${extractFunctionMaybe('dashNormalizeGroupName')}
${extractFunctionMaybe('dashSameGroupName')}
${extractFunctionMaybe('dashCellRgColumn')}
${extractFunctionMaybe('dashCellReportGroup')}
${extractFunctionMaybe('dashCollectReportGroups')}
${extractFunctionMaybe('dashResolveReportCellValue')}
${extractFunction('dashGetRepVals')}
${extractFunction('dashGetRepDone')}
${extractFunction('dashGetRep')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

let key = dashGetRep('Операционные результаты', '01.01.2026', '31.12.2026', 'FR_dept=IN(2889)');
assert(calls.length === 1, 'formula report should be requested once');
assert(calls[0].url === 'report/Операционные результаты?JSON_KV&FR_Date=01.01.2026&TO_Date=31.12.2026&FR_dept=IN(2889)',
    'formula report request must append panelFilter');

dashGetRepDone([{ Date: '20260101', 'В работе': '5' }], calls[0].index);
assert(key && dashReports[key] && dashReports[key][0]['В работе'] === '5',
    'report response must be cached under the filtered report key');

calls = [];
let secondKey = dashGetRep('Операционные результаты', '01.01.2026', '31.12.2026', '?FR_dept=IN(4000)&F_status=Активно');
assert(calls[0].url === 'report/Операционные результаты?JSON_KV&FR_Date=01.01.2026&TO_Date=31.12.2026&FR_dept=IN(4000)&F_status=Активно',
    'panelFilter should allow leading separators and multiple parameters');
assert(secondKey !== key, 'same formula report with another panelFilter must use another cache key');

calls = [];
dashGetRep('Операционные результаты', '01.01.2026', '31.12.2026', '');
assert(calls[0].url === 'report/Операционные результаты?JSON_KV&FR_Date=01.01.2026&TO_Date=31.12.2026',
    'empty panelFilter must not add an extra ampersand');

function makeCell(range) {
    return {
        innerHTML: '',
        attrs: { range },
        getAttribute(name) { return this.attrs[name]; },
        setAttribute(name, value) { this.attrs[name] = value; }
    };
}

let cells = {
    '1897': [makeCell('20260101-20261231')],
    '1898': [makeCell('20260101-20261231')]
};

let reportName = 'Операционные результаты';
let reportA = dashReportKey(reportName, 'FR_dept=IN(2889)');
let reportB = dashReportKey(reportName, 'FR_dept=IN(4000)');
dashReportNames[reportA] = reportName;
dashReportNames[reportB] = reportName;
dashReportKeys['1897'] = reportA;
dashReportKeys['1898'] = reportB;
dashFormulas['1897'] = '[Операционные результаты.В работе]';
dashFormulas['1898'] = '[Операционные результаты.В работе]';
dashReports[reportA] = [{ Date: '20260101', 'В работе': '5' }];
dashReports[reportB] = [{ Date: '20260101', 'В работе': '9' }];

let document = {
    getElementById(id) {
        return {
            querySelectorAll(selector) {
                return selector === '.f-rg-cell' ? cells[id] || [] : [];
            }
        };
    }
};

dashGetRepVals();
assert(cells['1897'][0].innerHTML === '5', 'first formula item must use the first panelFilter response');
assert(cells['1898'][0].innerHTML === '9', 'second formula item must use the second panelFilter response');
`;

vm.runInNewContext(code, { console });
console.log('issue-2166 dashboard panelFilter: ok');
