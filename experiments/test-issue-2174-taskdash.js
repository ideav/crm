const fs = require('fs');
const vm = require('vm');

const sourcePath = 'templates/sportzania/taskdash.html';
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

assert(source.includes("TASKDASH_REPORT_ID = '155675'"),
    'task dashboard must load data from report 155675');
assert(source.includes('FR_') && source.includes('TO_'),
    'task dashboard must build report FR_/TO_ filters');

const sample = {
    columns: [
        { id: '155682', type: '', format: 'SHORT', name: 'Месяц' },
        { id: '155679', type: '2953', format: 'SHORT', name: 'Департамент', granted: 1, ref: 1, orig: '2859' },
        { id: '155683', type: '', format: 'SHORT', name: 'Отложена' },
        { id: '155684', type: '', format: 'SHORT', name: 'Завершена' },
        { id: '155685', type: '', format: 'SHORT', name: 'В работе' },
        { id: '155721', type: '', format: 'SHORT', name: 'Сотрудников' },
        { id: '155724', type: '8907', format: 'SHORT', name: 'Статус задачи', granted: 1, ref: 1, orig: '2685' }
    ],
    data: [
        ['20250101', '20250101', '20250201'],
        ['', 'Коммерческий департамент', 'HR'],
        ['0', '1', '2'],
        ['48', '6', '67'],
        ['0', '3', '4'],
        ['2', '1', '2'],
        ['Завершена', 'Завершена', 'Принята']
    ],
    header: 'Дэшборд - Задачи'
};

const code = `
const TASKDASH_REPORT_ID = '155675';
const TASKDASH_FILTER_NAMES = ['месяц', 'департамент', 'статус задачи'];

${extractFunction('taskdashNormalizeResponse')}
${extractFunction('taskdashNormalizeColumn')}
${extractFunction('taskdashValueAt')}
${extractFunction('taskdashFindColumn')}
${extractFunction('taskdashParseNumber')}
${extractFunction('taskdashParseDateValue')}
${extractFunction('taskdashMonthKey')}
${extractFunction('taskdashMonthLabel')}
${extractFunction('taskdashFormatDateForApi')}
${extractFunction('taskdashEncodeParam')}
${extractFunction('taskdashFilterKey')}
${extractFunction('taskdashIsStatusColumn')}
${extractFunction('taskdashStatusFilterColumn')}
${extractFunction('taskdashParseReference')}
${extractFunction('taskdashStatusIdsFromFilter')}
${extractFunction('taskdashStatusFilterValue')}
${extractFunction('taskdashStatusIdFromRow')}
${extractFunction('taskdashIsDateColumn')}
${extractFunction('taskdashIsMetricColumn')}
${extractFunction('taskdashIsDashboardFilterColumn')}
${extractFunction('taskdashGetFilterColumns')}
${extractFunction('taskdashCreateDefaultFilters')}
${extractFunction('taskdashReconcileFilters')}
${extractFunction('taskdashSafeId')}
${extractFunction('taskdashBuildReportUrl')}
${extractFunction('taskdashBuildMonthlySeries')}
${extractFunction('taskdashValueAsNumber')}
${extractFunction('taskdashFormatNumber')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const normalized = taskdashNormalizeResponse(${JSON.stringify(sample)});
assert(normalized.columns.length === 7, 'column-major JSON must preserve all columns');
assert(normalized.rows.length === 3, 'column-major JSON must become row objects');
assert(normalized.rows[1]['Департамент'] === 'Коммерческий департамент',
    'row object must use column names as keys');
assert(normalized.rows[2]['Статус задачи'] === 'Принята',
    'last text field must be parsed from the matching data column');

const defaults = taskdashCreateDefaultFilters(2026, normalized.columns);
assert(defaults['155682'].from === '2026-01-01' && defaults['155682'].to === '2026-12-31',
    'default filter must cover the current calendar year for the month field');
assert(Object.keys(defaults).length === 1,
    'default filters must not initialize metric ranges');
assert(!taskdashIsMetricColumn(normalized.columns[6]),
    'status field must not be treated as a numeric metric filter');
assert(taskdashGetFilterColumns(normalized.columns).map(function(column) { return column.name; }).join(',') === 'Месяц,Департамент,Статус задачи',
    'dashboard filters must be limited to the requested fields');

const kvResponse = taskdashNormalizeResponse([
    { 'Месяц': '20260101', 'Департамент': 'HR', 'Завершена': '10' }
]);
const reconciled = taskdashReconcileFilters(normalized.columns, kvResponse.columns, defaults);
assert(reconciled['Месяц'].from === '2026-01-01' && reconciled['Месяц'].to === '2026-12-31',
    'filters must survive JSON_KV responses whose inferred column IDs are names');
assert(!/\\s/.test(taskdashSafeId('Статус задачи')),
    'generated datalist IDs must not contain spaces');

defaults['155679'] = { value: 'Коммерческий' };
defaults['155724'] = { value: '44895' };
defaults['155683'] = { from: '1', to: '3' };
const url = taskdashBuildReportUrl('sportzania', normalized.columns, defaults);
assert(url.startsWith('/sportzania/report/155675?JSON_KV&'),
    'report URL must use the Sportzania database and report 155675');
assert(url.includes('FR_%D0%9C%D0%B5%D1%81%D1%8F%D1%86=01.01.2026'),
    'month lower bound must be sent as FR_Месяц');
assert(url.includes('TO_%D0%9C%D0%B5%D1%81%D1%8F%D1%86=31.12.2026'),
    'month upper bound must be sent as TO_Месяц');
assert(url.includes('FR_%D0%94%D0%B5%D0%BF%D0%B0%D1%80%D1%82%D0%B0%D0%BC%D0%B5%D0%BD%D1%82=%25%D0%9A%D0%BE%D0%BC%D0%BC%D0%B5%D1%80%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%25'),
    'text filters must be sent as contains filters');
assert(url.includes('FR_%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81ID=44895'),
    'task status filters must be sent by status ID');
assert(!url.includes('%D0%9E%D1%82%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B0'),
    'metric filters must not be sent for the issue 2182 dashboard filter set');

const series = taskdashBuildMonthlySeries(normalized.rows, normalized.columns);
assert(series.length === 2, 'chart series must group rows by month');
assert(series[0].key === '2025-01', 'first grouped month must be January 2025');
assert(series[0].completed === 54 && series[0].active === 3 && series[0].delayed === 1,
    'monthly chart series must sum task counters');
assert(series[0].label === 'Янв 2025', 'monthly labels must be readable Russian short labels');
assert(taskdashFormatNumber(1234567.89) === '1 234 567.89',
    'metric formatting must keep thousands separators after template-safe regex rewrite');
`;

vm.runInNewContext(code, { console });
console.log('issue-2174 task dashboard: ok');
