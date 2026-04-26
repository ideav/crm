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

assert(!source.includes('<span>Применить</span>'),
    'filter panel must not render a manual apply button');
assert(!source.includes('id="taskdash-refresh"'),
    'filter UI must not keep the refresh button');
assert(!source.includes('id="taskdash-reset"'),
    'filter UI must not keep the reset button');
assert(source.includes('Очистить фильтр'),
    'the only visible filter action must be Очистить фильтр');
assert(source.includes('taskdash-quick-link'),
    'month filter must render dashed-underlined quick links');

const code = `
const TASKDASH_REPORT_ID = '155675';
const TASKDASH_FILTER_NAMES = ['месяц', 'департамент', 'статус задачи'];

${extractFunction('taskdashNormalizeColumn')}
${extractFunction('taskdashFindColumn')}
${extractFunction('taskdashFormatDateForApi')}
${extractFunction('taskdashEncodeParam')}
${extractFunction('taskdashFilterKey')}
${extractFunction('taskdashIsDateColumn')}
${extractFunction('taskdashIsMetricColumn')}
${extractFunction('taskdashIsDashboardFilterColumn')}
${extractFunction('taskdashGetFilterColumns')}
${extractFunction('taskdashCreateDefaultFilters')}
${extractFunction('taskdashBuildReportUrl')}
${extractFunction('taskdashCreateQuickRanges')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const columns = [
    { id: '155682', type: '', format: 'SHORT', name: 'Месяц' },
    { id: '155679', type: '2953', format: 'SHORT', name: 'Департамент', granted: 1, ref: 1, orig: '2859' },
    { id: '155683', type: '', format: 'SHORT', name: 'Отложена' },
    { id: '155684', type: '', format: 'SHORT', name: 'Завершена' },
    { id: '155685', type: '', format: 'SHORT', name: 'В работе' },
    { id: '155721', type: '', format: 'SHORT', name: 'Сотрудников' },
    { id: '155724', type: '8907', format: 'SHORT', name: 'Статус задачи', granted: 1, ref: 1, orig: '2685' }
].map(taskdashNormalizeColumn);

const filterNames = taskdashGetFilterColumns(columns).map(function(column) { return column.name; });
assert(JSON.stringify(filterNames) === JSON.stringify(['Месяц', 'Департамент', 'Статус задачи']),
    'dashboard filters must be limited to month, department, and task status');
assert(!taskdashIsDashboardFilterColumn(columns[2]),
    'metric columns must not be dashboard filters');

const defaults = taskdashCreateDefaultFilters(2026, columns);
assert(Object.keys(defaults).length === 1,
    'default filters must only initialize the month range');
assert(defaults['155682'].from === '2026-01-01' && defaults['155682'].to === '2026-12-31',
    'default month range must cover the current year');

defaults['155679'] = { value: 'HR' };
defaults['155724'] = { value: 'Завершена' };
defaults['155683'] = { from: '1', to: '2' };
const url = taskdashBuildReportUrl('sportzania', columns, defaults);
assert(url.includes('FR_%D0%9C%D0%B5%D1%81%D1%8F%D1%86=01.01.2026'),
    'month lower bound must still be sent to the report API');
assert(url.includes('TO_%D0%9C%D0%B5%D1%81%D1%8F%D1%86=31.12.2026'),
    'month upper bound must still be sent to the report API');
assert(url.includes('FR_%D0%94%D0%B5%D0%BF%D0%B0%D1%80%D1%82%D0%B0%D0%BC%D0%B5%D0%BD%D1%82=%25HR%25'),
    'department filter must be sent as a report filter');
assert(url.includes('FR_%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81%20%D0%B7%D0%B0%D0%B4%D0%B0%D1%87%D0%B8=%25%D0%97%D0%B0%D0%B2%D0%B5%D1%80%D1%88%D0%B5%D0%BD%D0%B0%25'),
    'task status filter must be sent as a report filter');
assert(!url.includes('%D0%9E%D1%82%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B0'),
    'stale metric filters must not be included in report URLs');

const ranges = taskdashCreateQuickRanges(new Date(2026, 3, 26));
function range(key) {
    return ranges.filter(function(item) { return item.key === key; })[0];
}
assert(range('current-year').from === '2026-01-01' && range('current-year').to === '2026-12-31',
    'current year shortcut must set the full 2026 range');
assert(range('previous-year').from === '2025-01-01' && range('previous-year').to === '2025-12-31',
    'previous year shortcut must set the full 2025 range');
assert(range('current-month').from === '2026-04-01' && range('current-month').to === '2026-04-30',
    'current month shortcut must set April 2026');
assert(range('previous-month').from === '2026-03-01' && range('previous-month').to === '2026-03-31',
    'previous month shortcut must set March 2026');
`;

vm.runInNewContext(code, { console, Date });
console.log('issue-2182 task dashboard filters: ok');
