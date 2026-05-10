const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const aiStyles = fs.readFileSync(path.join(root, 'css/ai-chat.css'), 'utf8');

function getRuleBody(selectorPattern, label) {
    const match = aiStyles.match(new RegExp(selectorPattern + '\\s*\\{([\\s\\S]*?)\\}', 'm'));
    assert(match, `css/ai-chat.css should contain ${label}`);
    return match[1];
}

function declarationsFor(body) {
    return body.split(';').reduce((declarations, part) => {
        const colon = part.indexOf(':');
        if (colon === -1) return declarations;

        const property = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim().toLowerCase();
        if (property) declarations[property] = value;
        return declarations;
    }, {});
}

const buttonRule = declarationsFor(getRuleBody(
    '\\.ai-chat-toggle\\s*,\\s*\\.ai-chat-icon-btn',
    '.ai-chat-toggle/.ai-chat-icon-btn rule'
));
const hoverRule = declarationsFor(getRuleBody(
    '\\.ai-chat-toggle:hover\\s*,\\s*\\.ai-chat-icon-btn:hover',
    '.ai-chat-toggle/.ai-chat-icon-btn hover rule'
));

assert(
    buttonRule.border === 'none' || buttonRule.border === '0' || buttonRule.border === '0px',
    '.ai-chat-toggle and .ai-chat-icon-btn should explicitly remove the native button border'
);
assert(
    !Object.prototype.hasOwnProperty.call(hoverRule, 'border-color'),
    '.ai-chat-toggle and .ai-chat-icon-btn hover styles should not restore a visible border'
);

console.log('ok - issue 2488 AI chat buttons have no border');
