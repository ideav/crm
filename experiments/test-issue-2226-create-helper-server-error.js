/**
 * Issue #2226 regression coverage for standalone create form saving.
 *
 * The standalone ProcVac create form uses IntegramCreateFormHelper directly.
 * Saving a successful response must not fail with
 * "this.getServerError is not a function".
 *
 * Run with: node experiments/test-issue-2226-create-helper-server-error.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');

class FakeFormData {
    constructor() {
        this.fields = [
            ['main', '28.04.2026'],
            ['t5617', 'Комментарий'],
        ];
    }

    get(name) {
        const field = this.fields.find(([key]) => key === name);
        return field ? field[1] : null;
    }

    entries() {
        return this.fields[Symbol.iterator]();
    }
}

function createModal(log) {
    const form = {
        checkValidity() {
            return true;
        },
        reportValidity() {
            throw new Error('reportValidity should not be called for a valid form');
        },
    };

    return {
        _overlayElement: {
            remove() {
                log.overlayRemoved = true;
            },
        },
        querySelector(selector) {
            if (selector === '#edit-form') return form;
            return null;
        },
        querySelectorAll() {
            return [];
        },
        remove() {
            log.modalRemoved = true;
        },
    };
}

(async function run() {
    const sourcePath = path.join(rootDir, 'js', 'integram-table.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const toasts = [];
    const fetches = [];
    const log = {
        modalRemoved: false,
        overlayRemoved: false,
        reloads: 0,
    };

    const sandbox = {
        console,
        window: {
            location: {
                origin: 'https://example.test',
                pathname: '/sportzania/procvac',
                search: '',
            },
            _integramTableInstances: [
                {
                    reload() {
                        log.reloads += 1;
                    },
                },
            ],
            _integramModalDepth: 1,
            showToast(message, type) {
                toasts.push({ message, type });
            },
        },
        document: {
            readyState: 'loading',
            addEventListener() {},
            querySelectorAll() {
                return [];
            },
            createElement() {
                return {
                    style: {},
                    classList: { add() {}, remove() {} },
                    appendChild() {},
                    remove() {},
                };
            },
            body: {
                appendChild() {},
            },
        },
        fetch(url, options) {
            fetches.push({ url: String(url), options });
            return Promise.resolve({
                ok: true,
                statusText: 'OK',
                text() {
                    return Promise.resolve(JSON.stringify({ obj: '9100', val: '28.04.2026' }));
                },
            });
        },
        FormData: FakeFormData,
        URLSearchParams,
        setTimeout,
        clearTimeout,
    };
    sandbox.window.window = sandbox.window;

    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: sourcePath });

    const helper = new sandbox.window.IntegramCreateFormHelper('https://example.test/sportzania', '5616', '8162');
    await helper.saveRecord(createModal(log), { id: '5616', val: 'Дата события' });

    assert.strictEqual(fetches.length, 1, 'saveRecord sends one create request');
    assert.ok(fetches[0].url.endsWith('/_m_new/5616?JSON&up=8162'), 'create request targets the event table and parent');
    assert.strictEqual(fetches[0].options.body, 't5617=%D0%9A%D0%BE%D0%BC%D0%BC%D0%B5%D0%BD%D1%82%D0%B0%D1%80%D0%B8%D0%B9&t5616=28.04.2026');
    assert.deepStrictEqual(toasts, [{ message: 'Запись создана', type: 'success' }]);
    assert.strictEqual(log.modalRemoved, true, 'successful save closes the modal');
    assert.strictEqual(log.overlayRemoved, true, 'successful save closes the overlay');
    assert.strictEqual(log.reloads, 1, 'successful save reloads Integram tables');
    assert.strictEqual(sandbox.window._integramModalDepth, 0, 'successful save decrements modal depth');

    console.log('issue-2226 standalone create helper save: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
