/**
 * Regression test for issue #2134.
 *
 * SmartQ used to apply position: sticky to the <tr class="tr-sticky"> itself.
 * Browsers treat sticky table rows inconsistently, which can detach the header
 * from the table layout while scrolling. The sticky behavior must live on the
 * header cells instead, so each <th> remains bound to its table column.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const templatePath = path.join(__dirname, '..', 'templates', 'smartq.html');
const source = fs.readFileSync(templatePath, 'utf8');

function getCssRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match ? match[1] : '';
}

const rowRule = getCssRule('.tr-sticky');
const cellRule = getCssRule('.tr-sticky th');

if (rowRule) {
    assert(!/position\s*:\s*sticky\s*;?/i.test(rowRule),
        '.tr-sticky must not apply sticky positioning to the table row');
}

assert(cellRule, '.tr-sticky th rule should exist');
assert(/position\s*:\s*sticky\s*;?/i.test(cellRule),
    '.tr-sticky th must apply sticky positioning to header cells');
assert(/top\s*:\s*48px\s*;?/i.test(cellRule),
    '.tr-sticky th should keep the existing navbar offset');
assert(/z-index\s*:\s*[1-9]\d*\s*;?/i.test(cellRule),
    '.tr-sticky th should keep header cells above table body cells');

console.log('ok - SmartQ sticky header is applied to cells, not the table row');
