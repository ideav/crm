const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const aiScript = fs.readFileSync(path.join(root, 'js/ai-chat.js'), 'utf8');
const indexPhp = fs.readFileSync(path.join(root, 'index.php'), 'utf8');

assert(
    !indexPhp.includes('$_COOKIE["integram_ai_chat_settings"]') &&
        !indexPhp.includes("$_COOKIE['integram_ai_chat_settings']"),
    'AI chat settings must not be read from request cookies'
);
assert(
    indexPhp.includes('getAiChatSettings(isset($_POST["settings"])'),
    'AI chat endpoint should read provider settings from the POST body'
);

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

function createCookieDocument(cookieStore) {
    const elements = {
        'ai-chat-input': createElement('ai-chat-input', { value: 'Создай таблицу клиентов' }),
        'ai-target-db': createElement('ai-target-db', { value: 'demo' }),
        'ai-service-endpoint': createElement('ai-service-endpoint', { value: 'https://api.openai.com/v1/chat/completions' }),
        'ai-service-model': createElement('ai-service-model', { value: 'gpt-4.1-mini' }),
        'ai-token-mode': createElement('ai-token-mode', { value: 'own' }),
        'ai-service-token': createElement('ai-service-token', { value: 'sk-local-storage-secret' }),
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
            if (!storedValue) {
                delete cookieStore[name];
            } else {
                cookieStore[name] = storedValue;
            }
        }
    });

    return { document, elements };
}

const legacySettings = {
    activeProviderId: 'openai',
    profiles: {
        openai: {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            model: 'gpt-4.1-mini',
            tokenMode: 'own',
            token: 'sk-legacy-cookie-secret',
            chargeBalance: false
        }
    }
};
const cookieStore = {
    integram_ai_chat_settings: encodeURIComponent(JSON.stringify(legacySettings))
};
const storage = {};
const { document, elements } = createCookieDocument(cookieStore);
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
                assistant: { content: 'Ответ сервера', raw: 'Ответ сервера' },
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

controller.loadAiServiceSettings();
assert.strictEqual(controller.aiActiveProviderId, 'openai', 'legacy cookie settings should still be loaded');
assert.strictEqual(
    controller.aiServiceProfiles.openai.token,
    'sk-legacy-cookie-secret',
    'legacy cookie token should be migrated into the controller state'
);
assert(
    storage.integram_ai_chat_settings,
    'AI settings should be migrated into localStorage'
);
assert(
    !cookieStore.integram_ai_chat_settings,
    'legacy AI settings cookie should be deleted after migration'
);

controller.saveAiServiceSettings();
const saved = JSON.parse(storage.integram_ai_chat_settings);
assert.strictEqual(saved.activeProviderId, 'openai', 'localStorage should keep the selected provider');
assert.strictEqual(saved.profiles.openai.token, 'sk-local-storage-secret', 'localStorage should save the user token');
assert(
    !cookieStore.integram_ai_chat_settings,
    'saving AI settings should not recreate the settings cookie'
);
assert(
    /localStorage|локаль/i.test(elements['ai-settings-state'].textContent),
    'settings state should mention local storage instead of cookies'
);

(async () => {
    await controller.sendAiChatMessage();

    assert(fetchRequest, 'sendAiChatMessage should call the server');
    assert(!cookieStore.integram_ai_chat_settings, 'sending a message should not create a settings cookie');

    const body = JSON.parse(fetchRequest.options.body);
    assert.strictEqual(body._xsrf, 'csrf-token');
    assert.strictEqual(body.payload.provider.id, 'openai');
    assert(!JSON.stringify(body.payload).includes('sk-local-storage-secret'), 'visible command payload must not include API tokens');
    assert.strictEqual(
        body.settings.profiles.openai.token,
        'sk-local-storage-secret',
        'server POST body should carry provider settings separately from the command payload'
    );

    console.log('ok - issue 2486 AI chat stores settings in localStorage, not cookies');
})().catch(err => {
    console.error(err);
    process.exit(1);
});
