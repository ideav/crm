// Issue #564 (ideav/backlogram): «Требует капчу, а капчи самой нет».
//
// Скрипт SmartCaptcha грузится со стороннего домена; когда он недоступен
// (блокировщики, hosts, сбой Яндекса), виджет не отрисовывается и токена взять
// неоткуда. Гейт входа при captchaToken === null раньше блокировал любую попытку
// — получался тупик: форма капчи не показывает, но войти без неё нельзя.
//
// Фикс: вход блокируется только когда капча реально отрисована, но не решена.
// Если капчи нет вовсе — запрос уходит без токена; сервер (index.php, case "auth")
// проверяет капчу только при реально присланном smart-token. Регистрация не
// менялась: там сервер капчу требует безусловно.
//
// Запуск: node experiments/issue-564-captcha-unavailable.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

let failures = 0;
function check(condition, name) {
    console.log((condition ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!condition) failures++;
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

    matches(selector) {
        if (selector.startsWith('.'))
            return String(this.className || '').split(/\s+/).indexOf(selector.slice(1)) !== -1;
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        return false;
    }

    closest(selector) {
        let node = this;
        while (node) {
            if (node.matches(selector)) return node;
            node = node.parentElement || null;
        }
        return null;
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

    for (const [childId, groupId] of [['login-email', ''], ['login-password', 'login-password-group'], ['auth-db-select', 'auth-db-group']]) {
        const group = new FakeElement(groupId);
        group.className = 'database-field-group';
        elements.get(childId).parentElement = group;
        if (groupId) elements.set(groupId, group);
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

// scenario.captcha: что с капчей на момент сабмита.
//   'absent'   — скрипт не загрузился: ни window.smartCaptcha, ни виджета, ни input;
//   'unsolved' — виджет отрисован, но не решён (getResponse вернул пусто);
//   'solved'   — виджет отрисован и решён (есть токен).
async function runLoginScenario(captcha) {
    const document = createFakeDocument();
    const location = {
        origin: 'https://ideav.ru',
        hostname: 'ideav.ru',
        search: '?db=ateh',
        href: 'https://ideav.ru/start.html?db=ateh'
    };
    const smartCaptcha =
        captcha === 'absent' ? null :
        captcha === 'unsolved' ? { getResponse: () => '' } :
        { getResponse: () => 'tok' };
    const context = {
        console,
        URLSearchParams,
        Date,
        setTimeout,
        document,
        window: {
            location,
            smartCaptcha
        },
        localStorage: {
            getItem() { return null; },
            setItem() {}
        }
    };
    context.globalThis = context;

    vm.runInNewContext(appSource + '\nglobalThis.__App = App; globalThis.__AuthManager = AuthManager; globalThis.__ApiConfig = ApiConfig;', context);

    if (captcha !== 'absent') {
        // Виджет отрисован: render() проставляет widgetId в dataset контейнера (js/app.js).
        document.getElementById('login-captcha-container').dataset.widgetId = '0';
    }
    const app = new context.__App();
    await app.init();
    const calls = [];
    app.auth.login = async (email, password, db, captchaToken) => {
        calls.push(captchaToken);
        return { success: true, message: 'ok' };
    };

    document.getElementById('auth-db-select').value = 'ateh';
    document.getElementById('login-email').value = 'user';
    document.getElementById('login-password').value = 'password';

    await document.getElementById('login-form').dispatch('submit', {
        preventDefault() {}
    });

    return { context, document, calls, app };
}

async function run() {
    // 1) #564: капча не загрузилась вовсе — вход уходит без токена вместо тупика.
    {
        const { calls } = await runLoginScenario('absent');
        check(calls.length === 1,
            'когда капча не отрисовалась, вход отправляется без токена (#564)');
        check(calls.length === 1 && !calls[0],
            'в этом сценарии токен не передаётся');
    }

    // 2) Отрисованная, но не решённая капча по-прежнему блокирует вход.
    {
        const { calls } = await runLoginScenario('unsolved');
        check(calls.length === 0,
            'виджет на экране без токена — вход блокируется (прежнее поведение)');
    }

    // 3) Решённая капча — вход уходит с токеном (прежнее поведение).
    {
        const { calls } = await runLoginScenario('solved');
        check(calls.length === 1 && calls[0] === 'tok',
            'решённая капча передаёт токен (прежнее поведение)');
    }

    // 4) Возвращающийся пользователь с валидным токеном (#2906) — капча не мешает.
    {
        const { document, app, calls } = await runLoginScenario('absent');
        app._captchaBypass = true;
        app._captchaBypassChecked = true;
        await document.getElementById('login-form').dispatch('submit', { preventDefault() {} });
        check(calls.length === 1,
            'байпас #2906 пропускает вход и без капчи (прежнее поведение)');
    }

    // 5) Формат запроса: реальный AuthManager.login опускает smart-token без токена.
    {
        const { context } = await runLoginScenario('absent');
        const requests = [];
        context.fetch = async (url, opts) => {
            requests.push({ url, body: String(opts.body) });
            return { ok: true, json: async () => ({}) };
        };
        const auth = new context.__AuthManager(new context.__ApiConfig());
        await auth.login('user', 'pwd', 'ateh', null);
        check(requests.length === 1 && requests[0].body.indexOf('smart-token=') === -1,
            'без токена тело запроса не содержит smart-token');
        await auth.login('user', 'pwd', 'ateh', 'tok');
        check(requests.length === 2 && requests[1].body.indexOf('smart-token=tok') !== -1,
            'с токеном тело запроса содержит smart-token=tok');
    }

    // 6) Хелпер доступности капчи: отличает «не отрисовалась» от «не решена».
    {
        let rendered = null;
        try {
            const { context, document } = await runLoginScenario('absent');
            context.document = document;
            rendered = context.isCaptchaRendered('login-captcha-container');
        } catch (e) {
            rendered = 'error: ' + e.message;
        }
        check(rendered === false,
            'isCaptchaRendered: пустой контейнер без виджета — капчи нет (получено ' + rendered + ')');

        let renderedWidget = null;
        try {
            const { context, document } = await runLoginScenario('unsolved');
            context.document = document;
            renderedWidget = context.isCaptchaRendered('login-captcha-container');
        } catch (e) {
            renderedWidget = 'error: ' + e.message;
        }
        check(renderedWidget === true,
            'isCaptchaRendered: виджет с widgetId — капча на экране (получено ' + renderedWidget + ')');
    }

    console.log('\n' + (failures === 0 ? 'ALL TESTS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
}

run();
