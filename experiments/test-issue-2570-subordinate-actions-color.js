const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const cssPath = path.join(__dirname, '..', 'css', 'integram-table.css');
const css = fs.readFileSync(cssPath, 'utf8');

function getRuleBlock(selectorText) {
    const idx = css.indexOf(selectorText + ' {');
    if (idx < 0) return '';
    const open = css.indexOf('{', idx);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
}

function getDeclaration(block, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp('(?:^|[;\\s])' + escaped + '\\s*:\\s*([^;]+);'));
    return match ? match[1].trim() : '';
}

const groupedSelector = '.subordinate-table-actions .subordinate-copy-buffer-btn,\n.subordinate-table-actions .subordinate-paste-buffer-btn,\n.subordinate-table-actions .subordinate-table-link';
const groupedHoverSelector = '.subordinate-table-actions .subordinate-copy-buffer-btn:hover,\n.subordinate-table-actions .subordinate-paste-buffer-btn:hover,\n.subordinate-table-actions .subordinate-table-link:hover';

const baseBlock = getRuleBlock(groupedSelector);
const hoverBlock = getRuleBlock(groupedHoverSelector);

assert(baseBlock.length > 0, 'grouped base rule for .subordinate-table-actions icons exists');
assert(hoverBlock.length > 0, 'grouped hover rule for .subordinate-table-actions icons exists');

const linkRuleIdx = css.lastIndexOf('.subordinate-table-link {');
assert(linkRuleIdx > 0, '.subordinate-table-link base rule exists');
const linkOpen = css.indexOf('{', linkRuleIdx);
const linkClose = css.indexOf('}', linkOpen);
const linkBlock = css.slice(linkOpen + 1, linkClose);

const linkHoverIdx = css.lastIndexOf('.subordinate-table-link:hover {');
assert(linkHoverIdx > 0, '.subordinate-table-link:hover rule exists');
const linkHoverOpen = css.indexOf('{', linkHoverIdx);
const linkHoverClose = css.indexOf('}', linkHoverOpen);
const linkHoverBlock = css.slice(linkHoverOpen + 1, linkHoverClose);

const baseColor = getDeclaration(baseBlock, 'color');
const linkColor = getDeclaration(linkBlock, 'color') || 'var(--md-primary)';

assert(
    baseColor === 'var(--md-primary)',
    'grouped icons should use var(--md-primary) as base color, got: ' + baseColor
);

const hoverColor = getDeclaration(hoverBlock, 'color');
const linkHoverColor = getDeclaration(linkHoverBlock, 'color') || 'var(--md-primary-dark)';

assert(
    hoverColor === 'var(--md-primary-dark)',
    'grouped icons should use var(--md-primary-dark) on hover, got: ' + hoverColor
);

const hoverBg = getDeclaration(hoverBlock, 'background-color');
assert(
    hoverBg === 'rgba(25, 118, 210, 0.08)',
    'grouped icons should use rgba(25, 118, 210, 0.08) hover background, got: ' + hoverBg
);

console.log('issue 2570 subordinate-table-actions icon color checks passed');
