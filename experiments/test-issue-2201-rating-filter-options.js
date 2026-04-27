const fs = require('fs');
const vm = require('vm');

const sourcePath = 'templates/sportzania/rating.html';
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function extractFunction(name, optional = false) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) {
        if (optional) return '';
        throw new Error('Missing function ' + name);
    }

    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

const sample = {
    columns: [
        { id: '155773', format: 'SHORT', granted: 1, name: 'ФИО', type: '2948' },
        { id: '155775', format: 'SHORT', granted: 1, name: 'Департамент', type: '2859' },
        { id: '155787', format: 'SHORT', name: 'Закрыто', type: '' },
        { id: '155779', format: 'SHORT', name: 'В срок', type: '' },
        { id: '155790', format: 'SHORT', name: 'Задач', type: '' },
        { id: '155796', format: 'SHORT', name: 'Срок', type: '' }
    ],
    data: [
        ['Дарья', 'Дарья', 'Анна'],
        ['HR', 'HR', 'Коммерческий департамент'],
        ['100', '50', '75'],
        ['100', '90', '80'],
        ['10', '30', '20'],
        ['20260101', '20260201', '20260101']
    ],
    header: 'Задачи - рейтинг'
};

const code = `
const RATING_FILTER_NAMES = ['срок', 'департамент', 'фио'];
var ratingState = {
    rows: [],
    filterOptions: {}
};

${extractFunction('ratingNormalizeResponse')}
${extractFunction('ratingNormalizeColumn')}
${extractFunction('ratingValueAt')}
${extractFunction('ratingIsDateColumn')}
${extractFunction('ratingIsRatingFilterColumn')}
${extractFunction('ratingCellText')}
${extractFunction('ratingFilterOptionKey', true)}
${extractFunction('ratingPushFilterValue', true)}
${extractFunction('ratingCollectFilterValues')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const normalized = ratingNormalizeResponse(${JSON.stringify(sample)});
const nameColumn = normalized.columns[0];
const departmentColumn = normalized.columns[1];

ratingState.rows = normalized.rows;
let departmentOptions = ratingCollectFilterValues(departmentColumn, '').map(function(item) { return item.value; });
assert(departmentOptions.includes('HR') && departmentOptions.includes('Коммерческий департамент'),
    'initial department select must include all loaded departments');

ratingState.rows = normalized.rows.filter(function(row) { return row['Департамент'] === 'HR'; });
departmentOptions = ratingCollectFilterValues(departmentColumn, 'HR').map(function(item) { return item.value; });
assert(departmentOptions.includes('Коммерческий департамент'),
    'department select must keep other loaded departments after choosing HR');

ratingState.rows = normalized.rows;
let nameOptions = ratingCollectFilterValues(nameColumn, '').map(function(item) { return item.value; });
assert(nameOptions.includes('Дарья') && nameOptions.includes('Анна'),
    'initial ФИО select must include all loaded names');

ratingState.rows = normalized.rows.filter(function(row) { return row['ФИО'] === 'Дарья'; });
nameOptions = ratingCollectFilterValues(nameColumn, 'Дарья').map(function(item) { return item.value; });
assert(nameOptions.includes('Анна'),
    'ФИО select must keep other loaded names after choosing Дарья');
`;

vm.runInNewContext(code, { console });
console.log('issue-2201 rating filter options: ok');
