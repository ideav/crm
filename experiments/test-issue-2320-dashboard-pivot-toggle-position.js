// Test for issue #2320: the dashboard pivot settings button should be
// positioned at the left edge of .pvtRendererArea, not the right edge.
// Run with: node experiments/test-issue-2320-dashboard-pivot-toggle-position.js

const fs = require('fs');

const css = fs.readFileSync('css/dash.css', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function getRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'm'));
    return match ? match[1] : '';
}

function getDeclaration(rule, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = rule.match(new RegExp('(?:^|;)\\s*' + escaped + '\\s*:\\s*([^;]+)', 'm'));
    return match ? match[1].trim() : '';
}

const toggleRule = getRule('.dash-pivot-settings-toggle');

assert(toggleRule, '.dash-pivot-settings-toggle rule exists');
assert(getDeclaration(toggleRule, 'position') === 'absolute', 'pivot settings toggle is absolutely positioned inside renderer area');
assert(getDeclaration(toggleRule, 'left') === '0.35rem', 'pivot settings toggle is anchored to the left side');
assert(!getDeclaration(toggleRule, 'right'), 'pivot settings toggle is not anchored to the right side');

console.log('\nissue-2320 dashboard pivot toggle position: ok');
