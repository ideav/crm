// Test for issues #2296/#2298: dashboard charts can be resized from the lower-right
// corner and the resulting size is persisted in browser cookies.

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

function createCookieDocument() {
    const jar = {};
    return {
        body: {
            classList: { add() {}, remove() {} },
            style: {}
        },
        listeners: {},
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        },
        removeEventListener(type, handler) {
            if (this.listeners[type] === handler) delete this.listeners[type];
        },
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
        }
    };
}

function makeStyleEl(rect) {
    return {
        style: {},
        _rect: rect || { width: 0, height: 0 },
        _chartInstance: null,
        querySelector() { return null; },
        appendChild() {},
        getBoundingClientRect() {
            return this._rect;
        }
    };
}

function makeClassList() {
    return {
        values: {},
        add(name) { this.values[name] = true; },
        remove(name) { delete this.values[name]; },
        contains(name) { return !!this.values[name]; }
    };
}

function makePanel() {
    const chartWrap = makeStyleEl({ width: 500, height: 300 });
    const pivotWrap = makeStyleEl();
    const canvas = makeStyleEl();
    let resizeCalls = 0;
    canvas._chartInstance = {
        options: {},
        resize() { resizeCalls++; }
    };
    const panel = {
        id: 'fp42',
        dataset: { panelId: '42' },
        style: {},
        classList: makeClassList(),
        parentElement: {
            getBoundingClientRect() {
                return { width: 900, height: 600 };
            }
        },
        _els: { chartWrap, pivotWrap, canvas },
        get resizeCalls() {
            return resizeCalls;
        },
        querySelector(selector) {
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            if (selector === '.f-chart-canvas') return canvas;
            return null;
        }
    };
    const handle = {
        dataset: { vizType: 'line' },
        closest(selector) {
            return selector === '.f-panel' ? panel : null;
        }
    };
    return { panel, handle };
}

const code = `
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_CHART_RESIZE_MIN_WIDTH = 260;
var DASH_CHART_RESIZE_MIN_HEIGHT = 180;
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-77';
var dashCurrentId = null;
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
    document: createCookieDocument(),
    window: { innerWidth: 1200, innerHeight: 800 }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const { panel } = makePanel();
    ctx.dashWriteChartSizeCookie(panel, 'line', { width: 640, height: 360 });
    const stored = ctx.dashReadChartSizeCookie(panel, 'line');

    assertEqual(stored.width.value, '640', 'chart width is saved to a cookie');
    assertEqual(stored.width.unit, 'px', 'chart width cookie uses px units');
    assertEqual(stored.height.value, '360', 'chart height is saved to a cookie');
    assert(ctx.document.cookie.indexOf('dash_chart_size_dash-77_42_line=') !== -1,
        'cookie key is scoped to dashboard, panel, and chart type');
}

{
    const { panel } = makePanel();
    ctx.dashWriteChartSizeCookie(panel, 'line', { width: 620, height: 340 });
    const applied = ctx.dashApplyVizSize(panel, 'line', {
        size: {
            width: { value: '50', unit: '%' },
            height: { value: '24', unit: 'rem' }
        }
    });

    assertEqual(applied.width.value, '620', 'cookie width overrides configured chart width');
    assertEqual(panel.style.maxWidth, '620px', 'panel max width follows the saved cookie width');
    assertEqual(panel._els.chartWrap.style.height, '340px', 'chart wrapper height follows the saved cookie height');
    assertEqual(panel._els.canvas.style.height, '100%', 'canvas fills the saved chart height');
}

{
    const { panel, handle } = makePanel();
    ctx.dashStartChartResize({
        button: 0,
        currentTarget: handle,
        clientX: 100,
        clientY: 100,
        preventDefault() {}
    }, 'line');

    assert(typeof ctx.document.listeners.mousemove === 'function', 'resize starts listening for mouse movement');
    ctx.document.listeners.mousemove({
        clientX: 120,
        clientY: 140,
        preventDefault() {}
    });
    ctx.document.listeners.mouseup({ preventDefault() {} });

    assertEqual(panel.style.maxWidth, '520px', 'dragging the lower-right corner right increases width');
    assertEqual(panel._els.chartWrap.style.height, '340px', 'dragging the lower-right corner down increases height');
    assertEqual(panel._els.canvas._chartInstance.options.maintainAspectRatio, false,
        'interactive resize disables aspect ratio on the live chart');
    assert(panel.resizeCalls > 0, 'live Chart.js instance is resized after dimensions change');

    const stored = ctx.dashReadChartSizeCookie(panel, 'line');
    assertEqual(stored.width.value, '520', 'dragged width is persisted');
    assertEqual(stored.height.value, '340', 'dragged height is persisted');
}

console.log('\nissue-2296 dashboard chart resize cookies: ok');
