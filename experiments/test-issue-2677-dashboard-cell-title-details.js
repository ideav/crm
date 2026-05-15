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

function extractFunctionMaybe(name) {
    const marker = 'function ' + name + '(';
    return source.indexOf(marker) === -1 ? '' : extractFunction(name);
}

const code = `
let dashValues = {};
let dashPanelValues = {};
let document = {};

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message + ': expected "' + expected + '", got "' + actual + '"');
    }
}

function dashMatrixLabelMatches(filter, value) {
    return String(filter || '') === String(value || '');
}

${extractFunctionMaybe('dashNormalizeNumberText')}
${extractFunctionMaybe('dashFormatNumberText')}
${extractFunction('dashGetFloat')}
${extractFunction('dashFormatDetailEntry')}
${extractFunction('dashGetValDetails')}
${extractFunction('dashGetColValDetails')}

// Period-aggregated details: each contributing entry shown as "date: value",
// comma-separated. Only successfully parsed numbers are included.
dashValues.revenue = [
    { date: '20260101', val: '100' },
    { date: '20260102', val: '200' },
    { date: '20260103', val: 'oops' },
    { date: '20260201', val: '500' }
];
assertEqual(
    dashGetValDetails('Revenue', '20260101', '20260131'),
    '20260101: 100, 20260102: 200',
    'period details list each in-range numeric entry separated by commas'
);

assertEqual(
    dashGetValDetails('Revenue'),
    '20260101: 100, 20260102: 200, 20260201: 500',
    'absent date range includes every numeric entry'
);

assertEqual(
    dashGetValDetails('Missing', '20260101', '20260131'),
    '',
    'unknown items return an empty details string'
);

// Column-aggregated details: each contributing entry shown as "value",
// (no date prefix when entries omit the date field).
dashValues.sales = [
    { col: 'Q1', val: '10' },
    { col: 'Q1', val: '20' },
    { col: 'Q2', val: '30' }
];
assertEqual(
    dashGetColValDetails('Sales', 'Q1'),
    '10, 20',
    'column details list each entry in the matching column'
);

// Labels and dates produce a "date [label]: value" prefix.
dashValues.expenses = [
    { date: '20260105', val: '50', 'Метка': 'office' },
    { date: '20260106', val: '70', 'Метка': '' }
];
assertEqual(
    dashGetValDetails('Expenses', '20260101', '20260131', 'office'),
    '20260105 [office]: 50',
    'label filter restricts details and surfaces the label in the prefix'
);

// Panel-scoped values shadow the global store.
dashPanelValues.dash1 = {
    revenue: [
        { date: '20260201', val: '777' }
    ]
};
assertEqual(
    dashGetValDetails('Revenue', '20260101', '20260331', undefined, 'dash1'),
    '20260201: 777',
    'panel scope must take precedence over the global dashValues store'
);
`;

vm.runInNewContext(code, { console });
console.log('issue-2677 dashboard cell title details: ok');
