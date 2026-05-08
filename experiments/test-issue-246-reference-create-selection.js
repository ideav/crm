/**
 * Regression coverage for issue #246 / #238.
 *
 * The original failure happened because the reference editor's outside-click
 * handler treated clicks inside the nested "create reference record" modal as
 * clicks outside the edited cell. That canceled inline editing before
 * saveRecordForReference could apply the newly created record.
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadTable(fetchImpl) {
    const code = fs.readFileSync('js/integram-table.js', 'utf8');
    const context = {
        console,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        fetch: fetchImpl || (async () => {
            throw new Error('Unexpected fetch call');
        }),
        window: {
            location: { search: '' },
            INTEGRAM_DEBUG: false
        },
        document: {
            readyState: 'loading',
            getElementById: () => ({}),
            addEventListener: () => {},
            querySelectorAll: () => []
        },
        FormData: class FakeFormData {
            constructor(form) {
                this.form = form;
            }

            get(name) {
                const entry = this.form._entries.find(([key]) => key === name);
                return entry ? entry[1] : null;
            }

            entries() {
                return this.form._entries[Symbol.iterator]();
            }
        }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(`${code}\nthis.IntegramTable = IntegramTable;`, context);
    return Object.create(context.IntegramTable.prototype);
}

function makeTarget({ inReferenceCreateModal = false, inOverlay = false } = {}) {
    return {
        closest(selector) {
            if (selector === '[data-is-reference-create="true"]') {
                return inReferenceCreateModal ? {} : null;
            }
            if (selector === '.edit-form-overlay') {
                return inOverlay ? {} : null;
            }
            return null;
        }
    };
}

function testOutsideClickDecision() {
    const table = loadTable();

    assert.strictEqual(
        typeof table._shouldCancelReferenceEditorForClick,
        'function',
        'reference editor outside-click helper should exist'
    );

    const cell = { contains: () => false };
    const modalTarget = makeTarget({ inReferenceCreateModal: true });
    const overlayTarget = makeTarget({ inOverlay: true });

    assert.strictEqual(
        !cell.contains(modalTarget),
        true,
        'original outside-cell check would cancel a click inside the create modal'
    );
    assert.strictEqual(
        table._shouldCancelReferenceEditorForClick(modalTarget, cell),
        false,
        'clicks inside the reference create modal keep the inline reference editor active'
    );
    assert.strictEqual(
        table._shouldCancelReferenceEditorForClick(overlayTarget, cell),
        false,
        'clicks on the reference create overlay keep the inline reference editor active'
    );

    const insideCellTarget = makeTarget();
    const containingCell = { contains: target => target === insideCellTarget };
    assert.strictEqual(
        table._shouldCancelReferenceEditorForClick(insideCellTarget, containingCell),
        false,
        'clicks inside the edited cell do not cancel the editor'
    );

    const fixedDropdownTarget = makeTarget();
    table.currentEditingCell = {
        fixedDropdown: {
            contains: target => target === fixedDropdownTarget
        }
    };
    assert.strictEqual(
        table._shouldCancelReferenceEditorForClick(fixedDropdownTarget, cell),
        false,
        'clicks inside the detached reference dropdown do not cancel the editor'
    );

    const outsideTarget = makeTarget();
    table.currentEditingCell = null;
    assert.strictEqual(
        table._shouldCancelReferenceEditorForClick(outsideTarget, cell),
        true,
        'ordinary outside clicks still cancel the editor'
    );
}

async function testSaveRecordAppliesCreatedReference() {
    let request;
    const table = loadTable(async (url, options) => {
        request = { url, options };
        return {
            ok: true,
            text: async () => JSON.stringify({
                id: 6546,
                obj: 6546,
                ord: 1,
                next_act: 'edit_obj',
                args: 'new1=1&',
                val: 'Server value'
            })
        };
    });

    const toasts = [];
    let cacheCleared = false;
    let savedReference = null;

    table.getApiBase = () => '/api';
    table.getServerError = () => '';
    table.decodeHtmlEntities = value => value;
    table.showToast = (message, type) => toasts.push({ message, type });
    table.clearAllReferenceOptionCaches = () => {
        cacheCleared = true;
    };
    table.saveReferenceEdit = async (id, value) => {
        savedReference = {
            id,
            value,
            hadEditingCell: Boolean(table.currentEditingCell)
        };
        table.currentEditingCell = null;
    };
    table.currentEditingCell = {
        cell: { innerHTML: '<div class="inline-editor-reference"></div>' },
        isMultiReference: false
    };

    const form = {
        _entries: [
            ['main', 'Typed value'],
            ['t123', '']
        ],
        checkValidity: () => true,
        reportValidity: () => {
            throw new Error('reportValidity should not run for a valid form');
        }
    };
    let modalRemoved = false;
    let overlayRemoved = false;
    const modal = {
        querySelector: selector => selector === '#edit-form-ref-create' ? form : null,
        remove: () => {
            modalRemoved = true;
        },
        _overlayElement: {
            remove: () => {
                overlayRemoved = true;
            }
        }
    };

    await table.saveRecordForReference(modal, '777', '42');

    assert.strictEqual(request.url, '/api/_m_new/777?JSON&up=1');
    assert.strictEqual(request.options.method, 'POST');
    assert.strictEqual(new URLSearchParams(request.options.body).get('t777'), 'Typed value');
    assert.strictEqual(modalRemoved, true, 'create modal is removed after successful save');
    assert.strictEqual(overlayRemoved, true, 'create modal overlay is removed after successful save');
    assert.strictEqual(cacheCleared, true, 'reference option caches are cleared');
    assert.deepStrictEqual(savedReference, {
        id: 6546,
        value: 'Server value',
        hadEditingCell: true
    });
    assert.strictEqual(
        toasts.some(toast => toast.type === 'success'),
        true,
        'success toast is shown'
    );
}

(async () => {
    testOutsideClickDecision();
    await testSaveRecordAppliesCreatedReference();
    console.log('PASS issue #246 reference create selection regression');
})();
