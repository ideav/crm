// Regression checks for ideav/crm#3008.
//
// Run with:
//   node experiments/issue-3008-atex-navbar-contrast.test.js

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseRules(css) {
    const rules = [];
    const re = /([^{}]+)\{([^{}]+)\}/g;
    let match;

    while ((match = re.exec(stripComments(css))) !== null) {
        const selectorText = match[1].trim();
        if (!selectorText || selectorText.startsWith('@')) continue;

        rules.push({
            selectors: selectorText.split(',').map((selector) => selector.trim()),
            body: match[2],
        });
    }

    return rules;
}

function declarationsFor(rules, selector) {
    return rules
        .filter((rule) => rule.selectors.includes(selector))
        .map((rule) => rule.body);
}

function hasDeclaration(rules, selector, property, valuePattern) {
    return declarationsFor(rules, selector).some((body) => {
        const propertyPattern = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(propertyPattern + '\\s*:\\s*([^;]+)', 'i');
        const match = body.match(re);
        return match && valuePattern.test(match[1].trim());
    });
}

const template = read('templates/atex/main.html');
const mainAppIndex = template.indexOf('/css/main-app.css');
const brandIndex = template.indexOf('/download/{_global_.z}/css/brand.css?0{_global_.version}');
const aiChatIndex = template.indexOf('/css/ai-chat.css');

assert(mainAppIndex !== -1, 'templates/atex/main.html loads shared app shell styles');
assert(brandIndex !== -1, 'templates/atex/main.html loads the Atex brand stylesheet');
assert(aiChatIndex !== -1, 'templates/atex/main.html loads AI chat styles');
assert(
    brandIndex > mainAppIndex,
    'Atex brand stylesheet loads after shared app shell styles'
);

const rules = parseRules(read('download/atex/css/brand.css'));

[
    '.navbar .ai-chat-toggle',
    '.navbar .account-info',
].forEach((selector) => {
    assert(
        hasDeclaration(rules, selector, 'background-color', /var\(--atex-nav-control-bg\)/),
        selector + ' gets a branded top-bar control background instead of the shared light surface'
    );
});

[
    '.navbar .ai-chat-toggle:hover',
    '.navbar .account-info:hover',
].forEach((selector) => {
    assert(
        hasDeclaration(rules, selector, 'background-color', /var\(--atex-nav-control-bg-hover\)/),
        selector + ' keeps the top-bar label/icon visible on hover'
    );
});

[
    '.navbar .ai-chat-toggle',
    '.navbar .account-info',
    '.navbar .account-email',
    '.navbar .user-menu-arrow',
].forEach((selector) => {
    assert(
        hasDeclaration(rules, selector, 'color', /var\(--atex-on-navy\)/),
        selector + ' uses the high-contrast on-navy text color'
    );
});

console.log('issue-3008 atex navbar contrast checks passed');
