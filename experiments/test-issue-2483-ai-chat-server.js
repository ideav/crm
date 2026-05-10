const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const aiScript = fs.readFileSync(path.join(root, 'js/ai-chat.js'), 'utf8');
const indexPhp = fs.readFileSync(path.join(root, 'index.php'), 'utf8');

[
    'case "ai":',
    'handleAiChatRequest(',
    'callAiChatProvider(',
    'getAiProviderToken(',
    'getGoogleApplicationDefaultAccessToken('
].forEach(snippet => {
    assert(
        indexPhp.includes(snippet),
        `index.php should include AI chat server support: ${snippet}`
    );
});

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
    menuData: [{ menu_id: '1', menu_up: '', name: 'Клиенты', href: '/demo/object/100' }],
    fetch: async (url, options) => {
        fetchRequest = { url, options };
        return {
            ok: true,
            status: 200,
            json: async () => ({
                assistant: {
                    content: 'План подготовлен сервером.',
                    raw: '{"commands":[]}'
                },
                command: {
                    title: 'Создать таблицу',
                    status: 'Получен ответ'
                },
                provider: {
                    id: 'openai',
                    model: 'gpt-4.1-mini'
                }
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
    assert.strictEqual(fetchRequest.url, '/my/ai/chat?JSON=1');
    assert.strictEqual(fetchRequest.options.method, 'POST');
    assert.strictEqual(fetchRequest.options.credentials, 'include');
    assert.match(fetchRequest.options.headers['Content-Type'], /application\/json/);

    const body = JSON.parse(fetchRequest.options.body);
    assert.strictEqual(body._xsrf, 'csrf-token');
    assert.strictEqual(body.payload.context.targetDb, 'demo');
    assert.strictEqual(body.payload.provider.id, 'openai');
    assert.strictEqual(body.payload.messages[0].content, 'Создай таблицу клиентов');
    assert(!JSON.stringify(body.payload).includes('sk-test-secret'), 'API tokens must not be copied into the visible command payload');
    assert.strictEqual(body.settings.profiles.openai.token, 'sk-test-secret', 'provider settings should be posted outside the visible command payload');
    assert(!cookieStore.integram_ai_chat_settings, 'AI settings must not be persisted to cookies');

    assert.strictEqual(controller.aiCommandQueue.length, 1);
    assert.strictEqual(controller.aiCommandQueue[0].status, 'Получен ответ');
    assert.strictEqual(controller.aiCommandQueue[0].serverResponse.assistant.content, 'План подготовлен сервером.');

    console.log('ok - issue 2483 AI chat posts to server endpoint and queues server response');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
