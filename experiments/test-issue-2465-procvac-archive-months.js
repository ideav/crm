/**
 * Issue #2465 regression coverage for ProcVac archive month filtering and
 * active vacancy hire-type summaries.
 *
 * Run with: node experiments/test-issue-2465-procvac-archive-months.js
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

assertEqual(typeof helpers.getArchiveMonthOptions, 'function', 'archive month option helper is exposed');
assertEqual(typeof helpers.filterRowsByArchiveMonth, 'function', 'archive month filtering helper is exposed');
assertEqual(typeof helpers.getSectionHireTypeSummary, 'function', 'hire-type summary helper is exposed');
assertEqual(typeof helpers.renderArchiveMonthFilter, 'function', 'archive month select renderer is exposed');
assertEqual(typeof helpers.renderSectionHireTypeSummary, 'function', 'hire-type summary renderer is exposed');

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
        { id: '8154', val: 'Штат/Лагерь/ОШ', type: '3', ref_id: '7932', orig: '7931' },
        { id: '8156', val: 'Комментарии', type: '3' },
    ],
};
const columns = helpers.buildColumns(metadata);

const rawRows = [
    { i: 1, r: ['Координатор', '8158:В работе', '2870:Департамент', '1', '', '', '2616:darias', '05.03.2026', '31.03.2026', '', '7940:Штат', ''] },
    { i: 2, r: ['Вожатый', '8169:Не начато', '2870:Департамент', '1', '', '', '2616:darias', '07.03.2026', '31.03.2026', '', '7938:Лагерь', ''] },
    { i: 3, r: ['Методист', '8158:В работе', '2870:Департамент', '1', '', '', '2616:darias', '08.03.2026', '31.03.2026', '', '7940:Штат', ''] },
    { i: 4, r: ['ОШ', '8158:В работе', '2870:Департамент', '1', '', '', '2616:darias', '09.03.2026', '31.03.2026', '', '7939:ОШ', ''] },
    { i: 5, r: ['Архив фев 1', '8173:Вышел', '2870:Департамент', '1', '1', '', '2616:darias', '10.02.2026', '20.02.2026', '21.02.2026', '7940:Штат', ''] },
    { i: 6, r: ['Архив янв', '8173:Вышел', '2870:Департамент', '1', '1', '', '2616:darias', '15.01.2026', '25.01.2026', '26.01.2026', '7938:Лагерь', ''] },
    { i: 7, r: ['Архив фев 2', '8185:Пауза', '2870:Департамент', '1', '', '', '2616:darias', '28.02.2026', '28.02.2026', '', '7939:ОШ', ''] },
];
const normalized = rawRows.map((row) => helpers.normalizeRow(row, columns, new Date('2026-03-15T12:00:00Z')));
const grouped = helpers.groupRows(normalized, new Date('2026-03-15T12:00:00Z'));

assertDeepEqual(grouped.active.map((row) => row.id), [1, 2, 3, 4], 'sample active rows are grouped as active vacancies');
assertDeepEqual(grouped.archive.map((row) => row.id), [5, 6, 7], 'sample archived rows are grouped as archive');

const archiveMonthOptions = helpers.getArchiveMonthOptions(grouped.archive);
assertDeepEqual(
    archiveMonthOptions,
    [
        { key: '2026-02', label: 'фев 2026' },
        { key: '2026-01', label: 'янв 2026' },
    ],
    'archive month options use vacancy start month and sort newest first',
);

assertDeepEqual(
    helpers.filterRowsByArchiveMonth(grouped.archive, '2026-02').map((row) => row.id),
    [5, 7],
    'archive month filter keeps only vacancies opened in the selected month',
);

const monthFilterHtml = helpers.renderArchiveMonthFilter(archiveMonthOptions, '2026-02');
assert(monthFilterHtml.includes('id="procvac-archive-month-filter"'), 'archive month filter renders a select control');
assert(monthFilterHtml.indexOf('фев 2026') < monthFilterHtml.indexOf('янв 2026'), 'archive month select keeps descending month order');
assert(monthFilterHtml.includes('value="2026-02" selected'), 'selected archive month is marked');

assertDeepEqual(
    helpers.getSectionHireTypeSummary(grouped.active),
    [
        { key: 'штат', label: 'Штат', count: 2 },
        { key: 'лагерь', label: 'Лагерь', count: 1 },
        { key: 'ош', label: 'ОШ', count: 1 },
    ],
    'active vacancy hire-type summary counts Штат, Лагерь and ОШ in stable order',
);

const activeHireTypeHtml = helpers.renderSectionHireTypeSummary('active', grouped.active);
assert(activeHireTypeHtml.includes('class="procvac-section-hire-types"'), 'active section renders hire-type summary badges');
assert(activeHireTypeHtml.includes('Штат 2'), 'active section includes the Штат count');
assert(activeHireTypeHtml.includes('Лагерь 1'), 'active section includes the Лагерь count');
assert(activeHireTypeHtml.includes('ОШ 1'), 'active section includes the ОШ count');
assertEqual(helpers.renderSectionHireTypeSummary('archive', grouped.archive), '', 'archive header does not render active hire-type summary');

const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
assert(/\.procvac-archive-month-filter\s*{/.test(css), 'archive month filter has a CSS rule');
assert(/\.procvac-section-hire-type-badge\s*{/.test(css), 'hire-type summary badges have a CSS rule');

console.log('issue-2465 procvac archive months: ok');
