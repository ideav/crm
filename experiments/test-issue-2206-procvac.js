/**
 * Issue #2206 regression coverage for the procvac workplace.
 *
 * The UI code exposes pure helpers through window.ProcVacTesting so these
 * requirements can be verified without a browser or live Integram server.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'js', 'procvac.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
    console,
    window: {},
    document: {
        addEventListener() {},
    },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    Date,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: sourcePath });

const helpers = sandbox.window.ProcVacTesting;
if (!helpers) {
    throw new Error('window.ProcVacTesting is not exposed');
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const metadata = {
    id: '8137',
    type: '3',
    val: 'Вакансия актуальная',
    granted: 'WRITE',
    reqs: [
        { id: '8140', val: 'Статус вакансии', type: '3', ref_id: '8139', orig: '8138' },
        { id: '8141', val: 'Департамент', type: '3', ref_id: '2860', orig: '2859' },
        { id: '8143', val: 'План', type: '13' },
        { id: '8145', val: 'Факт', type: '13' },
        { id: '8147', val: 'Заявка', type: '8' },
        { id: '8148', val: 'Пользователь', type: '3', ref_id: '2670', orig: '18' },
        { id: '8150', val: 'Старт работы', type: '9' },
        { id: '8152', val: 'Дедлайн', type: '9' },
        { id: '8153', val: 'Выход', type: '9' },
        { id: '8154', val: 'Тип найма', type: '3', ref_id: '7932', orig: '7931' },
        { id: '8210', val: 'Интервью HR', type: '13' },
        { id: '8211', val: 'Рекомендации', type: '13' },
        { id: '8212', val: 'Интервью с НМ', type: '13' },
        { id: '8156', val: 'Комментарии', type: '3' },
    ],
};

const columns = helpers.buildColumns(metadata);
assertDeepEqual(
    columns.map((col) => col.label),
    [
        'Вакансия актуальная',
        'Статус',
        'Отдел',
        'План',
        'Факт',
        'Заявка',
        'Ответственный',
        'Старт работы',
        'Дедлайн',
        'Выход',
        'Штат/Лагерь/ОШ',
        'Недель в работе',
        'События',
        'Комментарии',
    ],
    'display columns match the workplace specification',
);
assertEqual(columns.find((col) => col.key === 'weeksInWork').editable, false, 'weeks column is read-only');
assertEqual(columns.find((col) => col.key === 'events').editable, false, 'events column is read-only');
assertEqual(columns.find((col) => col.key === 'status').source.id, '8140', 'status column maps by metadata name');
assertEqual(columns.find((col) => col.key === 'comments').source.index, 14, 'comments stay mapped after optional fields');

const sampleMetadataWithoutOptionalInterviewFields = {
    id: '8137',
    type: '3',
    val: 'Вакансия актуальная',
    granted: 'WRITE',
    reqs: metadata.reqs.filter((req) => !['8210', '8211', '8212'].includes(req.id)),
};
const sampleColumns = helpers.buildColumns(sampleMetadataWithoutOptionalInterviewFields);
assertEqual(sampleColumns.length, 14, 'workspace still renders all requested columns when optional fields are absent');
assertEqual(sampleColumns.find((col) => col.key === 'comments').source.index, 11, 'comments map to the sample metadata comments column');
assert(!sampleColumns.some((col) => col.key === 'interviewHr'), 'removed optional fields are not rendered');

const rows = [
    {
        i: 8162,
        r: ['Менеджер', '8158:В работе', '2870:Департамент дополнительного', '1', '', '', '2616:darias', '13.04.2026', '31.05.2026', '', '7940:Штат', '', '', '', ''],
    },
    {
        i: 8172,
        r: ['директор', '8173:Вышел', '2869:Департамент лагерей', '1', '1', '', '2616:darias', '14.04.2026', '15.05.2026', '22.04.2026', '7940:Штат', '', '', '', ''],
    },
    {
        i: 8200,
        r: ['Педагог ТМХ', '8185:Пауза', '2870:Департамент образования', '6', '', 'https://docs.google.com/doc', '2989:alisay', '', '15.04.2026', '', '7934:B2B-проект', '', '', '', '5 +1 в резерв'],
    },
    {
        i: 9000,
        r: ['Архивная', '8185:Пауза', '2870:Департамент образования', '6', '', '', '2989:alisay', '01.02.2026', '15.03.2026', '', '7934:B2B-проект', '', '', '', ''],
    },
];

const normalized = rows.map((row) => helpers.normalizeRow(row, columns, new Date('2026-04-27T12:00:00Z')));
assertEqual(normalized[0].values.weeksInWork, '2', 'weeks in work are derived from start date');
assertEqual(normalized[0].values.department, 'ДД', 'department names are abbreviated for display');
assertEqual(normalized[2].values.request, 'https://docs.google.com/doc', 'request URL is preserved for icon rendering');

const sections = helpers.groupRows(normalized, new Date('2026-04-27T12:00:00Z'));
assertDeepEqual(sections.active.map((row) => row.id), [8162], 'active section includes only in-progress/not-started vacancies');
assertDeepEqual(sections.closedThisMonth.map((row) => row.id), [8172, 8200], 'closed this month uses exit date or empty-exit deadline');
assertDeepEqual(sections.archive.map((row) => row.id), [9000], 'archive contains everything else');

const filtered = helpers.filterRows(normalized, 'педагог');
assertDeepEqual(filtered.map((row) => row.id), [8200], 'quick search scans all displayed fields case-insensitively');

const highlighted = helpers.highlightText('Педагог ТМХ', 'педагог');
assert(highlighted.indexOf('<mark>Педагог</mark>') !== -1, 'quick search highlights matching text');

const docHtml = helpers.renderDocumentLink('https://docs.google.com/doc');
assert(docHtml.indexOf('pi-file') !== -1 && docHtml.indexOf('href="https://docs.google.com/doc"') !== -1, 'request URL renders as document icon link');

console.log('issue-2206 procvac helpers: ok');
