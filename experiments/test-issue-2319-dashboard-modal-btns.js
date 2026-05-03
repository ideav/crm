// Regression test for issue #2319: dashboard panel filter modal actions
// need the same detached button row spacing as the other dashboard modals.

const fs = require('fs');

const css = fs.readFileSync('css/dash.css', 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function declarationsForSelector(targetSelector) {
    const declarations = [];
    const ruleRe = /([^{}]+)\{([^{}]+)\}/g;
    let match;
    while ((match = ruleRe.exec(css)) !== null) {
        const selectors = match[1].split(',').map((selector) => selector.trim());
        if (selectors.includes(targetSelector)) declarations.push(match[2]);
    }
    return declarations.join('\n');
}

const panelFilterButtons = declarationsForSelector('#dash-panel-filter-modal .dash-modal-btns');

assert(panelFilterButtons, 'panel filter modal button row has a CSS rule');
assert(/display\s*:\s*flex\b/.test(panelFilterButtons), 'panel filter modal actions are laid out as a row');
assert(/gap\s*:\s*0\.5rem\b/.test(panelFilterButtons), 'panel filter modal actions keep horizontal spacing');
assert(/justify-content\s*:\s*flex-end\b/.test(panelFilterButtons), 'panel filter modal actions align to the right');
assert(/margin-top\s*:\s*0\.75rem\b/.test(panelFilterButtons), 'panel filter modal actions are detached from fields above');

console.log('\nissue-2319 dashboard modal button spacing: ok');
