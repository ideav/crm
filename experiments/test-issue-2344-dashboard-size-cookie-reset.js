// Test for issue #2344: a dashboard sheet shows a reset icon only when
// panel width cookies exist for that sheet, and the reset clears those cookies.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

function extractFunction(name) {
    const marker = 'function ' + name + '(';
    const start = source.indexOf(marker);
    if (start === -1) throw new Error('Missing function ' + name);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error('Unclosed function ' + name);
}

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
    console.log('PASS: ' + message);
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, message + ' (expected ' + expected + ', got ' + actual + ')');
}

function makeClassList(initial) {
    const values = {};
    (initial || '').split(/\s+/).filter(Boolean).forEach(name => { values[name] = true; });
    return {
        values,
        add(name) { values[name] = true; },
        remove(name) { delete values[name]; },
        contains(name) { return !!values[name]; },
        toggle(name, force) {
            const enabled = force === undefined ? !values[name] : !!force;
            if (enabled) values[name] = true;
            else delete values[name];
            return enabled;
        }
    };
}

function createCookieDocument() {
    const jar = {};
    return {
        get cookie() {
            return Object.keys(jar).map(name => name + '=' + jar[name]).join('; ');
        },
        set cookie(value) {
            const first = String(value).split(';')[0];
            const eq = first.indexOf('=');
            const name = first.slice(0, eq);
            const val = first.slice(eq + 1);
            if (/max-age=0/i.test(value)) delete jar[name];
            else jar[name] = val;
        },
        hasCookie(name) {
            return Object.prototype.hasOwnProperty.call(jar, name);
        }
    };
}

function makeIcon() {
    const attrs = {};
    return {
        classList: makeClassList('dash-reset-size-icon'),
        disabled: false,
        tabIndex: 0,
        setAttribute(name, value) { attrs[name] = String(value); },
        getAttribute(name) { return attrs[name]; }
    };
}

function makePanel(id, panelId, vizType) {
    const activeIcon = vizType ? {
        dataset: { vizType },
        classList: makeClassList('f-viz-type-icon active')
    } : null;
    return {
        id,
        dataset: { panelId },
        querySelector(selector) {
            if (selector === '.f-viz-type-icon.active') return activeIcon;
            return null;
        }
    };
}

function makeSheet(panels, icon) {
    return {
        querySelector(selector) {
            if (selector === '.dash-reset-size-icon') return icon;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.f-panel') return panels;
            return [];
        }
    };
}

const code = `
var DASH_VIZ_TYPES = [
    { id: 'table' },
    { id: 'line' },
    { id: 'pie' },
    { id: 'bar' },
    { id: 'area' },
    { id: 'bubble' },
    { id: 'pivot' }
];
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-77';
var dashCurrentId = null;
var dashModelData = {
    fp42: { settings: [{ type: 'line', fieldMap: { labelField: 'Date' }, size: { width: { value: '50', unit: '%' } } }] },
    fp43: { settings: null }
};
var renderedPanels = [];
function dashRenderChart(panelEl, vizType, fieldMap, vizConfig) {
    renderedPanels.push({
        id: panelEl.id,
        vizType: vizType,
        fieldMap: fieldMap || {},
        vizConfig: vizConfig || {}
    });
}
function dashSetStatus(message) {
    this.lastStatus = message;
}
${extractFunction('dashNormalizeVizSizeValue')}
${extractFunction('dashNormalizeVizSizeUnit')}
${extractFunction('dashNormalizeVizSizeDimension')}
${extractFunction('dashNormalizeVizSize')}
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieRemove')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashIsResizableChartViz')}
${extractFunction('dashChartSizeCookieName')}
${extractFunction('dashReadChartSizeCookie')}
${extractFunction('dashWriteChartSizeCookie')}
${extractFunction('dashTableSizeCookieName')}
${extractFunction('dashReadTableSizeCookie')}
${extractFunction('dashWriteTableSizeCookie')}
${extractFunction('dashPanelSizeCookieNames')}
${extractFunction('dashSizeCookieExists')}
${extractFunction('dashSizeCookieHasWidth')}
${extractFunction('dashSheetSizeCookieNames')}
${extractFunction('dashSheetWidthSizeCookieNames')}
${extractFunction('dashUpdateSheetSizeResetIcon')}
${extractFunction('dashPanelActiveVizType')}
${extractFunction('dashPanelVizConfig')}
${extractFunction('dashReapplyPanelSizeWithoutCookies')}
${extractFunction('dashResetSheetSizeCookies')}
`;

const ctx = {
    console,
    document: createCookieDocument()
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const resetIcon = makeIcon();
const firstPanel = makePanel('fp42', '42', 'line');
const secondPanel = makePanel('fp43', '43', null);
const sheet = makeSheet([firstPanel, secondPanel], resetIcon);
const otherSheet = makeSheet([secondPanel], makeIcon());

ctx.dashWriteTableSizeCookie(firstPanel, { height: 240 });
const tableCookieName = ctx.dashTableSizeCookieName(firstPanel);
ctx.dashUpdateSheetSizeResetIcon(sheet);
assert(!resetIcon.classList.contains('dash-reset-size-icon--visible'), 'height-only cookies do not show the reset icon');
assert(resetIcon.disabled, 'hidden reset icon is disabled');

ctx.dashWriteChartSizeCookie(firstPanel, 'line', { width: 640, height: 260 });
ctx.dashUpdateSheetSizeResetIcon(sheet);
assert(resetIcon.classList.contains('dash-reset-size-icon--visible'), 'width cookie shows the sheet reset icon');
assert(!resetIcon.disabled, 'visible reset icon is enabled');
assertEqual(resetIcon.getAttribute('aria-hidden'), 'false', 'visible reset icon is exposed to assistive tech');

ctx.dashUpdateSheetSizeResetIcon(otherSheet);
assert(!otherSheet.querySelector('.dash-reset-size-icon').classList.contains('dash-reset-size-icon--visible'),
    'cookies from another sheet do not show that sheet reset icon');

const chartCookieName = ctx.dashChartSizeCookieName(firstPanel, 'line');
assert(ctx.document.hasCookie(chartCookieName), 'chart width cookie exists before reset');

ctx.dashResetSheetSizeCookies(sheet);
assert(!ctx.document.hasCookie(chartCookieName), 'chart width cookie is removed by reset');
assert(!ctx.document.hasCookie(tableCookieName), 'reset removes all panel size cookies from the sheet');
assert(!resetIcon.classList.contains('dash-reset-size-icon--visible'), 'reset icon hides after cookies are removed');
assert(resetIcon.disabled, 'reset icon is disabled after cookies are removed');
assertEqual(ctx.renderedPanels.length, 2, 'all panels in the sheet are re-rendered after reset');
assertEqual(ctx.renderedPanels[0].vizType, 'line', 'active chart panel is restored with its current visualization type');
assertEqual(ctx.renderedPanels[0].fieldMap.labelField, 'Date', 'active chart panel keeps saved visualization settings');
assertEqual(ctx.renderedPanels[1].vizType, 'table', 'panel without active visualization is restored as a table');

console.log('\nissue-2344 dashboard size cookie reset: ok');
