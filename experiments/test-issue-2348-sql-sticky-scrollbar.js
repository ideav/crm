const fs = require('fs');
const path = require('path');
const vm = require('vm');

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'sql.html'), 'utf8');

assert(
    template.includes('id="ShowReportStickyScrollbar"'),
    'sql.html should render a sticky horizontal scrollbar for #ShowReport'
);
assert(
    template.includes('id="ShowReportStickyScrollbarContent"'),
    'sticky scrollbar should include an inner content element for width syncing'
);
assert(
    /#ShowReport\s*\{[^}]*overflow-x:\s*auto;/.test(template),
    '#ShowReport should be the horizontal scroll container'
);

const helperSource = [
    extractFunction(template, 'scheduleShowReportScrollbarUpdate'),
    extractFunction(template, 'updateShowReportScrollbar'),
    extractFunction(template, 'handleShowReportScrollbarWindowScroll'),
    extractFunction(template, 'attachShowReportScrollbar')
].join('\n\n');

const listeners = {
    report: {},
    scrollbar: {},
    window: []
};

let reportRect = {
    top: 120,
    bottom: 1400,
    left: 40,
    width: 520
};

const table = {
    scrollWidth: 1280
};
const report = {
    clientWidth: 520,
    scrollWidth: 1280,
    scrollLeft: 0,
    querySelector(selector) {
        return selector === 'table' ? table : null;
    },
    getBoundingClientRect() {
        return reportRect;
    },
    addEventListener(type, callback) {
        listeners.report[type] = callback;
    }
};
const stickyScrollbar = {
    style: {},
    scrollLeft: 0,
    addEventListener(type, callback) {
        listeners.scrollbar[type] = callback;
    }
};
const stickyContent = {
    style: {}
};

const context = {
    Math,
    byId(id) {
        if (id === 'ShowReport') return report;
        if (id === 'ShowReportStickyScrollbar') return stickyScrollbar;
        if (id === 'ShowReportStickyScrollbarContent') return stickyContent;
        return null;
    },
    window: {
        innerHeight: 700,
        innerWidth: 900,
        addEventListener(type, callback, capture) {
            listeners.window.push({ type, callback, capture });
        },
        requestAnimationFrame(callback) {
            callback();
        }
    },
    showReportScrollbarAttached: false,
    showReportScrollbarSyncing: false
};

vm.createContext(context);
vm.runInContext(helperSource, context);

context.attachShowReportScrollbar();

assert(stickyScrollbar.style.display === 'block', 'sticky scrollbar should show while the report bottom is below the viewport');
assert(stickyContent.style.width === '1280px', 'sticky scrollbar content width should match the report scroll width');
assert(stickyScrollbar.style.left === '40px', 'sticky scrollbar should align with the report left edge');
assert(stickyScrollbar.style.width === '520px', 'sticky scrollbar should match the visible report width');

report.scrollLeft = 240;
listeners.report.scroll();
assert(stickyScrollbar.scrollLeft === 240, 'scrolling #ShowReport should move the sticky scrollbar');

stickyScrollbar.scrollLeft = 360;
listeners.scrollbar.scroll();
assert(report.scrollLeft === 360, 'scrolling the sticky scrollbar should move #ShowReport');

report.scrollLeft = 0;
stickyScrollbar.scrollLeft = 0;
stickyScrollbar.scrollLeft = 480;
listeners.window.find(listener => listener.type === 'scroll' && listener.capture === true).callback({ target: stickyScrollbar });
listeners.scrollbar.scroll();
assert(
    report.scrollLeft === 480,
    'dragging the sticky scrollbar should not be reset by the captured window scroll listener'
);

reportRect = {
    top: 120,
    bottom: 620,
    left: 40,
    width: 520
};
context.updateShowReportScrollbar();
assert(stickyScrollbar.style.display === 'none', 'sticky scrollbar should hide when the native scrollbar is visible');

reportRect = {
    top: 120,
    bottom: 1400,
    left: 40,
    width: 520
};
report.scrollWidth = 500;
table.scrollWidth = 500;
context.updateShowReportScrollbar();
assert(stickyScrollbar.style.display === 'none', 'sticky scrollbar should hide when there is no horizontal overflow');

assert(
    listeners.window.some(listener => listener.type === 'scroll' && listener.capture === true),
    'sticky scrollbar should update when the page or app scroll container scrolls'
);
assert(
    listeners.window.some(listener => listener.type === 'resize'),
    'sticky scrollbar should update when the viewport is resized'
);

console.log('issue 2348 sql sticky scrollbar test passed');

function extractFunction(source, name) {
    const start = source.indexOf('function ' + name + '(');
    if (start === -1) {
        throw new Error(name + ' function was not found');
    }

    const openBrace = source.indexOf('{', start);
    if (openBrace === -1) {
        throw new Error(name + ' function body was not found');
    }

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) {
            return source.slice(start, i + 1);
        }
    }

    throw new Error(name + ' function body was not closed');
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}
