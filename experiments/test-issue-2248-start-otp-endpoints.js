const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class FakeElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.style = {};
        this.dataset = {};
        this.disabled = false;
        this.textContent = '';
        this.className = '';
        this.listeners = {};
        this.classList = {
            add: () => {},
            remove: () => {}
        };
    }

    addEventListener(type, handler) {
        this.listeners[type] = handler;
    }

    removeAttribute(name) {
        this[name] = false;
    }

    setAttribute(name, value) {
        this[name] = value === '' ? true : value;
    }

    focus() {
        this.focused = true;
    }
}

const elements = {
    'auth-db-select': new FakeElement('auth-db-select'),
    'auth-db-custom': new FakeElement('auth-db-custom'),
    'login-email': new FakeElement('login-email'),
    'login-password': new FakeElement('login-password'),
    'login-password-group': new FakeElement('login-password-group'),
    'login-captcha-container': new FakeElement('login-captcha-container'),
    'login-submit-btn': new FakeElement('login-submit-btn'),
    'otp-btn': new FakeElement('otp-btn'),
    'otp-message': new FakeElement('otp-message'),
    'otp-code-group': new FakeElement('otp-code-group'),
    'otp-code-input': new FakeElement('otp-code-input'),
    'otp-submit-btn': new FakeElement('otp-submit-btn')
};
elements['auth-db-select'].value = 'demo';
elements['login-email'].value = 'user@example.com';
elements['otp-code-input'].value = 'ABCD';

const fetchCalls = [];
const cookieWrites = [];
const documentStub = {
    documentElement: { setAttribute: () => {} },
    getElementById: id => elements[id] || null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};
Object.defineProperty(documentStub, 'cookie', {
    get() {
        return '';
    },
    set(value) {
        cookieWrites.push(value);
    }
});

const responses = [
    { ok: true, body: '{"msg":"ok"}' },
    { ok: true, body: '{"token":"tok123","_xsrf":"xsrf123"}' }
];

const context = {
    console,
    document: documentStub,
    window: {
        location: {
            hostname: 'app.test',
            origin: 'https://app.test',
            href: ''
        }
    },
    localStorage: {
        getItem: () => null,
        setItem: () => {}
    },
    URLSearchParams,
    FormData,
    setTimeout: () => {},
    fetch: async (url, options) => {
        fetchCalls.push({ url, options });
        const response = responses.shift();
        return {
            ok: response.ok,
            async text() {
                return response.body;
            }
        };
    }
};
context.window.document = documentStub;

vm.createContext(context);
const source = fs.readFileSync('js/app.js', 'utf8');
vm.runInContext(`${source}; this.App = App;`, context);

(async () => {
    const app = new context.App();
    await app.init();

    await elements['otp-btn'].listeners.click();
    assert.strictEqual(fetchCalls[0].url, 'demo/getcode?JSON');
    assert.strictEqual(fetchCalls[0].options.method, 'POST');
    assert.strictEqual(fetchCalls[0].options.credentials, 'include');
    assert.strictEqual(fetchCalls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const getCodeBody = new URLSearchParams(fetchCalls[0].options.body);
    assert.strictEqual(getCodeBody.get('u'), 'user@example.com');
    assert.strictEqual(getCodeBody.has('email'), false);
    assert.strictEqual(elements['otp-code-group'].style.display, '');
    assert.strictEqual(elements['login-password-group'].style.display, 'none');
    assert.strictEqual(elements['login-captcha-container'].style.display, 'none');
    assert.strictEqual(elements['login-submit-btn'].style.display, 'none');
    assert.strictEqual(elements['otp-btn'].style.display, 'none');
    assert.strictEqual(elements['login-password'].required, false);
    assert.strictEqual(elements['otp-message'].textContent, 'Код отправлен на почту');

    await elements['otp-code-input'].listeners.keydown({
        key: 'Enter',
        preventDefault() {
            this.defaultPrevented = true;
        }
    });
    assert.strictEqual(fetchCalls[1].url, 'demo/checkcode?JSON');
    assert.strictEqual(fetchCalls[1].options.method, 'POST');
    assert.strictEqual(fetchCalls[1].options.credentials, 'include');
    assert.strictEqual(fetchCalls[1].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const checkCodeBody = new URLSearchParams(fetchCalls[1].options.body);
    assert.strictEqual(checkCodeBody.get('u'), 'user@example.com');
    assert.strictEqual(checkCodeBody.get('c'), 'ABCD');
    assert.strictEqual(checkCodeBody.has('email'), false);
    assert.strictEqual(checkCodeBody.has('otp'), false);
    assert(cookieWrites.some(value => value.startsWith('idb_demo=tok123')), 'OTP login should persist returned token in idb_<db> cookie');
    assert.strictEqual(context.window.location.href, 'https://app.test/demo');

    console.log('issue-2248 start OTP endpoint test passed');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
