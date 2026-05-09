const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'templates/my/main.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/cabinet.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'css/cabinet.css'), 'utf8');

function includesAll(source, snippets, label) {
    snippets.forEach(snippet => {
        assert(
            source.includes(snippet),
            `${label} should contain ${snippet}`
        );
    });
}

includesAll(template, [
    'id="ai-chat-toggle"',
    'id="ai-chat-panel"',
    'id="ai-service-provider"',
    'value="integram"',
    'value="openai"',
    'value="gigachat"',
    'value="deepseek"',
    'data-ai-command="create_table"',
    'data-ai-command="create_structure"',
    'data-ai-command="create_workspace"',
    'id="ai-command-queue"'
], 'templates/my/main.html');

includesAll(script, [
    'setupAiChat()',
    'getDefaultAiServiceProfiles()',
    'getAiCommandPrompts()',
    'buildAiRequestPayload(',
    'create_table',
    'create_structure',
    'create_workspace',
    'localStorage.setItem(this.aiChatStorageKey',
    'renderAiCommandQueue()'
], 'js/cabinet.js');

includesAll(styles, [
    '.ai-chat-toggle',
    '.ai-chat-panel',
    '.ai-chat-panel.open',
    '.ai-chat-message',
    '.ai-command-queue',
    '@media (max-width: 600px)'
], 'css/cabinet.css');

console.log('ok - issue 2471 AI chat scaffolding is present');
