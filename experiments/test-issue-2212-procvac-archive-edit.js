/**
 * Issue #2212 regression coverage for ProcVac archive editing and search input sizing.
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

const row = {
    id: '9000',
    values: { title: 'Архивная вакансия' },
    rawValues: { title: 'Архивная вакансия' },
};
const editableColumn = {
    key: 'title',
    editable: true,
    source: { kind: 'main', id: '8137', index: -1 },
};

assert(helpers.renderCell, 'renderCell is exposed for cell editability tests');

const activeCell = helpers.renderCell(row, editableColumn, 'active');
const archiveCell = helpers.renderCell(row, editableColumn, 'archive');

assert(activeCell.includes('procvac-cell--editable'), 'active cells with editable columns render as editable');
assert(archiveCell.includes('procvac-cell--editable'), 'archive cells with editable columns render as editable');
assert(!/dataset\.section\s*===\s*['"]archive['"]/.test(source), 'archive cells are not blocked from entering edit mode');

const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
const searchInputRule = css.match(/\.procvac-search input\s*{[^}]+}/);
assert(searchInputRule, 'procvac search input rule exists');
assert(/padding:\s*5px 10px 5px 32px;/.test(searchInputRule[0]), 'search input uses requested compact padding');
assert(!/\bmin-height\s*:/.test(searchInputRule[0]), 'search input does not force a min-height');

console.log('issue-2212 procvac archive edit behavior: ok');
