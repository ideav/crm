// Test for issue #2284: dashboard visualization variants support optional
// width/height limits with %, px, and rem units.

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
    return { style: {}, _chartInstance: null };
}

function makePanel() {
    const chartWrap = createStyleEl();
    const pivotWrap = createStyleEl();
    const tableWrap = createStyleEl();
    const canvas = createStyleEl();
    const panel = {
        style: {},
        classList: {
            add() {},
            remove() {}
        },
        _els: { chartWrap, pivotWrap, tableWrap, canvas },
        querySelector(selector) {
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            if (selector === '.f-table-wrap') return tableWrap;
            if (selector === '.f-chart-canvas') return canvas;
            if (selector === 'h4') return { textContent: 'Панель' };
            return null;
        }
    };
    return panel;
}

function makeSizeItem() {
    const fieldSelect = { name: 'barMode', value: 'stacked' };
    const nodes = {
        '.dash-viz-check': { checked: true },
        '.dash-viz-default': { checked: true },
        '[name="sizeWidthValue"]': { value: '50' },
        '[name="sizeWidthUnit"]': { value: '%' },
        '[name="sizeHeightValue"]': { value: '24' },
        '[name="sizeHeightUnit"]': { value: 'rem' }
    };
    return {
        dataset: { vizType: 'bar' },
        querySelector(selector) {
            return nodes[selector] || null;
        },
        querySelectorAll(selector) {
            if (selector === '.dash-viz-fieldmap .dash-viz-field-select') return [fieldSelect];
            return [];
        }
    };
}

const code = `
var CHART_COLORS = ['rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)'];
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
function dashCollectPanelData(panelEl) {
    return { labels: ['Январь'], datasets: [{ label: 'План', data: [12] }] };
}
function dashEnsureChartJs(cb) { cb(); }
function dashRenderPivot() {}
function Chart(canvas, config) {
    Chart.lastConfig = config;
    canvas._chartInstance = { destroy: function() { Chart.destroyed = true; } };
}
${extractFunction('dashNormalizeVizSizeValue')}
${extractFunction('dashNormalizeVizSizeUnit')}
${extractFunction('dashNormalizeVizSizeDimension')}
${extractFunction('dashNormalizeVizSize')}
${extractFunction('dashVizSizeCss')}
${extractFunction('dashResetVizSizeStyles')}
${extractFunction('dashApplyVizSize')}
${extractFunction('dashCollectVizSizeDimension')}
${extractFunction('dashCollectVizSize')}
${extractFunction('dashVizModalCollectSettings')}
${extractFunction('dashRenderChart')}
`;

const ctx = { console, document: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const size = ctx.dashNormalizeVizSize({
        width: { value: '50', unit: '%' },
        height: { value: '24,5', unit: 'rem' }
    });
    assertEqual(size.width.value, '50', 'width value is normalized');
    assertEqual(size.width.unit, '%', 'width unit % is preserved');
    assertEqual(size.height.value, '24.5', 'height decimal comma is normalized');
    assertEqual(size.height.unit, 'rem', 'height unit rem is preserved');
}

{
    const size = ctx.dashNormalizeVizSize({
        width: { value: '-10', unit: 'vh' },
        height: { value: '320', unit: 'px' }
    });
    assert(!size.width, 'invalid width is omitted');
    assertEqual(size.height.value, '320', 'valid height is kept');
    assertEqual(size.height.unit, 'px', 'height unit px is kept');
}

{
    const item = makeSizeItem();
    const accordion = {
        querySelectorAll(selector) {
            if (selector === '.dash-viz-accordion-item') return [item];
            return [];
        }
    };
    ctx.document = {
        getElementById(id) {
            return id === 'dash-viz-accordion' ? accordion : null;
        }
    };
    const settings = ctx.dashVizModalCollectSettings();
    assertEqual(settings.length, 1, 'checked visualization is collected');
    assertEqual(settings[0].type, 'bar', 'visualization type is stored');
    assertEqual(settings[0].fieldMap.barMode, 'stacked', 'field map keeps chart-specific settings');
    assert(!settings[0].fieldMap.sizeWidthUnit, 'size unit is not mixed into fieldMap');
    assertEqual(settings[0].size.width.value, '50', 'width setting is collected');
    assertEqual(settings[0].size.width.unit, '%', 'width unit is collected');
    assertEqual(settings[0].size.height.value, '24', 'height setting is collected');
    assertEqual(settings[0].size.height.unit, 'rem', 'height unit is collected');
    assert(settings[0].default === true, 'default flag is preserved');
}

{
    const panel = makePanel();
    ctx.dashApplyVizSize(panel, 'line', {
        size: {
            width: { value: '480', unit: 'px' },
            height: { value: '18', unit: 'rem' }
        }
    });
    assertEqual(panel.style.flex, '0 1 480px', 'panel flex basis follows configured width');
    assertEqual(panel.style.maxWidth, '480px', 'panel max width is limited');
    assertEqual(panel._els.chartWrap.style.height, '18rem', 'chart wrapper height is applied');
    assertEqual(panel._els.canvas.style.height, '100%', 'canvas fills configured chart height');

    ctx.dashApplyVizSize(panel, 'table', {});
    assertEqual(panel.style.flex, '', 'table mode clears panel flex override');
    assertEqual(panel._els.chartWrap.style.height, '', 'table mode clears chart height');
}

{
    const panel = makePanel();
    ctx.dashRenderChart(panel, 'line', {}, { size: { height: { value: '320', unit: 'px' } } });
    assertEqual(ctx.Chart.lastConfig.options.maintainAspectRatio, false,
        'chart rendering disables aspect ratio when explicit height is configured');
    assertEqual(panel._els.chartWrap.style.height, '320px', 'rendered chart receives configured height');
}

console.log('\nissue-2284 dashboard visualization size settings: ok');
