/**
 * Regression test for issue #2142.
 *
 * SmartQ headers inside .app-content must stick to the top edge of the
 * scrollport, not below the scroll container padding.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const templatePath = path.join(__dirname, '..', 'templates', 'smartq.html');
const source = fs.readFileSync(templatePath, 'utf8');
const stickyScriptMatch = source.match(/\(function\(\)\{\s+var stickyOffsetUpdateScheduled=false;[\s\S]+?\}\)\(\);/);

assert(stickyScriptMatch, 'SmartQ sticky offset script should be present');

function runStickyOffsetScenario({ scrollContainerTop, scrollContainerPaddingTop, tableInsideScrollContainer }) {
    const tableStyle = {};
    const html = {};
    const body = {};
    const scrollContainer = {
        parentElement: body,
        computedStyle: {
            overflowY: 'auto',
            overflowX: 'auto',
            paddingTop: scrollContainerPaddingTop
        },
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
    runStickyOffsetScenario({
        scrollContainerTop: 64,
        scrollContainerPaddingTop: '12px',
        tableInsideScrollContainer: true
    }),
    '-12px',
    'SmartQ inside padded .app-content should not leave a padding-sized sticky gap'
);

assert.strictEqual(
    runStickyOffsetScenario({
        scrollContainerTop: 0,
        scrollContainerPaddingTop: '12px',
        tableInsideScrollContainer: true
    }),
    '52px',
    'SmartQ inside a padded container under an overlapping navbar should subtract container padding'
);

console.log('ok - SmartQ sticky header accounts for scroll container padding');
