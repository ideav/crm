/**
 * Reproducer for issue #2988: menu settings icon disappears for users who
 * should be allowed to edit role menus.
 *
 * Run with: node experiments/test-issue-2988-menu-edit-rights.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadMainAppController() {
    const source = fs.readFileSync(path.join(__dirname, '../js/main-app.js'), 'utf8');
    const context = {
        console,
        setTimeout: () => {},
        window: {},
        document: {
            addEventListener: () => {},
            createElement: () => ({
                innerHTML: '',
                get value() {
                    return this.innerHTML
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&amp;/g, '&')
                        .replace(/&quot;/g, '"')
                        .replace(/&#039;/g, "'");
                }
            })
        }
    };

    vm.createContext(context);
    vm.runInContext(source + '\nglobalThis.__MainAppController = MainAppController;', context);
    return context;
}

async function runScenario(config) {
    const context = loadMainAppController();
    context.db = config.db || 'ateh';
    context.user = config.user || 'manager';
    context.grants = config.grants || {};
    context.window.grants = context.grants;

    let fetchCount = 0;
    context.fetch = async (url) => {
        fetchCount += 1;
        assert.strictEqual(url, '/' + context.db + '/metadata');
        return {
            ok: config.fetchOk !== false,
            json: async () => config.metadata
        };
    };

    const controller = new context.__MainAppController();
    const actual = await controller.checkMenuEditRights();

    assert.strictEqual(actual, config.expected, config.name);
    if (typeof config.expectedFetchCount === 'number') {
        assert.strictEqual(fetchCount, config.expectedFetchCount, config.name + ' fetch count');
    }
}

async function main() {
    const roleWithMenuWrite = {
        id: '42',
        val: '\u0420\u043e\u043b\u044c',
        reqs: [{ val: '\u041c\u0435\u043d\u044e', granted: 'WRITE' }]
    };
    const writableMenuTable = {
        id: '151',
        up: '0',
        type: '3',
        val: '\u041c\u0435\u043d\u044e',
        granted: 'WRITE',
        reqs: []
    };
    const readonlyMenuTable = {
        id: '151',
        up: '0',
        type: '3',
        val: '\u041c\u0435\u043d\u044e',
        granted: 'READ',
        reqs: []
    };

    await runScenario({
        name: 'database owner can edit without metadata fetch',
        db: 'owner',
        user: 'owner',
        metadata: [],
        expected: true,
        expectedFetchCount: 0
    });

    await runScenario({
        name: 'admin user can edit another database menu without metadata fetch',
        db: 'ateh',
        user: 'admin',
        metadata: [],
        expected: true,
        expectedFetchCount: 0
    });

    await runScenario({
        name: 'direct Menu table WRITE metadata grants menu editing',
        db: 'ateh',
        user: 'manager',
        metadata: [writableMenuTable],
        expected: true,
        expectedFetchCount: 1
    });

    await runScenario({
        name: 'legacy writable Role.Menu requisite still grants menu editing',
        db: 'ateh',
        user: 'manager',
        metadata: [roleWithMenuWrite],
        expected: true,
        expectedFetchCount: 1
    });

    await runScenario({
        name: 'global Menu table grant grants menu editing before metadata fetch',
        db: 'ateh',
        user: 'manager',
        grants: { 151: 'WRITE' },
        metadata: [],
        expected: true,
        expectedFetchCount: 0
    });

    await runScenario({
        name: 'read-only Menu table and Role.Menu requisite do not grant editing',
        db: 'ateh',
        user: 'manager',
        metadata: [
            readonlyMenuTable,
            { id: '42', val: '\u0420\u043e\u043b\u044c', reqs: [{ val: '\u041c\u0435\u043d\u044e', granted: 'READ' }] }
        ],
        expected: false,
        expectedFetchCount: 1
    });
}

main().then(() => {
    console.log('issue #2988 menu edit rights checks passed');
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
