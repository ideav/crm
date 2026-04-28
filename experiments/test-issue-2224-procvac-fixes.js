/**
 * Issue #2224 regression coverage for ProcVac standalone form styling,
 * event metadata caching, and the trailing horizontal overflow.
 *
 * Run with: node experiments/test-issue-2224-procvac-fixes.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function jsonResponse(payload) {
    return Promise.resolve({
        ok: true,
        statusText: 'OK',
        json() {
            return Promise.resolve(payload);
        },
        text() {
            return Promise.resolve(JSON.stringify(payload));
        },
    });
}

(async function run() {
    const templatePath = path.join(rootDir, 'templates', 'sportzania', 'procvac.html');
    const template = fs.readFileSync(templatePath, 'utf8');
    assert(template.includes('/css/integram-table.css'), 'procvac template loads IntegramTable modal styles');
    assert(
        template.indexOf('/css/integram-table.css') < template.indexOf('/js/integram-table.js'),
        'IntegramTable CSS loads before the form helper script',
    );

    const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');
    assert(
        /\.procvac-head-cell:last-child\s+\.procvac-col-resize-handle\s*{[^}]*right:\s*0;/.test(css),
        'last ProcVac resize handle stays inside the grid scroll area',
    );

    const sourcePath = path.join(rootDir, 'js', 'integram-table.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const fetchLog = [];
    const createRenders = [];
    const editRenders = [];
    const metadata = {
        id: '5616',
        type: '3',
        val: 'Событие',
        reqs: [
            { id: '5617', val: 'Комментарий', type: '3' },
        ],
    };

    const sandbox = {
        console,
        window: {
            location: {
                origin: 'https://example.test',
                pathname: '/demo/procvac',
                search: '',
            },
            _integramTableInstances: [],
        },
        document: {
            readyState: 'loading',
            addEventListener() {},
            querySelectorAll() {
                return [];
            },
        },
        fetch(url) {
            fetchLog.push(String(url));
            if (String(url).includes('/metadata/5616')) {
                return jsonResponse(metadata);
            }
            if (String(url).includes('/edit_obj/')) {
                return jsonResponse({ obj: { id: '8162', val: 'Вакансия', typ_name: 'Вакансия' } });
            }
            if (String(url).includes('/object/5616/')) {
                return jsonResponse([{ i: '9100', u: '8162', r: ['Созвон', 'Комментарий'] }]);
            }
            return jsonResponse({});
        },
        URLSearchParams,
        setTimeout,
        clearTimeout,
    };
    sandbox.window.window = sandbox.window;

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: sourcePath });

    const helperPrototype = sandbox.window.IntegramCreateFormHelper.prototype;
    helperPrototype.renderCreateFormModal = function(renderedMetadata, recordData) {
        createRenders.push({
            id: String(renderedMetadata.id),
            parent: String(recordData.obj.parent),
        });
    };
    helperPrototype.renderEditFormModalStandalone = function(renderedMetadata, recordData, typeId, recordId) {
        editRenders.push({
            id: String(renderedMetadata.id),
            typeId: String(typeId),
            recordId: String(recordId),
            parent: String(recordData.obj.parent),
        });
    };

    await Promise.all([
        sandbox.window.openCreateRecordForm('5616', '8162'),
        sandbox.window.openCreateRecordForm('5616', '8163'),
    ]);
    await sandbox.window.openCreateRecordForm('5616', '8164');
    await sandbox.window.openEditRecordForm('9100', '5616');

    const metadataCalls = fetchLog.filter((url) => url.includes('/metadata/5616'));
    assertEqual(metadataCalls.length, 1, 'standalone create/edit forms fetch metadata/5616 only once');
    assertEqual(createRenders.length, 3, 'all three create forms rendered');
    assertEqual(editRenders.length, 1, 'edit form rendered after using the shared metadata cache');
    assertEqual(editRenders[0].recordId, '9100', 'edit form receives the requested record id');

    console.log('issue-2224 procvac fixes: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
