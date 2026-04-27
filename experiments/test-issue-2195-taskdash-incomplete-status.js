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

assert(source.includes('grid-template-columns: repeat(5, minmax(130px, 1fr));'),
    'desktop KPI grid must have five columns after removing the employee KPI');

const code = `
const TASKDASH_REPORT_ID = '155675';
const TASKDASH_FILTER_NAMES = ['месяц', 'департамент', 'статус задачи'];
const TASKDASH_INCOMPLETE_STATUS_OPTION = { value: '!8925', label: 'Все незавершенные' };

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
${extractFunction('taskdashCollectFilterValues')}
${extractFunction('taskdashBuildReportUrl')}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const columns = [
    { id: '155682', name: 'Месяц', format: 'SHORT' },
    { id: '155724', name: 'Статус задачи', type: '8907', format: 'SHORT', granted: 1, ref: 1, orig: '2685' }
];

var taskdashState = {
    rows: [
        { 'Месяц': '20260101', 'Статус задачи': '8925:Завершена', 'СтатусID': '8925' },
        { 'Месяц': '20260101', 'Статус задачи': '44895:Принята', 'СтатусID': '44895' }
    ]
};

const options = taskdashCollectFilterValues(columns[1], '');
const lastOption = options[options.length - 1];
assert(lastOption.value === '!8925' && lastOption.label === 'Все незавершенные',
    'status filter choices must end with Все незавершенные mapped to !8925');

const selectedOptions = taskdashCollectFilterValues(columns[1], '!8925');
assert(selectedOptions.filter(function(item) { return item.value === '!8925'; }).length === 1,
    'Все незавершенные must not be duplicated when selected');
assert(selectedOptions[selectedOptions.length - 1].label === 'Все незавершенные',
    'selected Все незавершенные option must stay at the end of the status choices');

const url = taskdashBuildReportUrl('sportzania', columns, {
    '155724': { value: '!8925' }
});
assert(url.includes('FR_%D0%A1%D1%82%D0%B0%D1%82%D1%83%D1%81ID=!8925'),
    'Все незавершенные must request FR_СтатусID=!8925');
`;

vm.runInNewContext(code, { console });
console.log('issue-2195 task dashboard incomplete status filter: ok');
