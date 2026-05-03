// Test for issue #2336: dashboard tables can be resized from the lower-right
// corner like charts, and the resulting size is persisted in browser cookies.

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

function makeClassList() {
    return {
        values: {},
        add(name) { this.values[name] = true; },
        remove(name) { delete this.values[name]; },
        contains(name) { return !!this.values[name]; }
    };
}

function createCookieDocument() {
    const jar = {};
    const doc = {
        body: {
            classList: makeClassList(),
            style: {}
        },
        listeners: {},
        addEventListener(type, handler) {
            this.listeners[type] = handler;
        },
        removeEventListener(type, handler) {
            if (this.listeners[type] === handler) delete this.listeners[type];
        },
        createElement(tagName) {
            return {
                tagName,
                type: '',
                className: '',
                title: '',
                dataset: {},
                style: {},
                parentElement: null,
                listeners: {},
                setAttribute(name, value) {
                    this[name] = value;
                },
                addEventListener(type, handler) {
                    this.listeners[type] = handler;
                },
                closest(selector) {
                    let node = this.parentElement;
                    while (node) {
                        if (selector === '.f-panel' && node._isPanel) return node;
                        node = node.parentElement;
                    }
                    return null;
                }
            };
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
    return doc;
}

function makeStyleEl(rect) {
    return {
        style: {},
        children: [],
        parentElement: null,
        _rect: rect || { width: 0, height: 0 },
        offsetWidth: rect ? rect.width : 0,
        offsetHeight: rect ? rect.height : 0,
        _chartInstance: null,
        querySelector(selector) {
            if (selector.charAt(0) !== '.') return null;
            const className = selector.slice(1);
            return this.children.find(child => String(child.className || '').split(/\s+/).indexOf(className) !== -1) || null;
        },
        appendChild(child) {
            child.parentElement = this;
            this.children.push(child);
        },
        getBoundingClientRect() {
            return this._rect;
        }
    };
}

function makePanel() {
    const tableWrap = makeStyleEl({ width: 480, height: 220 });
    const chartWrap = makeStyleEl({ width: 500, height: 300 });
    const pivotWrap = makeStyleEl();
    const canvas = makeStyleEl();
    const panel = {
        _isPanel: true,
        id: 'fp42',
        dataset: { panelId: '42' },
        style: {},
        classList: makeClassList(),
        parentElement: {
            getBoundingClientRect() {
                return { width: 900, height: 600 };
            }
        },
        _els: { tableWrap, chartWrap, pivotWrap, canvas },
        querySelector(selector) {
            if (selector === '.f-table-wrap') return tableWrap;
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            if (selector === '.f-chart-canvas') return canvas;
            return null;
        }
    };
    tableWrap.parentElement = panel;
    chartWrap.parentElement = panel;
    pivotWrap.parentElement = panel;
    canvas.parentElement = chartWrap;
    return panel;
}

const code = `
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_PANEL_MAX_WIDTH_UNITS = ['%', 'px'];
var DASH_PANEL_MAX_WIDTH_MOBILE_BREAKPOINT = 767;
var DASH_CHART_RESIZE_MIN_WIDTH = 260;
var DASH_CHART_RESIZE_MIN_HEIGHT = 180;
var DASH_TABLE_RESIZE_MIN_WIDTH = 260;
var DASH_TABLE_RESIZE_MIN_HEIGHT = 120;
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashRecordId = 'dash-77';
var dashCurrentId = null;
var dashModelData = {};
function dashUpdateTableWrapOverflow() {}
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
${extractFunction('dashResetVizSizeStyles')}
${extractFunction('dashIsResizableChartViz')}
${extractFunction('dashCookieGet')}
${extractFunction('dashCookieSet')}
${extractFunction('dashCookieNamePart')}
${extractFunction('dashChartSizeCookieName')}
${extractFunction('dashReadChartSizeCookie')}
${extractFunction('dashWriteChartSizeCookie')}
${extractFunction('dashTableSizeCookieName')}
${extractFunction('dashReadTableSizeCookie')}
${extractFunction('dashWriteTableSizeCookie')}
${extractFunction('dashMergeVizSize')}
${extractFunction('dashResolveVizSize')}
${extractFunction('dashResolveTableSize')}
${extractFunction('dashApplyVizSizeStyles')}
${extractFunction('dashResizeChartInstance')}
${extractFunction('dashApplyChartPixelSize')}
${extractFunction('dashApplyTablePixelSize')}
${extractFunction('dashChartResizeMaxWidth')}
${extractFunction('dashChartResizeMaxHeight')}
${extractFunction('dashClampChartSize')}
${extractFunction('dashStartChartResize')}
${extractFunction('dashStartTableResize')}
${extractFunction('dashEnsureChartResizeHandle')}
${extractFunction('dashEnsureTableResizeHandle')}
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
    const panel = makePanel();
    ctx.dashWriteTableSizeCookie(panel, { width: 640, height: 260 });
    const stored = ctx.dashReadTableSizeCookie(panel);

    assertEqual(stored.width.value, '640', 'table width is saved to a cookie');
    assertEqual(stored.width.unit, 'px', 'table width cookie uses px units');
    assertEqual(stored.height.value, '260', 'table height is saved to a cookie');
    assert(ctx.document.cookie.indexOf('dash_table_size_dash-77_42=') !== -1,
        'table cookie key is scoped to dashboard and panel');
}

{
    const panel = makePanel();
    ctx.dashWriteTableSizeCookie(panel, { width: 620, height: 240 });
    const applied = ctx.dashApplyVizSize(panel, 'table', {
        size: {
            width: { value: '50', unit: '%' },
            height: { value: '18', unit: 'rem' }
        }
    });

    assertEqual(applied.width.value, '620', 'cookie width overrides configured table width');
    assertEqual(panel.style.maxWidth, '620px', 'panel max width follows the saved table width');
    assertEqual(panel._els.tableWrap.style.height, '240px', 'table wrapper height follows the saved table height');
    assert(panel._els.tableWrap.querySelector('.f-table-resize-handle'), 'table resize handle is rendered');
}

{
    const panel = makePanel();
    ctx.dashEnsureTableResizeHandle(panel);
    const handle = panel._els.tableWrap.querySelector('.f-table-resize-handle');

    assert(handle, 'table resize handle can be created for an existing table wrapper');
    assertEqual(handle.title, 'Изменить размер таблицы', 'table handle has the expected title');

    ctx.dashStartTableResize({
        button: 0,
        currentTarget: handle,
        clientX: 100,
        clientY: 100,
        preventDefault() {}
    });

    assert(typeof ctx.document.listeners.mousemove === 'function', 'table resize starts listening for mouse movement');
    ctx.document.listeners.mousemove({
        clientX: 140,
        clientY: 130,
        preventDefault() {}
    });
    ctx.document.listeners.mouseup({ preventDefault() {} });

    assertEqual(panel.style.maxWidth, '520px', 'dragging the table lower-right corner right increases width');
    assertEqual(panel._els.tableWrap.style.height, '250px', 'dragging the table lower-right corner down increases height');
    assert(!panel._els.chartWrap.style.height, 'table resize does not apply height to the chart wrapper');

    const stored = ctx.dashReadTableSizeCookie(panel);
    assertEqual(stored.width.value, '520', 'dragged table width is persisted');
    assertEqual(stored.height.value, '250', 'dragged table height is persisted');
}

console.log('\nissue-2336 dashboard table resize: ok');
