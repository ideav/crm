/*
 * Regression test for issue #3039.
 *
 * The generated Atex orders workspace is rendered inside templates/atex/main.html,
 * so its surfaces must follow the shared light/dark theme variables from
 * css/styles.css instead of hard-coded light backgrounds.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const cssPath = path.join(root, 'download', 'atex', 'css', 'orders.css');
const docPath = path.join(root, 'docs', 'integram-app-workflow.md');

const css = fs.readFileSync(cssPath, 'utf8');
const doc = fs.readFileSync(docPath, 'utf8');

function parseDeclarations(source) {
    const rules = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = ruleRe.exec(source))) {
        const selectors = match[1].split(',').map((item) => item.trim()).filter(Boolean);
        const declarations = {};
        match[2].split(';').forEach((chunk) => {
            const idx = chunk.indexOf(':');
            if (idx === -1) return;
            const prop = chunk.slice(0, idx).trim();
            const value = chunk.slice(idx + 1).trim();
            if (prop && value) declarations[prop] = value;
        });
        rules.push({ selectors, declarations });
    }
    return rules;
}

const rules = parseDeclarations(css);

function declarationsFor(selector) {
    return rules
        .filter((rule) => rule.selectors.includes(selector))
        .map((rule) => rule.declarations)
        .reduce((acc, declarations) => Object.assign(acc, declarations), {});
}

function backgroundFor(selector) {
    const declarations = declarationsFor(selector);
    return declarations.background || declarations['background-color'] || '';
}

function assertThemeBackground(selector, expectedToken) {
    const value = backgroundFor(selector);
    assert(
        value.includes(expectedToken),
        selector + ' must use ' + expectedToken + ' for themed background, got: ' + value
    );
}

function assertThemedColor(selector, prop, expectedToken) {
    const value = declarationsFor(selector)[prop] || '';
    assert(
        value.includes(expectedToken),
        selector + ' must use ' + expectedToken + ' for ' + prop + ', got: ' + value
    );
}

assertThemeBackground('.atex-orders-btn-secondary:hover', '--bg-secondary');
assertThemeBackground('.atex-orders-table thead th', '--bg-secondary');
assertThemeBackground('.atex-orders-subtable thead th', '--bg-secondary');
assertThemeBackground('.atex-orders-row:hover', '--bg-secondary');
assertThemeBackground('.atex-orders-detail-row > td', '--bg-primary');

assertThemeBackground('.atex-orders-message--info', '--atex-orders-info-bg');
assertThemedColor('.atex-orders-message--info', 'color', '--atex-orders-info-text');
assertThemeBackground('.atex-orders-message--success', '--color-success-bg');
assertThemedColor('.atex-orders-message--success', 'color', '--color-success');
assertThemeBackground('.atex-orders-message--error', '--color-error-bg');
assertThemedColor('.atex-orders-message--error', 'color', '--color-error');

assert(
    /рабочее место обязано опираться на токены темы из\s+`templates\/(?:<имя базы>\/)?main\.html`/.test(doc),
    'workflow docs must explicitly require generated workplaces to use main.html theme tokens'
);

console.log('issue-3039 atex orders theme checks: ok');
