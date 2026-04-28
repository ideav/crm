/**
 * Issue #2230 regression coverage for ProcVac row hover styling.
 *
 * Run with: node experiments/test-issue-2230-procvac-row-hover.js
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(rootDir, 'css', 'procvac.css'), 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function getRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped + '\\s*{[^}]+}');
    return css.match(pattern);
}

const rowHoverRule = getRule('.procvac-data-row:hover .procvac-cell');
assert(rowHoverRule, 'ProcVac data row hover applies to every cell in the row');
assert(
    /background:\s*rgba\(37,\s*99,\s*235,\s*0\.035\);/.test(rowHoverRule[0]),
    'row hover uses a more muted blue highlight than cell hover',
);

const editableHoverRule = getRule('.procvac-cell--editable:hover');
assert(editableHoverRule, 'editable cell hover rule still exists');
assert(
    /background:\s*rgba\(37,\s*99,\s*235,\s*0\.07\);/.test(editableHoverRule[0]),
    'editable cell hover remains stronger than row hover',
);
assert(
    css.indexOf('.procvac-data-row:hover .procvac-cell') < css.indexOf('.procvac-cell--editable:hover'),
    'cell hover rule follows row hover rule so the hovered cell stays more prominent',
);

console.log('issue-2230 procvac row hover: ok');
