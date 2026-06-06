// Regression test for issue #3187.
// Run with: node experiments/issue-3187-atex-orders-css.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'download', 'atex', 'css', 'orders.css');
const css = fs.readFileSync(cssPath, 'utf8');

function scanTopLevelRules(source) {
    const rules = [];
    let depth = 0;
    let selectorStart = 0;
    let quote = '';
    let escaped = false;
    let inComment = false;

    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        const next = source[i + 1];

        if (inComment) {
            if (ch === '*' && next === '/') {
                inComment = false;
                i += 1;
            }
            continue;
        }

        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                quote = '';
            }
            continue;
        }

        if (ch === '/' && next === '*') {
            inComment = true;
            i += 1;
            continue;
        }

        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }

        if (ch === '{') {
            if (depth === 0) {
                const selector = source.slice(selectorStart, i).trim();
                if (selector) rules.push(selector);
            }
            depth += 1;
            continue;
        }

        if (ch === '}') {
            depth -= 1;
            assert(depth >= 0, `unexpected closing brace at byte ${i}`);
            if (depth === 0) selectorStart = i + 1;
        }
    }

    assert.strictEqual(depth, 0, 'orders.css must have balanced CSS rule braces');
    assert.strictEqual(quote, '', 'orders.css must not end inside a quoted string');
    assert.strictEqual(inComment, false, 'orders.css must not end inside a comment');
    return rules;
}

const rules = scanTopLevelRules(css);
const confirmHoverIndex = rules.indexOf('.atex-orders-approve.is-confirm:hover');
const disabledButtonIndex = rules.indexOf('.atex-orders-btn:disabled,\n.atex-orders-btn:disabled:hover');

assert(confirmHoverIndex !== -1, 'confirm-hover button rule is present');
assert(disabledButtonIndex !== -1, 'disabled button rule remains a top-level rule');
assert(disabledButtonIndex > confirmHoverIndex, 'disabled button rule follows the confirm-hover rule');
assert(rules.indexOf('.atex-orders-fields') !== -1, 'create-order grid rule remains top-level');
assert(rules.indexOf('.atex-orders-create') !== -1, 'create-order panel rule remains top-level');

console.log('issue-3187 orders CSS regression checks passed');
