const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function includesAll(source, snippets, label) {
    snippets.forEach(snippet => {
        assert(
            source.includes(snippet),
            `${label} should contain ${snippet}`
        );
    });
}

function excludesAll(source, snippets, label) {
    snippets.forEach(snippet => {
        assert(
            !source.includes(snippet),
            `${label} should not contain ${snippet}`
        );
    });
}

const cabinetTemplate = read('templates/my/main.html');
const mainTemplate = read('templates/main.html');
const ruMainTemplate = read('templates/ru/main.html');
const aiScript = read('js/ai-chat.js');
const aiStyles = read('css/ai-chat.css');
const cabinetScript = read('js/cabinet.js');
const cabinetStyles = read('css/cabinet.css');

const chatMarkup = [
    'id="ai-chat-toggle"',
    'id="ai-chat-panel"',
    'id="ai-service-provider"',
    'value="gemini"',
    'value="integram"',
    'value="openai"',
    'value="gigachat"',
    'value="deepseek"',
    'value="groq"',
    'value="mistral"',
    'value="adc"',
    'data-ai-command="create_table"',
    'data-ai-command="create_structure"',
    'data-ai-command="create_workspace"',
    'id="ai-command-queue"'
];

includesAll(mainTemplate, [
    '<link rel="stylesheet" href="/css/ai-chat.css">',
    '<script src="/js/ai-chat.js"></script>',
    ...chatMarkup
], 'templates/main.html');

includesAll(ruMainTemplate, [
    '<link rel="stylesheet" href="/css/ai-chat.css">',
    '<script src="/js/ai-chat.js"></script>',
    ...chatMarkup
], 'templates/ru/main.html');

excludesAll(cabinetTemplate, chatMarkup, 'templates/my/main.html');

includesAll(aiScript, [
    'class IntegramAiChatController',
    'getDefaultAiServiceProfiles()',
    'getAiCommandPrompts()',
    'buildAiRequestPayload(',
    'writeAiServiceCookie(',
    'create_table',
    'create_structure',
    'create_workspace',
    "this.aiActiveProviderId = 'gemini'",
    'renderAiCommandQueue()'
], 'js/ai-chat.js');

includesAll(aiStyles, [
    '.ai-chat-toggle',
    '.ai-chat-panel',
    '.ai-chat-panel.open',
    '.ai-chat-message',
    '.ai-command-queue',
    '@media (max-width: 600px)'
], 'css/ai-chat.css');

excludesAll(cabinetScript, [
    'setupAiChat()',
    'getDefaultAiServiceProfiles()',
    'getAiCommandPrompts()',
    'buildAiRequestPayload(',
    'populateAiDatabaseSelect()',
    'aiChatStorageKey'
], 'js/cabinet.js');

excludesAll(cabinetStyles, [
    '.ai-chat-toggle',
    '.ai-chat-panel',
    '.ai-command-queue'
], 'css/cabinet.css');

console.log('ok - issue 2474 AI chat is shared with separate assets');
