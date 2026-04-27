const fs = require('fs');
const vm = require('vm');

const sourcePath = 'templates/sportzania/rating.html';
const source = fs.readFileSync(sourcePath, 'utf8');

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

assert(source.includes("RATING_REPORT_ID = '155768'"),
    'performer rating must load data from report 155768');
assert(source.includes('Рейтинг исполнителей'),
    'rating page must render the performer rating title');
assert(source.includes('ФИО'),
    'rating page must include the additional full-name filter');

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
const RATING_REPORT_ID = '155768';
const RATING_FILTER_NAMES = ['срок', 'департамент', 'фио'];

${extractFunction('ratingNormalizeResponse')}
${extractFunction('ratingNormalizeColumn')}
${extractFunction('ratingValueAt')}
${extractFunction('ratingFindColumn')}
${extractFunction('ratingParseNumber')}
${extractFunction('ratingParseDateValue')}
${extractFunction('ratingMonthKey')}
${extractFunction('ratingMonthLabel')}
${extractFunction('ratingDateSortKey')}
${extractFunction('ratingFormatDateForApi')}
${extractFunction('ratingEncodeParam')}
${extractFunction('ratingFilterKey')}
${extractFunction('ratingIsDateColumn')}
${extractFunction('ratingIsMetricColumn')}
${extractFunction('ratingIsRatingFilterColumn')}
${extractFunction('ratingGetFilterColumns')}
${extractFunction('ratingCreateDefaultFilters')}
${extractFunction('ratingReconcileFilters')}
${extractFunction('ratingBuildReportUrl')}
${extractFunction('ratingValueAsNumber')}
${extractFunction('ratingScore')}
${extractFunction('ratingCellText')}
${extractFunction('ratingAggregatePerformers')}
${extractFunction('ratingBuildSummary')}
${extractFunction('ratingFormatPercent')}
${extractFunction('ratingFormatNumber')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const normalized = ratingNormalizeResponse(${JSON.stringify(sample)});
assert(normalized.columns.length === 6, 'column-major response must preserve all rating columns');
assert(normalized.rows.length === 3, 'column-major response must become row objects');
assert(normalized.rows[1]['ФИО'] === 'Дарья' && normalized.rows[2]['Срок'] === '20260101',
    'row objects must be keyed by the attached response column names');

const filterNames = ratingGetFilterColumns(normalized.columns).map(function(column) { return column.name; });
assert(JSON.stringify(filterNames) === JSON.stringify(['Срок', 'Департамент', 'ФИО']),
    'rating filters must use the shared period/department filters and add ФИО');
assert(!ratingIsRatingFilterColumn(normalized.columns[2]),
    'metric columns must not become report filters');
assert(!ratingIsDateColumn(normalized.columns[3]),
    'В срок metric must not be treated as the shared period filter');

const defaults = ratingCreateDefaultFilters(2026, normalized.columns);
assert(defaults['155796'].from === '2026-01-01' && defaults['155796'].to === '2026-12-31',
    'default rating period must cover the current calendar year');

defaults['155775'] = { value: 'Коммерческий' };
defaults['155773'] = { value: 'Дарья' };
defaults['155787'] = { from: '1', to: '3' };
const url = ratingBuildReportUrl('sportzania', normalized.columns, defaults);
assert(url.startsWith('/sportzania/report/155768?JSON_KV&'),
    'rating URL must use the Sportzania database and report 155768');
assert(url.includes('FR_%D0%A1%D1%80%D0%BE%D0%BA=01.01.2026'),
    'period lower bound must be sent as FR_Срок');
assert(url.includes('TO_%D0%A1%D1%80%D0%BE%D0%BA=31.12.2026'),
    'period upper bound must be sent as TO_Срок');
assert(url.includes('FR_%D0%94%D0%B5%D0%BF%D0%B0%D1%80%D1%82%D0%B0%D0%BC%D0%B5%D0%BD%D1%82=%25%D0%9A%D0%BE%D0%BC%D0%BC%D0%B5%D1%80%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%25'),
    'department filter must be sent as a contains report filter');
assert(url.includes('FR_%D0%A4%D0%98%D0%9E=%25%D0%94%D0%B0%D1%80%D1%8C%D1%8F%25'),
    'ФИО filter must be sent as a contains report filter');
assert(!url.includes('%D0%97%D0%B0%D0%BA%D1%80%D1%8B%D1%82%D0%BE'),
    'metric columns must not be sent as report filters');

const performers = ratingAggregatePerformers(normalized.rows, normalized.columns);
assert(performers.length === 2, 'rows with the same performer and department must be aggregated');
assert(performers[0].name === 'Дарья' && performers[0].tasks === 40,
    'performers must be sorted by score and then task count');
const darya = performers.filter(function(item) { return item.name === 'Дарья'; })[0];
assert(darya.tasks === 40, 'performer task count must be summed');
assert(ratingFormatPercent(darya.closedRate) === '62.5%',
    'closed percentage must be task-weighted across performer rows');
assert(ratingFormatPercent(darya.onTimeRate) === '92.5%',
    'on-time percentage must be task-weighted across performer rows');
assert(ratingFormatPercent(darya.score) === '77.5%',
    'rating score must average the weighted closed and on-time percentages');

const summary = ratingBuildSummary(performers);
assert(summary.performers === 2 && summary.tasks === 60,
    'summary must count performers and total tasks');
assert(ratingFormatPercent(summary.avgScore) === '77.5%',
    'summary average score must be weighted by task count');
assert(ratingFormatNumber(1234567.89) === '1 234 567.89',
    'rating metric formatting must keep thousands separators');
`;

vm.runInNewContext(code, { console });
console.log('issue-2199 performer rating: ok');
