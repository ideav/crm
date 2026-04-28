const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/dash.html', 'utf8');

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
    return source.indexOf('function ' + name + '(') === -1 ? '' : extractFunction(name);
}

const code = `
const repRegex = /^\\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\\]$/;
let dashReports = {};
let dashReportNames = {};
let dashReportKeys = {};
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

function makeHeadCell(groupName, range) {
    const cell = makeCell('', range);
    cell.dataset = groupName ? { rgHead: groupName } : {};
    return cell;
}

function setFormulaCase(formula, cells, reportRows) {
    const reportKey = 'Подбор персонала и адаптация';
    dashReports = {};
    dashReportNames = {};
    dashReportKeys = {};
    dashFormulas = {};
    rowsById = {};

    dashReports[reportKey] = reportRows;
    dashReportNames[reportKey] = 'Подбор персонала и адаптация';
    dashReportKeys['row1'] = reportKey;
    dashFormulas['row1'] = formula;
    rowsById['row1'] = {
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

let plan = makeCell('План');
let fact = makeCell('Факт');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ]', [plan, fact], [
    { Date: '20260101', 'Интервью с НМ.План': '10', 'Интервью с НМ.Факт': '7' }
]);
dashGetRepVals();
assert(plan.innerHTML === '10', 'plain formula should fill План from field.План when plain field is absent');
assert(fact.innerHTML === '7', 'plain formula should fill Факт from field.Факт when plain field is absent');

plan = makeHeadCell('План');
fact = makeHeadCell('Факт');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ]', [plan, fact], [
    { Date: '20260101', 'Интервью с НМ.План': '11', 'Интервью с НМ.Факт': '9' }
]);
dashGetRepVals();
assert(plan.innerHTML === '11', 'plain formula should fill rgHead План from field.План');
assert(fact.innerHTML === '9', 'plain formula should fill rgHead Факт from field.Факт');

plan = makeCell('План');
fact = makeCell('Факт');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ]', [plan, fact], [
    { Date: '20260101', 'Интервью с НМ': '5', 'Интервью с НМ.План': '10', 'Интервью с НМ.Факт': '7' }
]);
dashGetRepVals();
assert(plan.innerHTML === '5', 'plain report field should be used for every group when it exists');
assert(fact.innerHTML === '5', 'plain report field should override grouped fields for all groups');

plan = makeCell('План');
fact = makeCell('Факт');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ.План]', [plan, fact], [
    { Date: '20260101', 'Интервью с НМ.План': '12', 'Интервью с НМ.Факт': '8' }
]);
dashGetRepVals();
assert(plan.innerHTML === '12', 'explicit grouped formula should fill its matching group');
assert(fact.innerHTML === '', 'explicit grouped formula should ignore other groups');
assert(fact.getAttribute('ready') === '0', 'ignored group cell should stay unresolved');

const single = makeCell('Любая группа');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ.План]', [single], [
    { Date: '20260101', 'Интервью с НМ': '5', 'Интервью с НМ.План': '12' }
]);
dashGetRepVals();
assert(single.innerHTML === '12', 'single group should prefer field.group over field');

const singleFallback = makeCell('Любая группа');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ.План]', [singleFallback], [
    { Date: '20260101', 'Интервью с НМ': '5' }
]);
dashGetRepVals();
assert(singleFallback.innerHTML === '5', 'single group should fall back to plain field');

const noGroup = makeCell('');
setFormulaCase('[Подбор персонала и адаптация.Интервью с НМ.План]', [noGroup], [
    { Date: '20260101', 'Интервью с НМ': '5' }
]);
dashGetRepVals();
assert(noGroup.innerHTML === '5', 'ungrouped cells should use COALESCE(field.group, field)');
`;

vm.runInNewContext(code, { console });
console.log('issue-2232 dashboard report group parsing: ok');
