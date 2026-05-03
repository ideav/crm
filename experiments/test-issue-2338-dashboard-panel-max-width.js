// Test for issue #2338: dashboard visualization settings persist and apply a
// panel-wide responsive max-width for desktop and mobile.

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

function makeWidthControlDocument() {
    const accordion = {
        querySelectorAll(selector) {
            if (selector === '.dash-viz-accordion-item') return [];
            return [];
        }
    };
    const maxWidthControls = {
        '[name="panelMaxWidthDesktopValue"]': { value: '960' },
        '[name="panelMaxWidthDesktopUnit"]': { value: 'px' },
        '[name="panelMaxWidthMobileValue"]': { value: '100' },
        '[name="panelMaxWidthMobileUnit"]': { value: '%' }
    };
    const maxWidthEl = {
        querySelector(selector) {
            return maxWidthControls[selector] || null;
        }
    };
    return {
        getElementById(id) {
            if (id === 'dash-viz-accordion') return accordion;
            if (id === 'dash-panel-max-width-settings') return maxWidthEl;
            return null;
        }
    };
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
${extractFunction('dashSetPanelMaxWidthInSettings')}
${extractFunction('dashBuildPanelMaxWidthUnitOptions')}
${extractFunction('dashBuildPanelMaxWidthRow')}
${extractFunction('dashBuildPanelMaxWidthHtml')}
${extractFunction('dashCollectPanelMaxWidthDimension')}
${extractFunction('dashCollectPanelMaxWidth')}
${extractFunction('dashPanelMaxWidthDevice')}
${extractFunction('dashPanelMaxWidthForPanel')}
${extractFunction('dashPanelMaxWidthCss')}
${extractFunction('dashCombineMaxWidthCss')}
${extractFunction('dashApplyPanelMaxWidth')}
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
${extractFunction('dashCollectVizSizeDimension')}
${extractFunction('dashCollectVizSize')}
${extractFunction('dashCollectVizSelectedRows')}
${extractFunction('dashVizModalCollectSettings')}
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
    const html = ctx.dashBuildPanelMaxWidthHtml({
        desktop: { value: '960', unit: 'px' },
        mobile: { value: '100', unit: '%' }
    });
    assert(html.indexOf('panelMaxWidthDesktopValue') !== -1, 'desktop max-width control is rendered');
    assert(html.indexOf('panelMaxWidthMobileValue') !== -1, 'mobile max-width control is rendered');
    assert(html.indexOf('value="rem"') === -1, 'panel max-width unit options exclude rem');
}

{
    ctx.document = makeWidthControlDocument();
    const settings = ctx.dashVizModalCollectSettings();
    assertEqual(settings.length, 1, 'panel max-width can be saved without enabled visualizations');
    assert(!settings[0].type, 'panel max-width entry is not treated as a visualization');
    assertEqual(settings[0].panelMaxWidth.desktop.value, '960', 'desktop max-width is collected');
    assertEqual(settings[0].panelMaxWidth.mobile.unit, '%', 'mobile max-width unit is collected');
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
