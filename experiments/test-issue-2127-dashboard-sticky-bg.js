const fs = require('fs');

const source = fs.readFileSync('templates/dash.html', 'utf8');
const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/);

if (!styleMatch) {
    throw new Error('Missing inline dashboard style block');
}

const css = styleMatch[1];

function blocksFor(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = Array.from(css.matchAll(new RegExp('(?:^|\\})\\s*([^{}]*' + escaped + '[^{}]*)\\s*\\{([^{}]*)\\}', 'gm')));
    if (matches.length === 0) {
        throw new Error('Missing CSS block for ' + selector);
    }
    return matches.map((match) => match[2]);
}

function assertOpaqueThemeBackground(selector, expectedVar) {
    const blocks = blocksFor(selector);
    if (!blocks.some((block) => block.includes(expectedVar))) {
        throw new Error(selector + ' must use ' + expectedVar + ' for an opaque themed background');
    }
    if (blocks.some((block) => /background(?:-color)?\s*:\s*transparent\b/.test(block))) {
        throw new Error(selector + ' must not use a transparent background');
    }
}

assertOpaqueThemeBackground('.f-panel td:first-child', '--bg-primary');
assertOpaqueThemeBackground('.f-panel th:first-child', '--bg-secondary');
assertOpaqueThemeBackground('.dash-head th', '--bg-secondary');

console.log('issue-2127 dashboard sticky backgrounds: ok');
