const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const aiScript = fs.readFileSync(path.join(root, 'js/ai-chat.js'), 'utf8');
const mainTemplate = fs.readFileSync(path.join(root, 'templates/main.html'), 'utf8');
const ruMainTemplate = fs.readFileSync(path.join(root, 'templates/ru/main.html'), 'utf8');

function createCookieDocument() {
    const cookieStore = {};
    const elements = {
        'ai-service-endpoint': { value: '' },
        'ai-service-model': { value: '' },
        'ai-token-mode': { value: 'adc', disabled: false },
        'ai-service-token': { value: '', disabled: false, placeholder: '' },
        'ai-charge-balance': { checked: false },
        'ai-settings-state': { textContent: '' },
        'ai-target-db': { value: 'demo' },
        'ai-chat-status': { textContent: '' }
    };

    const document = {
        addEventListener() {},
        getElementById(id) {
            return elements[id] || null;
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

    return { document, elements, cookieStore };
}

function createController() {
    const { document, elements, cookieStore } = createCookieDocument();
    const context = {
        console,
        document,
        localStorage: {
            getItem() { return null; },
            setItem() {
                throw new Error('AI provider settings must be saved to cookies, not localStorage');
            }
        },
        navigator: {},
        setTimeout(fn) { fn(); },
        window: {
            location: { pathname: '/demo/main' }
        }
    };
    context.window.window = context.window;
    context.window.document = document;

    vm.runInNewContext(aiScript, context, { filename: 'js/ai-chat.js' });
    const Controller = context.window.IntegramAiChatController;
    return { controller: new Controller(), elements, cookieStore };
}

function assertTemplateProviders(template, label) {
    [
        'value="gemini"',
        'value="groq"',
        'value="mistral"',
        'value="adc"'
    ].forEach(snippet => {
        assert(template.includes(snippet), `${label} should contain ${snippet}`);
    });
}

assertTemplateProviders(mainTemplate, 'templates/main.html');
assertTemplateProviders(ruMainTemplate, 'templates/ru/main.html');

const { controller, elements, cookieStore } = createController();
assert.strictEqual(controller.aiActiveProviderId, 'gemini', 'Gemini should be the default provider');

const profiles = controller.getDefaultAiServiceProfiles();
assert(profiles.gemini, 'Gemini profile should exist');
assert(profiles.groq, 'Groq profile should exist');
assert(profiles.mistral, 'Mistral AI profile should exist');
assert.strictEqual(profiles.gemini.tokenMode, 'adc', 'Gemini should use Application Default Credentials');
assert.strictEqual(profiles.gemini.model, 'google/gemini-2.5-flash', 'Gemini should use a Vertex Gemini model id');
assert(
    profiles.gemini.endpoint.includes('aiplatform.googleapis.com') &&
        profiles.gemini.endpoint.includes('/endpoints/openapi/chat/completions'),
    'Gemini endpoint should target Vertex AI OpenAI-compatible chat completions'
);

controller.populateAiServiceForm();
assert.strictEqual(elements['ai-token-mode'].value, 'adc', 'Gemini form should select ADC credentials');
assert.strictEqual(elements['ai-token-mode'].disabled, true, 'Gemini credential mode should be locked to ADC');
assert.strictEqual(elements['ai-service-token'].disabled, true, 'Gemini token input should be disabled');

controller.saveAiServiceSettings();
assert(cookieStore.integram_ai_chat_settings, 'AI settings should be saved into the settings cookie');

const saved = JSON.parse(decodeURIComponent(cookieStore.integram_ai_chat_settings));
assert.strictEqual(saved.activeProviderId, 'gemini', 'Saved cookie should keep Gemini selected');
assert.strictEqual(saved.profiles.gemini.tokenMode, 'adc', 'Saved Gemini profile should keep ADC mode');
assert.strictEqual(saved.profiles.gemini.token, '', 'Saved Gemini profile should not store an API token');
assert.strictEqual(saved.profiles.groq.endpoint, 'https://api.groq.com/openai/v1/chat/completions');
assert.strictEqual(saved.profiles.mistral.endpoint, 'https://api.mistral.ai/v1/chat/completions');

const payload = controller.buildAiRequestPayload('Создай таблицу клиентов', 'create_table');
assert.strictEqual(payload.provider.id, 'gemini');
assert.strictEqual(payload.provider.credentialSource, 'application_default_credentials');
assert.strictEqual(payload.provider.applicationDefaultCredentials, true);
assert.strictEqual(payload.provider.hasUserToken, false);

console.log('ok - issue 2481 AI providers use Gemini ADC defaults and cookie settings');
