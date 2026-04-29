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
    const marker = 'function ' + name + '(';
    return source.indexOf(marker) === -1 ? '' : extractFunction(name);
}

const code = `
let dashValues = {};
let document = {};

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message + ': expected ' + expected + ', got ' + actual);
    }
}

function assertNear(actual, expected, message) {
    if (Math.abs(actual - expected) > 0.000001) {
        throw new Error(message + ': expected ' + expected + ', got ' + actual);
    }
}

${extractFunctionMaybe('dashNormalizeNumberText')}
${extractFunction('dashGetFloat')}
${extractFunctionMaybe('dashNumberForFormula')}
${extractFunctionMaybe('dashCellText')}
${extractFunction('dashNormalizeVal')}
${extractFunction('dashReportFieldName')}
${extractFunction('dashReportSumField')}
${extractFunction('dashGetVal')}
${extractFunction('dashCalcLineTotals')}

const nbsp = '\\u00a0';
const narrowNbsp = '\\u202f';

assertNear(dashGetFloat('2,061,818'), 2061818, 'comma thousands must parse as an integer');
assertNear(dashGetFloat('2' + nbsp + '061' + nbsp + '818'), 2061818, 'NBSP thousands must parse as an integer');
assertNear(dashGetFloat('2' + narrowNbsp + '061' + narrowNbsp + '818'), 2061818, 'narrow NBSP thousands must parse as an integer');
assertNear(dashGetFloat('2' + nbsp + '061' + nbsp + '818.88'), 2061818.88, 'dot decimals with NBSP thousands must parse');
assertNear(dashGetFloat('2' + nbsp + '061' + nbsp + '818,88'), 2061818.88, 'comma decimals with NBSP thousands must parse');
assertNear(dashGetFloat('2.061.818'), 2061818, 'dot thousands must parse as an integer');
assertNear(dashGetFloat('2.061.818,88'), 2061818.88, 'dot thousands with comma decimals must parse');
assertNear(dashGetFloat('-201' + nbsp + '754'), -201754, 'negative values with NBSP thousands must parse');
assertNear(dashGetFloat('0.123'), 0.123, 'small decimal values must stay decimals');
assertNear(dashGetFloat('1234,567'), 1234.567, 'single separators after four integer digits must stay decimals');

assertEqual(dashNumberForFormula('2,061,818'), '2061818',
    'formula operands must be rewritten as calculation-safe numbers');
assertEqual(dashNumberForFormula('2' + nbsp + '061' + nbsp + '818,88'), '2061818.88',
    'formula operands must handle decimal commas and NBSP thousands');

assertEqual(dashNormalizeVal('', '2' + nbsp + '061' + nbsp + '818,88'), '2061818.88',
    'display normalization must keep a calculation-safe numeric string');
assertEqual(dashNormalizeVal('', [{ val: '2,061,818' }]), '2061818',
    'object value normalization must handle comma thousands');

dashValues.revenue = [
    { date: '20260101', val: '2,061,818' },
    { date: '20260102', val: '2' + nbsp + '061' + nbsp + '818,88' },
    { date: '20260103', val: '-201' + nbsp + '754' }
];
assertEqual(dashGetVal('Revenue', '20260101', '20260131'), '3921882.88',
    'period values must sum normalized numbers');

const reportRows = [
    { Date: '20260101', Amount: '4' + nbsp + '268' + nbsp + '116' },
    { Date: '20260102', Amount: '2,061,818.88' },
    { Date: '20260103', Amount: '-201' + nbsp + '754' }
];
assertEqual(dashReportSumField(reportRows, 'Date', ['20260101', '20260131'], 'Amount'), '6128180.88',
    'report values must sum normalized numbers');

let lineTotal;
const row = {
    querySelectorAll(selector) {
        if (selector !== '.f-rg-cell') return [];
        return [
            { innerHTML: '2,061,818' },
            { innerHTML: '2' + nbsp + '061' + nbsp + '818,88' },
            { innerHTML: '-201' + nbsp + '754' }
        ];
    }
};
lineTotal = {
    innerHTML: '',
    title: '',
    closest() { return row; }
};
document = {
    querySelectorAll(selector) {
        return selector === '#dash-model .f-line-sum' ? [lineTotal] : [];
    }
};
dashCalcLineTotals();
assertEqual(String(lineTotal.innerHTML), '3921882.88',
    'line totals must sum normalized cell text');
`;

vm.runInNewContext(code, { console });
console.log('issue-2238 dashboard number normalization: ok');
