/**
 * Issue #2218 regression coverage for ProcVac column layout and rendering.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const sourcePath = path.join(rootDir, 'js', 'procvac.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
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

assert(!source.includes("label: 'Интервью HR'"), 'HR interview column is not rendered');
assert(!source.includes("label: 'Рекомендации'"), 'recommendations column is not rendered');
assert(!source.includes("label: 'Интервью с НМ'"), 'manager interview column is not rendered');
assert(source.includes("label: 'События'"), 'events column is rendered instead');

const sandbox = {
    console,
    window: {
        db: 'demo',
        location: { pathname: '/demo/procvac', search: '' },
    },
    document: {
        addEventListener() {},
        cookie: '',
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
    'display columns match issue #2218',
);
assert(!columns.some((col) => ['interviewHr', 'recommendations', 'interviewNm'].includes(col.key)), 'removed columns are absent by key');
assertEqual(columns.find((col) => col.key === 'events').editable, false, 'events column is read-only');
assertEqual(columns.find((col) => col.key === 'comments').source.index, 14, 'comments remain mapped after hidden interview fields');

assertEqual(helpers.calculateWeeksInWork('01.04.2026', new Date(2026, 3, 12, 12)), '2', 'weeks in work are rounded arithmetically');
assertEqual(helpers.calculateWeeksInWork('20.04.2026', new Date(2026, 3, 12, 12)), '0', 'future start dates clamp to zero weeks');

const row = helpers.normalizeRow(
    {
        i: 8162,
        r: ['Менеджер', '8158:В работе', '2870:Департамент детских лагерей', '1', '', '', '2616:darias', '01.04.2026', '31.05.2026', '', '7940:Штат', '1', '2', '3', ''],
    },
    columns,
    new Date(2026, 3, 12, 12),
);
assertEqual(row.values.department, 'ДДЛ', 'department names are abbreviated to uppercase initials');

const eventsHtml = helpers.renderCell(row, columns.find((col) => col.key === 'events'), 'active');
assert(eventsHtml.includes('href="/demo/table/5616?F_U=8162"'), 'events link points to the row events table');
assert(eventsHtml.includes('target="_blank"'), 'events link opens in a new tab');
assert(eventsHtml.includes('pi-calendar'), 'events link renders an icon');

const statusColumn = columns.find((col) => col.key === 'status');
[
    ['В работе', 'procvac-status--in-work'],
    ['Не начато', 'procvac-status--not-started'],
    ['Оффер принят', 'procvac-status--offer-accepted'],
    ['Вышел', 'procvac-status--joined'],
    ['Пауза', 'procvac-status--pause'],
    ['Оффер', 'procvac-status--offer'],
].forEach(([label, className]) => {
    const statusRow = {
        id: label,
        values: { status: label },
        rawValues: { status: label },
    };
    assert(helpers.renderCell(statusRow, statusColumn, 'active').includes(className), `${label} status gets ${className}`);
});

const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
[
    'procvac-status--in-work',
    'procvac-status--not-started',
    'procvac-status--offer-accepted',
    'procvac-status--joined',
    'procvac-status--pause',
    'procvac-status--offer',
].forEach((className) => {
    assert(css.includes(`.${className}`), `${className} style is defined`);
});

console.log('issue-2218 procvac rendering: ok');
