const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('templates/dash.html', 'utf8');

function assertSource(condition, message) {
    if (!condition) throw new Error(message);
}

assertSource(source.includes("report/155564?JSON_KV"),
    'dashboard must fetch the matrix values report exactly by report/155564?JSON_KV');
assertSource(source.includes('data-matrix-val-id'),
    'rendered matrix cells must remember valID for later edit/delete');
assertSource(source.includes("src === 'rg' || src === 'value' || src === 'matrix'"),
    'matrix cells must use the inline editor route');
assertSource(!source.includes("src === 'report' || src === 'mu' || src === 'linesum' || src === 'rgformula'"),
    'RG formula cells must no longer show the read-only tooltip path');

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

const code = `
let dashMatrixValues = [];
function dashTrace() {}

${extractFunction('dashNormalizeMatrixKey')}
${extractFunction('dashMatrixLabelScore')}
${extractFunction('dashMatrixLabelMatches')}
${extractFunction('dashFindMatrixValue')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(dashMatrixLabelMatches('B2C лагеря / Новая Истра', 'Новая Истра'),
    'non-empty matrix label must match as a substring of dashboard label');
assert(dashMatrixLabelMatches('Новая Истра', 'B2C лагеря / Новая Истра'),
    'non-empty dashboard label must match as a substring of matrix label');
assert(dashMatrixLabelMatches('', ''),
    'empty labels must match each other');
assert(!dashMatrixLabelMatches('B2C лагеря', ''),
    'empty matrix label must not match a non-empty dashboard label');
assert(!dashMatrixLabelMatches('', 'Новая Истра'),
    'non-empty matrix label must not match an empty dashboard label');

dashMatrixValues = [
    { val: '111', line: 'NPS родителей', col: '17-19 апреля', 'Метка': 'Новая Истра', valID: '101' },
    { val: '777', line: 'NPS родителей', col: '17-19 апреля', 'Метка': '', valID: '102' },
    { val: '999', line: 'NPS родителей', col: '20-22 апреля', 'Метка': 'Новая Истра', valID: '103' },
    { val: '333', line: 'CSI', col: '17-19 апреля', 'Метка': 'Новая Истра', valID: '104' }
];

let match = dashFindMatrixValue('nps родителей', '17-19 АПРЕЛЯ', 'B2C лагеря / Новая Истра');
assert(match && match.val === '111' && match.valID === '101',
    'matrix lookup must match line, col, substring label, and remember valID');

match = dashFindMatrixValue('NPS родителей', '17-19 апреля', '');
assert(match && match.val === '777' && match.valID === '102',
    'matrix lookup must use the both-empty-label rule');

match = dashFindMatrixValue('NPS родителей', '17-19 апреля', 'Другая метка');
assert(!match, 'matrix lookup must reject unrelated non-empty labels');
`;

vm.runInNewContext(code, { console });
console.log('issue-2148 dashboard matrix lookup: ok');
