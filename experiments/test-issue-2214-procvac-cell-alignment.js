/**
 * Issue #2214 regression coverage for ProcVac numeric/date cell alignment.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const sourcePath = path.join(rootDir, 'js', 'procvac.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function createElement(id) {
    return {
        id,
        innerHTML: '',
        style: {},
        addEventListener() {},
        closest(selector) {
            return selector === '.app-content' ? { style: {} } : null;
        },
    };
}

const root = createElement('procvac-app');
const grid = createElement('procvac-grid');
const search = createElement('procvac-search');

const metadata = {
    id: '8137',
    type: '3',
    val: 'Вакансия актуальная',
    granted: 'WRITE',
    reqs: [
        { id: '8140', val: 'Статус вакансии', type: '3', ref_id: '8139', orig: '8138' },
        { id: '8143', val: 'План', type: '13' },
        { id: '8145', val: 'Факт', type: '13' },
        { id: '8150', val: 'Старт работы', type: '9' },
        { id: '8152', val: 'Дедлайн', type: '9' },
        { id: '8156', val: 'Комментарии', type: '3' },
    ],
};

const rows = [
    {
        i: 8162,
        r: ['Менеджер', '8158:В работе', '4', '2', '13.04.2026', '31.05.2026', ''],
    },
];

const sandbox = {
    console,
    window: {},
    document: {
        addEventListener() {},
        cookie: '',
        getElementById(id) {
            return { 'procvac-app': root, 'procvac-grid': grid, 'procvac-search': search }[id] || null;
        },
        querySelector() {
            return null;
        },
    },
    fetch(url) {
        const payload = url.includes('/metadata/') ? metadata : rows;
        return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify(payload)),
        });
    },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    Date,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: sourcePath });

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertCellHasClass(html, columnKey, className) {
    const pattern = new RegExp(`<td class="[^"]*procvac-cell--${ columnKey }[^"]*${ className }[^"]*"`);
    assert(pattern.test(html), `${ columnKey } cell includes ${ className }`);
}

Promise.resolve()
    .then(() => {
        sandbox.window.ProcVac.init();
        return new Promise((resolve) => setTimeout(resolve, 0));
    })
    .then(() => {
        assertCellHasClass(grid.innerHTML, 'plan', 'procvac-cell--numeric');
        assertCellHasClass(grid.innerHTML, 'fact', 'procvac-cell--numeric');
        assertCellHasClass(grid.innerHTML, 'weeksInWork', 'procvac-cell--numeric');
        assertCellHasClass(grid.innerHTML, 'startDate', 'procvac-cell--date');
        assertCellHasClass(grid.innerHTML, 'deadline', 'procvac-cell--date');

        const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
        assert(/\.procvac-cell--numeric\s*{[^}]*text-align:\s*right;/.test(css), 'numeric cells are right-aligned in CSS');
        assert(/\.procvac-cell--date\s*{[^}]*text-align:\s*center;/.test(css), 'date cells are center-aligned in CSS');

        console.log('issue-2214 procvac cell alignment: ok');
    });
