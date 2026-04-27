/**
 * Issue #2210 regression coverage for the compact procvac workplace.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const sourcePath = path.join(rootDir, 'js', 'procvac.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
    console,
    window: {},
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

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

const template = fs.readFileSync(path.join(rootDir, 'templates', 'procvac.html'), 'utf8');
assert(!template.includes('procvac-refresh'), 'refresh button is removed from procvac template');
assert(!template.includes('procvac-status'), 'status element is removed from procvac template');

const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
const cellRule = css.match(/\.procvac-cell\s*{[^}]+}/);
assert(cellRule, 'procvac cell rule exists');
assert(/padding:\s*2px 4px;/.test(cellRule[0]), 'procvac cells use compact 2px 4px padding');
assert(!/\bheight:\s*34px;/.test(cellRule[0]), 'procvac cells do not force a fixed height');
assert(!/\bmin-height:\s*34px;/.test(cellRule[0]), 'procvac cells do not force a fixed minimum height');
assert(/\.procvac-grid\s*{[^}]*overflow:\s*auto;/.test(css), 'procvac grid remains the single scroll container');

const columns = [
    { key: 'title', label: 'Вакансия актуальная' },
    { key: 'plan', label: 'План' },
    { key: 'comments', label: 'Комментарии' },
];
const sized = helpers.applyColumnWidths(columns, {
    title: 260,
    plan: 12,
    comments: 'not-a-number',
});

assertEqual(sized[0].width, 260, 'saved width is applied to matching column');
assertEqual(sized[1].width, helpers.MIN_COLUMN_WIDTH, 'saved width is clamped to the minimum width');
assertEqual(sized[2].width, helpers.DEFAULT_COLUMN_WIDTHS.comments, 'invalid saved width falls back to the default width');

const normalized = helpers.normalizeColumnWidths({ title: '280.5', status: 0, unknown: 400 });
assertEqual(normalized.title, 281, 'column width cookies are normalized to rounded pixel values');
assertEqual(normalized.status, helpers.MIN_COLUMN_WIDTH, 'small persisted widths are clamped');
assert(!Object.prototype.hasOwnProperty.call(normalized, 'unknown'), 'unknown persisted widths are ignored');

const colHtml = helpers.renderColumn({ key: 'title', width: 260 });
assert(colHtml.includes('data-col-key="title"'), 'col markup carries the column key for live resizing');
assert(colHtml.includes('style="width: 260px;"'), 'col markup carries the applied width');

const headerHtml = helpers.renderHeaderCell({ key: 'title', label: 'Вакансия актуальная', width: 260 });
assert(headerHtml.includes('procvac-col-resize-handle'), 'header includes a column resize handle');
assert(headerHtml.includes('data-col-key="title"'), 'resize handle carries the column key');
assert(headerHtml.includes('style="width: 260px;"'), 'header carries the applied width');

assertEqual(helpers.getReferenceSelectSize(1), 2, 'reference editor opens as an expanded list even with one option');
assertEqual(helpers.getReferenceSelectSize(20), 10, 'reference editor expansion is capped for long lists');

console.log('issue-2210 procvac compact behavior: ok');
