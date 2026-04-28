/**
 * Issue #2222 regression coverage for ProcVac create actions, event counts,
 * template relocation, and reload-on-tab-return behavior.
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

function createElement(id) {
    return {
        id,
        listeners: {},
        dataset: {},
        style: {},
        innerHTML: '',
        value: '',
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        },
        closest() {
            return null;
        },
    };
}

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

(async function run() {
    const movedTemplatePath = path.join(rootDir, 'templates', 'sportzania', 'procvac.html');
    const oldTemplatePath = path.join(rootDir, 'templates', 'procvac.html');

    assert(fs.existsSync(movedTemplatePath), 'procvac template is moved to templates/sportzania/procvac.html');
    assert(!fs.existsSync(oldTemplatePath), 'old templates/procvac.html path is removed');

    const template = fs.readFileSync(movedTemplatePath, 'utf8');
    assert(template.includes('/js/integram-table.js'), 'procvac template loads the table component form helper');
    assert(template.indexOf('/js/integram-table.js') < template.indexOf('/js/procvac.js'), 'table component loads before procvac.js');
    assert(template.includes('id="procvac-add-vacancy"'), 'procvac template has an add-vacancy button');
    assert(template.indexOf('id="procvac-add-vacancy"') < template.indexOf('id="procvac-search"'), 'add-vacancy button is left of the search input');
    assert(template.includes('title="Добавить вакансию"'), 'add-vacancy button has the requested title');

    const root = createElement('procvac-app');
    const grid = createElement('procvac-grid');
    const search = createElement('procvac-search');
    const addVacancyButton = createElement('procvac-add-vacancy');
    const documentListeners = {};
    const createCalls = [];
    let fetchCalls = 0;

    const metadata = {
        id: '8137',
        type: '3',
        val: 'Вакансия актуальная',
        granted: 'WRITE',
        reqs: [
            { id: '8140', val: 'Статус вакансии', type: '3', ref_id: '8139' },
            { id: '8214', val: 'События', type: '3', arr_id: '5616' },
            { id: '8156', val: 'Комментарии', type: '3' },
        ],
    };
    const dataRows = [
        { i: 8162, r: ['Менеджер', '8158:В работе', 3, 'Комментарий'] },
    ];

    const sandbox = {
        console,
        window: {
            db: 'demo',
            location: { pathname: '/demo/procvac', search: '' },
            _integramTableInstances: [],
            openCreateRecordForm(tableTypeId, parentId, fieldValues) {
                createCalls.push([String(tableTypeId), String(parentId), fieldValues || {}]);
            },
            addEventListener() {},
            removeEventListener() {},
        },
        document: {
            hidden: false,
            cookie: '',
            body: { appendChild() {}, removeChild() {} },
            documentElement: { clientWidth: 1024, clientHeight: 768 },
            addEventListener(type, handler) {
                documentListeners[type] = handler;
            },
            removeEventListener() {},
            getElementById(id) {
                return {
                    'procvac-app': root,
                    'procvac-grid': grid,
                    'procvac-search': search,
                    'procvac-add-vacancy': addVacancyButton,
                }[id] || null;
            },
        },
        fetch(url) {
            fetchCalls += 1;
            const payload = String(url).includes('/metadata/') ? metadata : dataRows;
            return Promise.resolve({
                ok: true,
                text() {
                    return Promise.resolve(JSON.stringify(payload));
                },
            });
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

    const columns = helpers.buildColumns(metadata);
    const eventsColumn = columns.find((col) => col.key === 'events');
    assert(eventsColumn, 'events column is present');
    assertEqual(eventsColumn.source.id, '8214', 'events column maps to the subordinate event count source');
    assertEqual(eventsColumn.editable, false, 'events column remains read-only');

    const row = helpers.normalizeRow(dataRows[0], columns, new Date('2026-04-28T10:00:00Z'));
    assertEqual(row.values.events, '3', 'events count is taken from the subordinate count value');

    const eventsHtml = helpers.renderCell(row, eventsColumn, 'active');
    assert(eventsHtml.includes('class="procvac-events-count"'), 'events cell renders the count link');
    assert(eventsHtml.includes('>3</a>'), 'events cell shows the event count');
    assert(eventsHtml.includes('class="procvac-event-create-btn"'), 'events cell renders the create-event button');
    assert(eventsHtml.includes('title="Создать событие"'), 'create-event button has the requested title');
    assert(eventsHtml.includes('data-row-id="8162"'), 'create-event button carries the current vacancy id');

    helpers.openCreateVacancy();
    helpers.openCreateEvent('8162');
    assertDeepEqual(
        createCalls,
        [
            ['8137', '1', {}],
            ['5616', '8162', {}],
        ],
        'create helpers call openCreateRecordForm with vacancy and event table ids',
    );

    documentListeners.DOMContentLoaded();
    await flushPromises();
    assertEqual(fetchCalls, 2, 'initial ProcVac load fetches metadata and rows');
    assertEqual(sandbox.window._integramTableInstances.length, 1, 'ProcVac registers for reloadAllIntegramTables');

    addVacancyButton.listeners.click();
    assertDeepEqual(createCalls[2], ['8137', '1', {}], 'toolbar add button opens the vacancy create form');

    grid.listeners.click({
        target: {
            dataset: { rowId: '8162' },
            closest(selector) {
                return selector === '.procvac-event-create-btn' ? this : null;
            },
        },
        preventDefault() {},
        stopPropagation() {},
    });
    assertDeepEqual(createCalls[3], ['5616', '8162', {}], 'event plus button opens the subordinate event create form');

    sandbox.document.hidden = true;
    documentListeners.visibilitychange();
    sandbox.document.hidden = false;
    documentListeners.visibilitychange();
    await flushPromises();
    assertEqual(fetchCalls, 4, 'returning to the browser tab reloads ProcVac data');

    console.log('issue-2222 procvac actions: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
