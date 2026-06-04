const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
    if (!condition) {
        throw new Error('FAIL: ' + message);
    }
    console.log('PASS:', message);
}

class FakeElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.className = '';
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.options = [];
        this.listeners = {};
        this.required = false;
        this.classList = {
            add() {},
            remove() {}
        };
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this.children = [];
        this.options = [];
    }

    get innerHTML() {
        return this._innerHTML || '';
    }

    appendChild(child) {
        this.children.push(child);
        if (child.tagName === 'OPTION') {
            this.options.push(child);
            if (this.value === '') {
                this.value = child.value;
            }
        }
        return child;
    }

    addEventListener(type, listener) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
    }

    async dispatch(type, event = {}) {
        const listeners = this.listeners[type] || [];
        for (const listener of listeners) {
            await listener(event);
        }
    }

    focus() {}

    setAttribute(name, value) {
        this[name] = value === '' ? true : value;
    }

    removeAttribute(name) {
        delete this[name];
    }

    querySelector() {
        return null;
    }

    querySelectorAll() {
        return [];
    }
}

function createFakeDocument() {
    const elements = new Map();
    const requiredIds = [
        'login-form',
        'login-email',
        'login-password',
        'auth-db-select',
        'auth-db-custom',
        'auth-db-custom-group',
        'auth-db-back',
        'login-captcha-container',
        'auth-panel',
        'welcome-section',
        'login-section',
        'register-section',
        'tab-login',
        'tab-register',
        'auth-message',
        'login-btn',
        'db-btn-wrapper',
        'db-btn',
        'db-dropdown-toggle',
        'db-dropdown'
    ];

    for (const id of requiredIds) {
        elements.set(id, new FakeElement(id));
    }

    return {
        cookie: '',
        documentElement: new FakeElement('documentElement'),
        body: new FakeElement('body'),
        createElement(tagName) {
            const el = new FakeElement('');
            el.tagName = tagName.toUpperCase();
            return el;
        },
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelectorAll() {
            return [];
        },
        addEventListener() {},
        _elements: elements
    };
}

async function runLoginScenario({ selectedDbValue, customDbValue, expectedHref, message }) {
    const document = createFakeDocument();
    const origin = 'https://ideav.ru';
    const location = {
        origin,
        hostname: 'ideav.ru',
        search: '?db=atex&r=InvalidToken&uri=/atex/table/1',
        href: origin + '/start.html?db=atex&r=InvalidToken&uri=/atex/table/1'
    };
    const context = {
        console,
        URLSearchParams,
        Date,
        setTimeout,
        document,
        window: {
            location,
            smartCaptcha: null
        },
        localStorage: {
            getItem() { return null; },
            setItem() {}
        }
    };
    context.globalThis = context;

    const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
    vm.runInNewContext(appSource + '\nglobalThis.__App = App;', context);

    const app = new context.__App();
    await app.init();
    app._captchaBypass = true;
    app._captchaBypassChecked = true;
    app.auth.login = async () => ({ success: true, message: 'ok' });

    document.getElementById('auth-db-select').value = selectedDbValue;
    document.getElementById('auth-db-custom').value = customDbValue || '';
    document.getElementById('login-email').value = 'user';
    document.getElementById('login-password').value = 'password';

    await document.getElementById('login-form').dispatch('submit', {
        preventDefault() {}
    });

    assert(location.href === expectedHref, message);
}

async function main() {
    await runLoginScenario({
        selectedDbValue: '__other__',
        customDbValue: 'ateh',
        expectedHref: 'https://ideav.ru/ateh',
        message: 'changing DB during InvalidToken login discards the stale post-login URI'
    });

    await runLoginScenario({
        selectedDbValue: 'atex',
        expectedHref: 'https://ideav.ru/atex/table/1',
        message: 'logging into the original DB keeps the saved post-login URI'
    });
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
