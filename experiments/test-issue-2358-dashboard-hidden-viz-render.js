'use strict';

// Issue #2358: Chart.js visualizations rendered while a browser tab or
// dashboard sheet is hidden keep blurred/distorted canvas text after activation.

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

function makeClassList() {
    return {
        values: {},
        add(name) { this.values[name] = true; },
        remove(name) { delete this.values[name]; },
        contains(name) { return !!this.values[name]; }
    };
}

function makePanel(hidden) {
    const canvas = { style: {}, _chartInstance: null };
    const chartWrap = { style: {} };
    const tableWrap = { style: { display: '' } };
    const pivotWrap = { style: {} };

    return {
        id: 'fp2358',
        style: {},
        classList: makeClassList(),
        _hidden: hidden,
        _els: { canvas, chartWrap, tableWrap, pivotWrap },
        matches(selector) {
            return selector === '.f-panel';
        },
        querySelector(selector) {
            if (selector === '.f-chart-canvas') return canvas;
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-table-wrap') return tableWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            return null;
        },
        querySelectorAll() {
            return [];
        },
        getClientRects() {
            return this._hidden ? [] : [{ width: 600, height: 260 }];
        },
        get offsetParent() {
            return this._hidden ? null : {};
        }
    };
}

const code = `
var chartConstructs = 0;
var tableRenders = 0;
var pivotRenders = 0;
var dashModelData = {};
var CHART_COLORS = ['rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)'];

function dashCollectPanelData() {
    return { labels: ['11.08.2021'], datasets: [{ label: 'Metric', data: [42] }] };
}
function dashApplyVizSize() { return null; }
function dashEnsureChartJs(cb) { cb(); }
function dashBuildAreaDatasets(datasets) { return datasets; }
function dashBuildAreaChartOptions() { return {}; }
function dashRenderPivot() { pivotRenders++; }
function dashRenderReportTable() { tableRenders++; }
function dashEnsureTableResizeHandle() {}
function Chart(canvas, config) {
    chartConstructs++;
    this.canvas = canvas;
    this.config = config;
    this.options = config.options || {};
    this.destroyed = false;
    this.resizeCalls = 0;
    this.updateCalls = [];
    this.destroy = function() { this.destroyed = true; };
    this.resize = function() { this.resizeCalls++; };
    this.update = function(mode) { this.updateCalls.push(mode); };
}

${extractFunction('dashDocumentHidden')}
${extractFunction('dashElementHiddenForRender')}
${extractFunction('dashQueueHiddenVizRender')}
${extractFunction('dashPanelListForRoot')}
${extractFunction('dashFlushDeferredVizRenders')}
${extractFunction('dashRefreshChartInstance')}
${extractFunction('dashRefreshVisibleCharts')}
${extractFunction('dashRenderChart')}
`;

const ctx = {
    console,
    document: {
        hidden: false,
        querySelectorAll() { return []; }
    },
    window: {},
    setTimeout(fn) { fn(); }
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const panel = makePanel(true);

    ctx.dashRenderChart(panel, 'line', {}, { type: 'line' });

    assert.strictEqual(ctx.chartConstructs, 0, 'hidden panel must not create Chart.js canvas');
    assert(panel._dashDeferredViz, 'hidden chart render is queued on the panel');
    assert.strictEqual(panel._els.tableWrap.style.display, '', 'current visible content is not hidden before deferred render');

    panel._hidden = false;
    ctx.dashFlushDeferredVizRenders(panel);

    assert.strictEqual(ctx.chartConstructs, 1, 'queued chart render runs after the panel becomes visible');
    assert.strictEqual(panel._dashDeferredViz, undefined, 'queued render state is cleared after flush');
    assert.strictEqual(panel._els.tableWrap.style.display, 'none', 'table is hidden only when chart can render crisply');
    assert.strictEqual(panel._els.chartWrap.style.display, '', 'chart wrapper is shown after visible render');
}

{
    const panel = makePanel(false);
    const before = ctx.chartConstructs;
    ctx.document.hidden = true;

    ctx.dashRenderChart(panel, 'bar', { barMode: 'stacked' }, { type: 'bar' });

    assert.strictEqual(ctx.chartConstructs, before, 'document-hidden render does not create a chart');
    assert(panel._dashDeferredViz, 'document-hidden chart render is queued');
    assert.strictEqual(panel._dashDeferredViz.vizType, 'bar', 'queued render remembers the latest chart type');

    ctx.document.hidden = false;
    ctx.dashFlushDeferredVizRenders(panel);

    assert.strictEqual(ctx.chartConstructs, before + 1, 'document-hidden queued render runs when visible');
}

{
    const panel = makePanel(false);
    ctx.dashRenderChart(panel, 'line', {}, { type: 'line' });
    const chart = panel._els.canvas._chartInstance;

    ctx.dashRefreshVisibleCharts(panel);

    assert.strictEqual(chart.resizeCalls, 1, 'visible chart refresh resizes Chart.js backing store');
    assert.strictEqual(chart.updateCalls.join(','), 'none', 'visible chart refresh updates without animation');
}

console.log('issue-2358 dashboard hidden visualization render: ok');
