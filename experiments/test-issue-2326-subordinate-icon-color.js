const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const cssPath = path.join(__dirname, '..', 'css', 'integram-table.css');
const css = fs.readFileSync(cssPath, 'utf8');

function getRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'g'));
    assert(match && match.length > 0, selector + ' rule exists');
    return match[match.length - 1];
}

function getDeclaration(rule, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rule.match(new RegExp(escaped + '\\s*:\\s*([^;]+);'));
    return match ? match[1].trim() : '';
}

const subordinateLinkRule = getRule('.subordinate-table-link');
const subordinateLinkHoverRule = getRule('.subordinate-table-link:hover');
const iconLinkRule = getRule('.subordinate-table-icon-link');
const iconLinkHoverRule = getRule('.subordinate-table-icon-link:hover');

assert(
    getDeclaration(iconLinkRule, 'color') === getDeclaration(subordinateLinkRule, 'color'),
    'split table icon link should use the same base color as .subordinate-table-link'
);
assert(
    getDeclaration(iconLinkHoverRule, 'color') === getDeclaration(subordinateLinkHoverRule, 'color'),
    'split table icon link should use the same hover color as .subordinate-table-link'
);

console.log('issue 2326 subordinate icon color checks passed');
