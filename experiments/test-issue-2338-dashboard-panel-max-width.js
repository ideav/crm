// Test for issue #2338: legacy dashboard panel max-width settings still apply
// when present in saved settings. Issue #2428 removes the modal controls.

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

function createStyleEl() {
    return {
        style: {},
        querySelector() {
            return null;
        }
    };
}

function makePanel() {
    const tableWrap = createStyleEl();
    const chartWrap = createStyleEl();
    const pivotWrap = createStyleEl();
    const canvas = createStyleEl();
    const panel = {
        id: 'fp42',
        style: {},
        _els: { tableWrap, chartWrap, pivotWrap, canvas },
        querySelector(selector) {
            if (selector === '.f-table-wrap') return tableWrap;
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            if (selector === '.f-chart-canvas') return canvas;
            return null;
        }
    };
    return panel;
}

const code = `
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_PANEL_MAX_WIDTH_UNITS = ['%', 'px'];
var DASH_PANEL_MAX_WIDTH_MOBILE_BREAKPOINT = 767;
var DASH_CHART_RESIZE_MIN_WIDTH = 260;
var DASH_CHART_RESIZE_MIN_HEIGHT = 180;
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-test';
var dashCurrentId = null;
var dashModelData = {};
${extractFunction('dashAttr')}
${extractFunction('dashNormalizeVizSizeValue')}
${extractFunction('dashNormalizeVizSizeUnit')}
${extractFunction('dashNormalizeVizSizeDimension')}
${extractFunction('dashNormalizeVizSize')}
${extractFunction('dashVizSizeCss')}
${extractFunction('dashNormalizePanelMaxWidthUnit')}
${extractFunction('dashNormalizePanelMaxWidthDimension')}
${extractFunction('dashNormalizePanelMaxWidth')}
${extractFunction('dashPanelMaxWidthFromSettings')}
${extractFunction('dashPanelMaxWidthDevice')}
${extractFunction('dashPanelMaxWidthForPanel')}
${extractFunction('dashPanelMaxWidthCss')}
${extractFunction('dashCombineMaxWidthCss')}
${extractFunction('dashApplyPanelMaxWidth')}
function dashApplyPanelLayout(panelEl) { dashApplyPanelMaxWidth(panelEl); }
${extractFunction('dashResetVizSizeStyles')}
${extractFunction('dashIsResizableChartViz')}
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashChartSizeCookieName')}
${extractFunction('dashReadChartSizeCookie')}
${extractFunction('dashWriteChartSizeCookie')}
${extractFunction('dashMergeVizSize')}
${extractFunction('dashResolveVizSize')}
${extractFunction('dashApplyVizSizeStyles')}
${extractFunction('dashResizeChartInstance')}
${extractFunction('dashApplyChartPixelSize')}
${extractFunction('dashChartResizeMaxWidth')}
${extractFunction('dashChartResizeMaxHeight')}
${extractFunction('dashClampChartSize')}
${extractFunction('dashStartChartResize')}
${extractFunction('dashEnsureChartResizeHandle')}
${extractFunction('dashApplyVizSize')}
`;

const ctx = {
    console,
    document: {},
    window: { innerWidth: 1200 }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const maxWidth = ctx.dashNormalizePanelMaxWidth({
        desktop: { value: '960', unit: 'px' },
        mobile: { value: '100', unit: '%' }
    });
    assertEqual(maxWidth.desktop.value, '960', 'desktop max-width value is normalized');
    assertEqual(maxWidth.desktop.unit, 'px', 'desktop max-width uses px');
    assertEqual(maxWidth.mobile.value, '100', 'mobile max-width value is normalized');
    assertEqual(maxWidth.mobile.unit, '%', 'mobile max-width uses percent');

    const invalid = ctx.dashNormalizePanelMaxWidth({
        desktop: { value: '18', unit: 'rem' },
        mobile: { value: '-1', unit: 'px' }
    });
    assert(!invalid, 'invalid panel max-width values are omitted');
}

{
    const panel = makePanel();
    ctx.window.innerWidth = 1200;
    ctx.dashModelData.fp42 = {
        settings: [
            { type: 'line', size: { width: { value: '640', unit: 'px' } } },
            { panelMaxWidth: { desktop: { value: '80', unit: '%' }, mobile: { value: '100', unit: '%' } } }
        ]
    };

    ctx.dashApplyVizSize(panel, 'line', {
        size: { width: { value: '640', unit: 'px' } }
    });
    assertEqual(panel.style.maxWidth, 'min(640px, 80%)',
        'desktop panel max-width caps configured chart width');

    ctx.window.innerWidth = 480;
    ctx.dashApplyPanelMaxWidth(panel);
    assertEqual(panel.style.maxWidth, 'min(640px, 100%)',
        'mobile panel max-width is applied at mobile viewport width');
}

{
    const panel = makePanel();
    ctx.window.innerWidth = 1200;
    ctx.dashModelData.fp42 = {
        settings: [
            { panelMaxWidth: { desktop: { value: '960', unit: 'px' }, mobile: { value: '100', unit: '%' } } }
        ]
    };
    ctx.dashApplyPanelMaxWidth(panel);
    assertEqual(panel.style.maxWidth, '960px',
        'panel max-width applies even when no visualization width is configured');
}

console.log('\nissue-2338 dashboard panel max-width settings: ok');
