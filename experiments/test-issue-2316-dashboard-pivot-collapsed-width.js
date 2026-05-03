// Test for issue #2316: collapsed dashboard pivot output should keep its
// natural width instead of stretching .pvtRendererArea across the whole panel.

const fs = require('fs');

const css = fs.readFileSync('css/dash.css', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function parseRules(source) {
    const rules = [];
    const regex = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = regex.exec(source))) {
        rules.push({
            selector: match[1].trim(),
            body: match[2]
        });
    }
    return rules;
}

function selectors(rule) {
    return rule.selector.split(',').map(selector => selector.trim());
}

function getDeclaration(rule, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rule.body.match(new RegExp('(?:^|;)\\s*' + escaped + '\\s*:\\s*([^;]+)', 'm'));
    return match ? match[1].trim() : '';
}

function selectorMentionsCollapsedPivotWidth(selector) {
    return selector.indexOf('.dash-pivot-ui.dash-pivot-controls-collapsed') !== -1
        && (selector.indexOf('.pvtUi') !== -1 || selector.indexOf('.pvtRendererArea') !== -1);
}

const collapsedWidthRule = parseRules(css).find(rule => {
    return selectors(rule).some(selectorMentionsCollapsedPivotWidth)
        && getDeclaration(rule, 'width') !== '';
});

assert(collapsedWidthRule, 'collapsed pivot width rule exists');
assert(getDeclaration(collapsedWidthRule, 'width') === 'auto',
    'collapsed pivot width rule uses auto rather than forcing 100% panel width');

console.log('\nissue-2316 dashboard pivot collapsed width: ok');
