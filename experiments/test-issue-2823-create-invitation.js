const assert = require('assert');

let clipboardText = '';

global.window = {
    location: {
        search: '',
        pathname: '/demo/object/18'
    }
};
global.location = { host: 'crm.test' };
global.document = {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => ({}),
    querySelectorAll: () => [],
    createElement: () => ({
        style: {},
        select: () => {},
        remove: () => {}
    }),
    execCommand: () => true,
    body: {
        appendChild: () => {},
        removeChild: () => {}
    }
};
global.navigator = {
    clipboard: {
        writeText: (text) => {
            clipboardText = text;
        }
    }
};

const IntegramTable = require('../js/integram-table.js');

class FakeElement {
    constructor({ value = '', dataset = {} } = {}) {
        this.value = value;
        this.dataset = dataset;
        this.style = {};
        this.listeners = {};
    }

    addEventListener(type, handler) {
        this.listeners[type] = handler;
    }
}

function createPasswordModal({ savedUsername = '', mainUsername = 'new.user' } = {}) {
    const mailButton = new FakeElement({ dataset: { fieldId: '20' } });
    const passwordInput = new FakeElement();
    const mainInput = new FakeElement({ value: mainUsername });
    const copiedSpan = new FakeElement();

    const modal = {
        dataset: savedUsername ? { firstColumnValue: savedUsername } : {},
        querySelectorAll(selector) {
            if (selector === '.pwd-reset-btn') return [];
            if (selector === '.pwd-reset-mail-btn') return [mailButton];
            return [];
        },
        querySelector(selector) {
            if (selector === '#field-20') return passwordInput;
            if (selector === '#field-main') return mainInput;
            if (selector === '#field-20-copied') return copiedSpan;
            return null;
        }
    };

    return { modal, mailButton, passwordInput };
}

function clickInvitation({ savedUsername = '', mainUsername = 'new.user' } = {}) {
    clipboardText = '';
    const notifications = [];
    const table = Object.create(IntegramTable.prototype);
    table.showCopyNotification = (message, isError, duration) => {
        notifications.push({ message, isError, duration });
    };

    const { modal, mailButton, passwordInput } = createPasswordModal({ savedUsername, mainUsername });
    table.attachPasswordResetHandlers(modal);
    mailButton.listeners.click();

    return { clipboardText, notifications, password: passwordInput.value };
}

const createResult = clickInvitation({ mainUsername: 'new.user' });
assert.strictEqual(
    createResult.notifications.some(n => n.message === 'Сохраните запись перед копированием приглашения'),
    false,
    'create form must not require saving before invitation copy when the main user field is filled'
);
assert.match(createResult.clipboardText, /^Ссылка для входа: https:\/\/crm\.test\/start\.html\?db=demo&u=new\.user\nПароль: /);
assert.ok(createResult.password.length >= 6, 'generated password should stay in the password field for saving');
assert.ok(createResult.clipboardText.endsWith(createResult.password), 'copied invitation should include the generated password');

const editResult = clickInvitation({ savedUsername: 'saved.user', mainUsername: 'draft.user' });
assert.match(editResult.clipboardText, /\?db=demo&u=saved\.user\n/);
assert(!editResult.clipboardText.includes('draft.user'), 'edit form should still prefer the saved first-column value');

const emptyResult = clickInvitation({ mainUsername: '' });
assert.strictEqual(emptyResult.clipboardText, '', 'empty user name should not produce an invitation with u=');
assert.strictEqual(
    emptyResult.notifications.some(n => n.message === 'Сохраните запись перед копированием приглашения'),
    false,
    'empty create form should not show the old save-before-copying message'
);

console.log('issue #2823 create invitation password flow checks passed');
