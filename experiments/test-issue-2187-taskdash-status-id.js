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

const code = `
const TASKDASH_REPORT_ID = '155675';
const TASKDASH_FILTER_NAMES = ['месяц', 'департамент', 'статус задачи'];

${extractFunction('taskdashCellText')}
${extractFunction('taskdashEncodeParam')}
${extractFunction('taskdashFilterKey')}
${extractFunction('taskdashIsStatusColumn')}
${extractFunction('taskdashStatusFilterColumn')}
${extractFunction('taskdashParseReference')}
${extractFunction('taskdashStatusIdsFromFilter')}
${extractFunction('taskdashStatusFilterValue')}
${extractFunction('taskdashStatusIdFromRow')}
${extractFunction('taskdashFormatDateForApi')}
${extractFunction('taskdashIsDateColumn')}
${extractFunction('taskdashIsMetricColumn')}
${extractFunction('taskdashIsDashboardFilterColumn')}
${extractFunction('taskdashIsServiceColumn')}
${extractFunction('taskdashGetTableColumns')}
${extractFunction('taskdashBuildReportUrl')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const columns = [
    { id: '155682', name: 'Месяц', format: 'SHORT' },
    { id: '155679', name: 'Департамент', format: 'SHORT' },
    { id: '155724', name: 'Статус задачи', type: '8907', format: 'SHORT', granted: 1, ref: 1, orig: '2685' }
];

const singleUrl = taskdashBuildReportUrl('sportzania', columns, {
    '155724': { value: '9002' }
});
assert(singleUrl.includes('FR_%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81ID=9002'),
    'single task status filter must be sent as FR_СтатусID=9002');
assert(!singleUrl.includes('%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81%20%D0%B7%D0%B0%D0%B4%D0%B0%D1%87%D0%B8'),
    'status filter must not use the status-name column');
assert(!singleUrl.includes('%25'),
    'status ID filter must not be wrapped in contains wildcards');

const multiUrl = taskdashBuildReportUrl('sportzania', columns, {
    '155724': { value: '9002,44895' }
});
assert(multiUrl.includes('FR_%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81ID=IN(9002%2C44895)'),
    'multiple task statuses must be sent as FR_СтатусID=IN(9002,44895)');

const deduped = taskdashStatusFilterValue(taskdashStatusIdsFromFilter('9002, 44895,9002'));
assert(deduped === 'IN(9002,44895)', 'status IDs must be trimmed and deduplicated before URL generation');

const parsed = taskdashParseReference('44895:Принята');
assert(parsed.id === '44895' && parsed.name === 'Принята',
    'reference values formatted as id:name must expose the ID for filters and name for labels');

assert(taskdashStatusIdFromRow({ 'Статус задачи': 'Принята', 'СтатусID': '44895' }) === '44895',
    'status filter options must read IDs from a companion СтатусID field when present');

const tableColumns = taskdashGetTableColumns([
    { id: '155682', name: 'Месяц', format: 'SHORT' },
    { id: '155724', name: 'Статус задачи', format: 'SHORT' },
    { id: '155725', name: 'СтатусID', format: 'SHORT' }
]);
assert(tableColumns.map(function(column) { return column.name; }).join(',') === 'Месяц,Статус задачи',
    'service companion field СтатусID must not be rendered in the dashboard table');
`;

vm.runInNewContext(code, { console });
console.log('issue-2187 task dashboard status ID filters: ok');
