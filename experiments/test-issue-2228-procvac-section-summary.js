/**
 * Issue #2228 regression coverage for ProcVac sticky first column and
 * section status summaries.
 *
 * Run with: node experiments/test-issue-2228-procvac-section-summary.js
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

assertEqual(typeof helpers.getSectionStatusSummary, 'function', 'status summary helper is exposed for regression coverage');
assertEqual(typeof helpers.renderSectionHeader, 'function', 'section header renderer is exposed for regression coverage');

const rows = [
    { values: { status: 'В работе' } },
    { values: { status: 'Не начато' } },
    { values: { status: 'В работе' } },
    { values: { status: 'Оффер' } },
    { values: { status: 'Оффер принят' } },
    { values: { status: 'Не начато' } },
    { values: { status: '' } },
];

assertDeepEqual(
    helpers.getSectionStatusSummary(rows),
    [
        { key: 'в работе', label: 'В работе', count: 2 },
        { key: 'не начато', label: 'Не начато', count: 2 },
        { key: 'оффер', label: 'Оффер', count: 1 },
        { key: 'оффер принят', label: 'Оффер принят', count: 1 },
    ],
    'section status summary counts non-empty statuses in stable display order',
);

const activeHeader = helpers.renderSectionHeader('active', 'Актуальные вакансии', rows);
assert(activeHeader.includes('class="procvac-section-statuses"'), 'section header renders the status summary container');
assert(activeHeader.includes('class="procvac-section-status-badge"'), 'section header renders status badges');
assert(activeHeader.includes('В работе 2'), 'section header includes the in-work count badge');
assert(activeHeader.includes('Не начато 2'), 'section header includes the not-started count badge');
assert(activeHeader.indexOf('В работе 2') < activeHeader.indexOf('Не начато 2'), 'known status badges keep their configured order');

const archiveHeader = helpers.renderSectionHeader('archive', 'Архив', rows);
assert(archiveHeader.includes('id="procvac-archive-toggle"'), 'archive section still renders its expand toggle');
assert(archiveHeader.indexOf('procvac-section-statuses') < archiveHeader.indexOf('procvac-archive-toggle'), 'status badges render before the archive toggle');

const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
const titleHeaderRule = css.match(/\.procvac-head-cell--title\s*{[^}]+}/);
assert(titleHeaderRule, 'title header sticky rule exists');
assert(/position:\s*sticky;/.test(titleHeaderRule[0]), 'title header is sticky');
assert(/left:\s*0;/.test(titleHeaderRule[0]), 'title header is pinned to the left edge');
assert(/z-index:\s*[3-9]\d*;/.test(titleHeaderRule[0]), 'title header renders over scrolled header cells');

const titleCellRule = css.match(/\.procvac-cell--title\s*{[^}]+}/);
assert(titleCellRule, 'title cell sticky rule exists');
assert(/position:\s*sticky;/.test(titleCellRule[0]), 'title cells are sticky');
assert(/left:\s*0;/.test(titleCellRule[0]), 'title cells are pinned to the left edge');

const sectionHeaderRule = css.match(/\.procvac-section-row\s+th\s*{[^}]+}/);
assert(sectionHeaderRule, 'section header cell rule exists');
assert(/position:\s*sticky;/.test(sectionHeaderRule[0]), 'orange section rows stay readable during horizontal scroll');
assert(/left:\s*0;/.test(sectionHeaderRule[0]), 'orange section rows are pinned to the left edge');

const sectionHeadRule = css.match(/\.procvac-section-head\s*{[^}]+}/);
assert(sectionHeadRule, 'section header content rule exists');
assert(/position:\s*sticky;/.test(sectionHeadRule[0]), 'orange section row content stays readable during horizontal scroll');
assert(/left:\s*0;/.test(sectionHeadRule[0]), 'orange section row content is pinned to the left edge');

const statusBadgeRule = css.match(/\.procvac-section-status-badge\s*{[^}]+}/);
assert(statusBadgeRule, 'section status badge style exists');
assert(/background:\s*transparent;/.test(statusBadgeRule[0]), 'status summary badges use transparent background');
assert(/border:\s*1px\s+solid\s+rgba\(107,\s*114,\s*128,/.test(statusBadgeRule[0]), 'status summary badges use a gray border');
assert(/min-height:\s*18px;/.test(statusBadgeRule[0]), 'status summary badges stay low-height');

console.log('issue-2228 procvac section summary: ok');
