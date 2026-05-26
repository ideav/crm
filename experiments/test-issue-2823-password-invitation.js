/**
 * Regression coverage for issue #2823.
 *
 * Password invitations must be copyable before the new user record is saved,
 * using the current username field value. The generated password must then be
 * saved after _m_new returns an ID, because password hashing is salted by user
 * ID on the server.
 *
 * Run with: node experiments/test-issue-2823-password-invitation.js
 */

const assert = require('assert');
const IntegramTable = require('../js/integram-table.js');

function createTable() {
    const table = Object.create(IntegramTable.prototype);
    table.getApiBase = () => '/db';
    table.getServerError = () => null;
    table.showToast = () => {};
    table.showWarningModal = () => {};
    table.showWarningsModal = () => {};
    table.clearAllReferenceOptionCaches = () => {};
    table.loadData = async () => {};
    table.currentEditModal = null;
    table.cellSubordinateContext = null;
    table.data = [];
    table.loadedRecords = 0;
    table.hasMore = false;
    table.totalRows = null;
    return table;
}

function passwordInput(name, value, disabled = false) {
    return {
        name,
        type: 'password',
        value,
        disabled,
        getAttribute(attr) {
            return attr === 'name' ? name : null;
        }
    };
}

function modalForUsername(mainInput) {
    return {
        dataset: {},
        querySelector(selector) {
            return selector === '#field-main' ? mainInput : null;
        },
        querySelectorAll() {
            return [];
        }
    };
}

async function testInvitationUsernameUsesUnsavedMainField() {
    const table = createTable();

    const createModal = modalForUsername({ type: 'text', value: '  ivan  ' });
    assert.strictEqual(
        table.getPasswordInvitationUsername(createModal),
        'ivan',
        'create invitation should use the unsaved main field value'
    );

    createModal.dataset.firstColumnValue = 'saved-user';
    assert.strictEqual(
        table.getPasswordInvitationUsername(createModal),
        'saved-user',
        'edit invitation should keep using the saved first-column value'
    );

    const emptyModal = modalForUsername({ type: 'text', value: '   ' });
    assert.strictEqual(
        table.getPasswordInvitationUsername(emptyModal),
        '',
        'blank usernames should still be rejected'
    );
}

function testPasswordFieldCollectionAndRecordIds() {
    const table = createTable();
    const pwd = passwordInput('t20', 'secret');
    const mainPwd = passwordInput('main', 'main-secret');
    const disabledPwd = passwordInput('t21', 'skip-me', true);
    const emptyPwd = passwordInput('t22', '');

    const modal = {
        querySelectorAll(selector) {
            if (selector === 'input[type="password"][name]') {
                return [pwd, mainPwd, disabledPwd, emptyPwd];
            }
            return [];
        }
    };

    assert.deepStrictEqual(
        table.collectCreatePasswordFields(modal, 41),
        [
            { formKey: 't20', saveKey: 't20', value: 'secret' },
            { formKey: 'main', saveKey: 't41', value: 'main-secret' }
        ],
        'create password fields should be collected with save keys'
    );

    assert.strictEqual(table.isDeferredPasswordField('t20', [{ formKey: 't20' }]), true);
    assert.strictEqual(table.isDeferredPasswordField('t30', [{ formKey: 't20' }]), false);
    assert.strictEqual(table.isDeferredPasswordField('t20'), false);

    assert.strictEqual(table.getSavedRecordId({ obj: '777' }), '777');
    assert.strictEqual(table.getSavedRecordId({ id: '778' }), '778');
    assert.strictEqual(table.getSavedRecordId({ i: '779' }), '779');
    assert.strictEqual(table.getSavedRecordId({ obj: { id: '780' } }), '780');
    assert.strictEqual(table.getSavedRecordId({}), null);
}

async function testCreateSaveDefersPasswordField() {
    const table = createTable();
    const calls = [];
    const dispatchedEvents = [];

    const originalFetch = global.fetch;
    const originalFormData = global.FormData;
    const originalDocument = global.document;
    const originalWindow = global.window;
    const originalCustomEvent = global.CustomEvent;

    class FakeFormData {
        constructor(form) {
            this.values = new Map(form._entries);
        }

        get(key) {
            return this.values.has(key) ? this.values.get(key) : null;
        }

        entries() {
            return this.values.entries();
        }
    }

    const form = {
        _entries: [
            ['main', 'ivan'],
            ['t20', 'secret'],
            ['t30', 'note']
        ],
        checkValidity() {
            return true;
        },
        reportValidity() {}
    };

    const modal = {
        _overlayElement: { remove() {} },
        querySelector(selector) {
            if (selector === '#edit-form') return form;
            if (selector === '.form-file-upload[data-req-id="20"]') return null;
            if (selector === '.form-file-upload[data-req-id="30"]') return null;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.form-file-upload') return [];
            if (selector === 'input[type="password"][name]') return [passwordInput('t20', 'secret')];
            return [];
        },
        remove() {
            this.removed = true;
        }
    };

    try {
        global.FormData = FakeFormData;
        global.window = { _integramModalDepth: 1 };
        global.document = {
            dispatchEvent(event) {
                dispatchedEvents.push(event);
            }
        };
        global.CustomEvent = class CustomEvent {
            constructor(type, init) {
                this.type = type;
                this.detail = init.detail;
            }
        };
        global.fetch = async (url, options) => {
            calls.push({ url: String(url), options });
            if (calls.length === 1) {
                return {
                    ok: true,
                    statusText: 'OK',
                    text: async () => JSON.stringify({ obj: '777' })
                };
            }
            return {
                ok: true,
                statusText: 'OK',
                text: async () => JSON.stringify({ success: true })
            };
        };

        await table.saveRecord(modal, true, null, 41, 1);
    } finally {
        global.fetch = originalFetch;
        global.FormData = originalFormData;
        global.document = originalDocument;
        global.window = originalWindow;
        global.CustomEvent = originalCustomEvent;
    }

    assert.strictEqual(calls.length, 2, 'create with password should make two save requests');
    assert.strictEqual(calls[0].url, '/db/_m_new/41?JSON&up=1');
    assert.strictEqual(calls[0].options.body, 't30=note&t41=ivan');
    assert.strictEqual(
        calls[0].options.body.includes('t20=secret'),
        false,
        'initial create request must not include password'
    );

    assert.strictEqual(calls[1].url, '/db/_m_save/777?JSON');
    assert.strictEqual(calls[1].options.body, 't20=secret');
    assert.strictEqual(modal.removed, true, 'modal should close after both saves succeed');
    assert.strictEqual(dispatchedEvents[0].detail.recordId, '777');
}

(async function run() {
    await testInvitationUsernameUsesUnsavedMainField();
    testPasswordFieldCollectionAndRecordIds();
    await testCreateSaveDefersPasswordField();
    console.log('Issue #2823 password invitation regression tests passed');
})();
