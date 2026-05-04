'use strict';

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

const label = declarationsForSelector('.dash-panel-filter-label');
const toggleLabel = declarationsForSelector('.dash-panel-filter-label--with-toggle');

assert(label, 'panel filter label has a CSS rule');
assert(/background\s*:\s*var\(--bg-secondary,\s*#f8f9fa\)/.test(label), 'panel filter label uses the light secondary background');
assert(/border-bottom\s*:\s*1px\s+solid\s+var\(--border-color,\s*#dee2e6\)/.test(label), 'panel filter label is separated from options below');
assert(/padding\s*:\s*0\.4rem\s+0\.6rem\b/.test(label), 'panel filter label has enough vertical header padding');
assert(/margin\s*:\s*-0\.55rem\s+-0\.6rem\s+0\.45rem\b/.test(label), 'panel filter label spans the field width as a header row');

assert(toggleLabel, 'panel filter label with bulk toggle has a CSS rule');
assert(/display\s*:\s*flex\b/.test(toggleLabel), 'panel filter label with bulk toggle keeps checkbox and text aligned');

console.log('\nissue-2354 dashboard filter label styling: ok');
