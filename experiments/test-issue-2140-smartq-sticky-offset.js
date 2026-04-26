/**
 * Regression test for issue #2140.
 *
 * SmartQ can be rendered inside different main.html layouts. Its sticky table
 * header must not depend on a fixed navbar height because the containing scroll
 * area and navbar height can change at runtime.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const templatePath = path.join(__dirname, '..', 'templates', 'smartq.html');
const source = fs.readFileSync(templatePath, 'utf8');

function getCssRule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    return match ? match[1] : '';
}

const rowRule = getCssRule('.tr-sticky');
const cellRule = getCssRule('.tr-sticky th');
const stickyRules = rowRule + '\n' + cellRule;

if (rowRule) {
    assert(!/position\s*:\s*sticky\s*;?/i.test(rowRule),
        '.tr-sticky must not apply sticky positioning to the table row');
    assert(!/top\s*:\s*48px\s*;?/i.test(rowRule),
        '.tr-sticky must not hard-code the navbar offset on the table row');
}

assert(cellRule, '.tr-sticky th rule should exist');
assert(/position\s*:\s*sticky\s*;?/i.test(cellRule),
    '.tr-sticky th must apply sticky positioning to header cells');
assert(/top\s*:\s*var\(\s*--smartq-sticky-top\s*,\s*0px\s*\)\s*;?/i.test(cellRule),
    '.tr-sticky th must use the runtime --smartq-sticky-top offset');
assert(!/top\s*:\s*48px\s*;?/i.test(stickyRules),
    'SmartQ sticky header must not keep the previous fixed 48px offset');

assert(/function\s+updateSmartqStickyTop\s*\(/.test(source),
    'SmartQ should define updateSmartqStickyTop()');
assert(/getBoundingClientRect\s*\(/.test(source),
    'SmartQ sticky offset should be derived from rendered layout geometry');
assert(/navbar-font-size-group/.test(source),
    'SmartQ should recalculate after navbar font-size controls change layout');
assert(/ResizeObserver|addEventListener\s*\(\s*['"]resize['"]/.test(source),
    'SmartQ should recalculate sticky offset when layout dimensions change');

const stickyScriptMatch = source.match(/\(function\(\)\{\s+var stickyOffsetUpdateScheduled=false;[\s\S]+?\}\)\(\);/);
assert(stickyScriptMatch, 'SmartQ sticky offset script should be present');

function runStickyOffsetScenario({ scrollContainerTop, tableInsideScrollContainer }) {
    const tableStyle = {};
    const html = {};
    const body = {};
    const scrollContainer = {
        parentElement: body,
        computedStyle: { overflowY: 'auto', overflowX: 'auto' },
        getBoundingClientRect: () => ({ top: scrollContainerTop })
    };
    const table = {
        parentElement: tableInsideScrollContainer ? scrollContainer : body,
        style: {
            setProperty: (name, value) => {
                tableStyle[name] = value;
            }
        }
    };
    const navbar = {
        computedStyle: { display: 'block', visibility: 'visible', position: 'sticky' },
        getBoundingClientRect: () => ({ top: 0, bottom: 64 })
    };

    const context = {
        document: {
            body,
            documentElement: html,
            readyState: 'complete',
            addEventListener: () => {},
            querySelectorAll: (selector) => {
                if (selector === '.sq-table') return [table];
                if (selector === '.navbar') return [navbar];
                if (selector === '.navbar,.app-content,.sq-table') return [navbar, scrollContainer, table];
                return [];
            }
        },
        window: {
            getComputedStyle: (el) => el.computedStyle || {},
            requestAnimationFrame: (callback) => callback(),
            setTimeout: (callback) => callback(),
            addEventListener: () => {}
        }
    };

    vm.runInNewContext(stickyScriptMatch[0], context);
    return tableStyle['--smartq-sticky-top'];
}

assert.strictEqual(
    runStickyOffsetScenario({ scrollContainerTop: 64, tableInsideScrollContainer: true }),
    '0px',
    'SmartQ inside .app-content should stick to the top of that scroll container'
);
assert.strictEqual(
    runStickyOffsetScenario({ scrollContainerTop: 0, tableInsideScrollContainer: false }),
    '64px',
    'SmartQ using viewport scrolling should stick below the rendered navbar'
);

console.log('ok - SmartQ sticky header offset is dynamic');
