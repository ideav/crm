'use strict';

// Issue #2340: visualization width limits should constrain the dashboard
// panel only. The active visualization wrapper must fill that panel instead of
// receiving the same max-width again.

const assert = require('assert');
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

function makeStyleEl() {
    return {
        style: {},
        querySelector() {
            return null;
        }
    };
}

function makePanel() {
    const chartWrap = makeStyleEl();
    const tableWrap = makeStyleEl();
    const pivotWrap = makeStyleEl();
    const canvas = makeStyleEl();

    return {
        style: {},
        _els: { chartWrap, tableWrap, pivotWrap, canvas },
        querySelector(selector) {
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-table-wrap') return tableWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            if (selector === '.f-chart-canvas') return canvas;
            return null;
        }
    };
}

const code = `
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_CHART_RESIZE_MIN_WIDTH = 260;
var DASH_CHART_RESIZE_MIN_HEIGHT = 180;
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-test';
var dashCurrentId = null;
function dashApplyPanelMaxWidth() {}
function dashApplyPanelLayout(panelEl) { dashApplyPanelMaxWidth(panelEl); }
${extractFunction('dashNormalizeVizSizeValue')}
${extractFunction('dashNormalizeVizSizeUnit')}
${extractFunction('dashNormalizeVizSizeDimension')}
${extractFunction('dashNormalizeVizSize')}
${extractFunction('dashVizSizeCss')}
${extractFunction('dashResetVizSizeStyles')}
${extractFunction('dashIsResizableChartViz')}
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashChartSizeCookieName')}
${extractFunction('dashReadChartSizeCookie')}
${extractFunction('dashMergeVizSize')}
${extractFunction('dashResolveVizSize')}
${extractFunction('dashApplyVizSizeStyles')}
${extractFunction('dashEnsureChartResizeHandle')}
${extractFunction('dashApplyVizSize')}
`;

const ctx = {
    console,
    document: {},
    window: {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const panel = makePanel();
ctx.dashApplyVizSize(panel, 'line', {
    size: {
        width: { value: '50', unit: '%' },
        height: { value: '240', unit: 'px' }
    }
});

assert.strictEqual(panel.style.flex, '0 1 50%', 'configured width sets panel flex basis');
assert.strictEqual(panel.style.width, '100%', 'panel keeps full row width with flex basis');
assert.strictEqual(panel.style.maxWidth, '50%', 'configured width limits panel max width');
assert.strictEqual(panel._els.chartWrap.style.width, '', 'chart wrapper does not get duplicate width');
assert.strictEqual(panel._els.chartWrap.style.maxWidth, '', 'chart wrapper does not get duplicate max width');
assert.strictEqual(panel._els.chartWrap.style.height, '240px', 'chart height still applies to wrapper');
assert.strictEqual(panel._els.canvas.style.height, '100%', 'canvas still fills configured chart height');

console.log('issue-2340 dashboard panel width: ok');
