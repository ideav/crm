/**
 * Issue #2467 regression coverage for the ProcVac archive month filter.
 *
 * Run with: node experiments/test-issue-2467-procvac-archive-all-months.js
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
assertEqual(typeof helpers.renderArchiveMonthFilter, 'function', 'archive month select renderer is exposed');
assertEqual(typeof helpers.normalizeArchiveMonthSelection, 'function', 'archive month selection normalizer is exposed');

const archiveRows = [
    { id: 1, rawValues: { startDate: '10.02.2026' }, values: { startDate: '10.02.2026' } },
    { id: 2, rawValues: { startDate: '15.01.2026' }, values: { startDate: '15.01.2026' } },
    { id: 3, rawValues: { startDate: '28.02.2026' }, values: { startDate: '28.02.2026' } },
];

const options = helpers.getArchiveMonthOptions(archiveRows);
assertDeepEqual(
    options,
    [
        { key: '2026-02', label: 'фев 2026' },
        { key: '2026-01', label: 'янв 2026' },
    ],
    'concrete archive months stay sorted newest first',
);

const defaultSelection = helpers.normalizeArchiveMonthSelection(options);
assertEqual(defaultSelection, '', 'archive month filter defaults to the all-months option');
assertDeepEqual(
    helpers.filterRowsByArchiveMonth(archiveRows, defaultSelection).map((row) => row.id),
    [1, 2, 3],
    'all-months archive selection keeps every archive row',
);

const monthFilterHtml = helpers.renderArchiveMonthFilter(options, defaultSelection);
assert(monthFilterHtml.includes('<option value="" selected>Все</option>'), 'archive month filter renders selected all-months option');
assert(
    monthFilterHtml.indexOf('Все') < monthFilterHtml.indexOf('фев 2026'),
    'all-months option is rendered before concrete month options',
);
assert(
    monthFilterHtml.indexOf('фев 2026') < monthFilterHtml.indexOf('янв 2026'),
    'concrete month options keep descending order after all-months option',
);

console.log('issue-2467 procvac archive all months: ok');
