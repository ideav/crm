const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const aiScript = fs.readFileSync(path.join(root, 'js/ai-chat.js'), 'utf8');

function createElement(id, overrides = {}) {
    return Object.assign({
        id,
        value: '',
        checked: false,
        disabled: false,
        placeholder: '',
        textContent: '',
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 0,
        children: [],
        dataset: {},
        classList: {
            contains() { return false; },
            add() {},
            remove() {}
        },
        addEventListener() {},
        appendChild(child) {
            this.children.push(child);
            this.scrollHeight = this.children.length;
        },
        querySelectorAll() {
            return [];
        },
        setAttribute() {},
        removeAttribute() {}
    }, overrides);
}

const cookieStore = {};
const storage = {};
const elements = {
    'ai-chat-input': createElement('ai-chat-input', { value: 'Создай таблицу клиентов' }),
    'ai-target-db': createElement('ai-target-db', { value: 'demo' }),
    'ai-service-endpoint': createElement('ai-service-endpoint', { value: 'https://api.openai.com/v1/chat/completions' }),
    'ai-service-model': createElement('ai-service-model', { value: 'gpt-4.1-mini' }),
    'ai-token-mode': createElement('ai-token-mode', { value: 'own' }),
    'ai-service-token': createElement('ai-service-token', { value: 'sk-test-secret' }),
    'ai-charge-balance': createElement('ai-charge-balance', { checked: false }),
    'ai-settings-state': createElement('ai-settings-state'),
    'ai-chat-status': createElement('ai-chat-status'),
    'ai-chat-messages': createElement('ai-chat-messages'),
    'ai-command-queue': createElement('ai-command-queue')
};

const document = {
    addEventListener() {},
    getElementById(id) {
        return elements[id] || null;
    },
    createElement(tagName) {
        return createElement(tagName);
    },
    querySelector() {
        return null;
    }
};

Object.defineProperty(document, 'cookie', {
    get() {
        return Object.keys(cookieStore)
            .map(name => `${name}=${cookieStore[name]}`)
            .join('; ');
    },
    set(value) {
        const pair = String(value).split(';')[0];
        const eq = pair.indexOf('=');
        if (eq === -1) return;
        const name = pair.slice(0, eq);
        const storedValue = pair.slice(eq + 1);
        if (storedValue) cookieStore[name] = storedValue;
        else delete cookieStore[name];
    }
});

let fetchRequest = null;
const context = {
    console,
    document,
    navigator: {},
    localStorage: {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null;
        },
        setItem(key, value) {
            storage[key] = String(value);
        },
        removeItem(key) {
            delete storage[key];
        }
    },
    setTimeout(fn) { fn(); },
    db: 'demo',
    action: 'table',
    uid: '42',
    xsrf: 'csrf-token',
    menuData: [],
    fetch: async (url, options) => {
        fetchRequest = { url, options };
        return {
            ok: true,
            status: 200,
            json: async () => ({
                assistant: { content: 'План подготовлен сервером.', raw: 'План подготовлен сервером.' },
                command: { title: 'Создать таблицу', status: 'Получен ответ' },
                provider: { id: 'openai', label: 'ChatGPT / OpenAI', model: 'gpt-4.1-mini' }
            })
        };
    },
    window: {
        location: { pathname: '/demo/table' }
    }
};
context.window.window = context.window;
context.window.document = document;
context.window.fetch = context.fetch;
context.window.localStorage = context.localStorage;

vm.runInNewContext(aiScript, context, { filename: 'js/ai-chat.js' });
const Controller = context.window.IntegramAiChatController;
const controller = new Controller();
controller.aiActiveProviderId = 'openai';

(async () => {
    await controller.sendAiChatMessage();

    assert(fetchRequest, 'sendAiChatMessage should call the AI chat server endpoint');
    assert.strictEqual(
        fetchRequest.url,
        '/demo/ai/chat?JSON=1',
        'AI chat should post through the current database endpoint, not /my'
    );

    const body = JSON.parse(fetchRequest.options.body);
    assert.strictEqual(body.payload.context.currentDb, 'demo');
    assert.strictEqual(body.payload.context.targetDb, 'demo');

    console.log('ok - issue 2491 AI chat uses current database endpoint');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
