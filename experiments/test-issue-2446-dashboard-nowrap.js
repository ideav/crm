'use strict';

// Issue #2446: dashboard table values with DATE, SIGNED, and NUMBER formats
// must stay unbroken even when tile mode allows other table content to wrap.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const jsSource = fs.readFileSync('js/dash.js', 'utf8');
const cssSource = fs.readFileSync('css/dash.css', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = jsSource.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);

    const braceStart = jsSource.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < jsSource.length; i++) {
        if (jsSource[i] === '{') depth++;
        if (jsSource[i] === '}') depth--;
        if (depth === 0) return jsSource.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

const code = `
var dashItems = {};

${extractFunction('dashAttr')}
${extractFunction('dashCellValueFormat')}
${extractFunction('dashCellFormatAttribute')}
`;

const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

ctx.dashItems.dateItem = { format: 'date' };
ctx.dashItems.signedItem = { format: 'SIGNED' };
ctx.dashItems.numberItem = { format: 'NUMBER' };
ctx.dashItems.textItem = { format: 'CHARS' };

assert.strictEqual(ctx.dashCellValueFormat('dateItem'), 'DATE');
assert.strictEqual(ctx.dashCellFormatAttribute('dateItem'), ' data-format="DATE"');
assert.strictEqual(ctx.dashCellFormatAttribute('signedItem'), ' data-format="SIGNED"');
assert.strictEqual(ctx.dashCellFormatAttribute('numberItem'), ' data-format="NUMBER"');
assert.strictEqual(ctx.dashCellFormatAttribute('textItem'), ' data-format="CHARS"');
assert.strictEqual(ctx.dashCellFormatAttribute('missing'), '');

['DATE', 'SIGNED', 'NUMBER'].forEach((format) => {
    const rulePattern = new RegExp('td\\[data-format="' + format + '"\\][^{]*{[^}]*white-space:\\s*nowrap;[^}]*overflow-wrap:\\s*normal;', 's');
    assert(rulePattern.test(cssSource), format + ' dashboard value cells should have a nowrap CSS rule');
});

assert(!/td\[data-format="CHARS"\][^{]*{[^}]*white-space:\s*nowrap;/s.test(cssSource),
    'text dashboard cells should remain wrappable');

console.log('issue-2446 dashboard nowrap formats: ok');
