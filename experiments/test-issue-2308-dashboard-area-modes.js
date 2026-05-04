// Test for issue #2308: dashboard area charts support plain, stacked,
// and normalized stacked rendering modes.

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

function extractFunctionIfExists(name) {
    return source.indexOf('function ' + name + '(') === -1 ? '' : extractFunction(name);
}

function assert(condition, message) {
    if (!condition) throw new Error('FAIL: ' + message);
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, message + ' (expected ' + expected + ', got ' + actual + ')');
}

function makePanel() {
    const chartWrap = { style: {} };
    const pivotWrap = { style: {} };
    const tableWrap = { style: {} };
    const canvas = { style: {}, _chartInstance: null };
    return {
        classList: {
            add() {},
            remove() {}
        },
        querySelector(selector) {
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-pivot-wrap') return pivotWrap;
            if (selector === '.f-table-wrap') return tableWrap;
            if (selector === '.f-chart-canvas') return canvas;
            if (selector === 'h4') return { textContent: 'Панель' };
            return null;
        }
    };
}

const code = `
var CHART_COLORS = ['rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)'];
function dashPanelGetVizReportData() { return null; }
function dashPanelGetColumns() { return ['Январь', 'Февраль']; }
function dashPanelGetRows() { return ['План', 'Факт']; }
function dashCollectPanelData() {
    return {
        labels: ['Январь', 'Февраль'],
        datasets: [
            { label: 'План', data: [25, 60] },
            { label: 'Факт', data: [75, 40] }
        ]
    };
}
function dashApplyVizSize() { return null; }
function dashEnsureChartJs(cb) { cb(); }
function dashRenderPivot() {}
function dashElementHiddenForRender() { return false; }
function dashReportColumnIsDimension(column) { return column && column.kind !== 'measure'; }
function dashReportColumnIsMeasure(column) { return column && column.kind === 'measure'; }
function Chart(canvas, config) {
    Chart.lastConfig = config;
    canvas._chartInstance = { destroy: function() {} };
}

${extractFunction('dashAttr')}
${extractFunctionIfExists('dashNormalizeAreaMode')}
${extractFunctionIfExists('dashBuildAreaModeHtml')}
${extractFunctionIfExists('dashNormalizePercentDatasets')}
${extractFunctionIfExists('dashBuildAreaDatasets')}
${extractFunctionIfExists('dashBuildAreaChartOptions')}
${extractFunction('dashBuildFieldMapHtml')}
${extractFunction('dashBuildReportFieldOptions')}
${extractFunction('dashBuildReportFieldMapHtml')}
${extractFunction('dashRenderChart')}
`;

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const html = ctx.dashBuildFieldMapHtml('area', { areaMode: 'stacked' }, {});
    assert(html.includes('name="areaMode"'), 'plain dashboard area chart exposes area mode selector');
    assert(html.includes('value="stacked" selected'), 'plain dashboard area chart preserves selected stacked mode');
    assert(html.includes('С областями и накоплением'), 'stacked area mode label is visible');
}

{
    const report = {
        columns: [
            { id: 'month', name: 'Месяц', kind: 'dimension' },
            { id: 'value', name: 'Значение', kind: 'measure' },
            { id: 'series', name: 'Серия', kind: 'dimension' }
        ]
    };
    const html = ctx.dashBuildReportFieldMapHtml('area', {
        areaMode: 'normalized',
        labelField: 'month',
        valueField: 'value',
        seriesField: 'series'
    }, report);
    assert(html.includes('name="areaMode"'), 'report area chart exposes area mode selector');
    assert(html.includes('value="normalized" selected'), 'report area chart preserves selected normalized mode');
    assert(html.includes('name="labelField"'), 'report area chart keeps axis selector');
    assert(html.includes('name="valueField"'), 'report area chart keeps metric selector');
    assert(html.includes('name="seriesField"'), 'report area chart keeps series selector');
}

{
    const panel = makePanel();
    ctx.dashRenderChart(panel, 'area', { areaMode: 'stacked' }, {});
    const config = ctx.Chart.lastConfig;
    assertEqual(config.type, 'line', 'area chart uses Chart.js line type');
    assert(config.data.datasets.every(function(ds) { return ds.fill === true; }), 'stacked area datasets are filled');
    assertEqual(config.options.scales.y.stacked, true, 'stacked area enables y stacking');
    assertEqual(config.data.datasets[0].data[0], 25, 'stacked area keeps original values');
}

{
    const panel = makePanel();
    ctx.dashRenderChart(panel, 'area', { areaMode: 'normalized' }, {});
    const config = ctx.Chart.lastConfig;
    assertEqual(config.options.scales.y.stacked, true, 'normalized area enables y stacking');
    assertEqual(config.options.scales.y.min, 0, 'normalized area scale starts at zero');
    assertEqual(config.options.scales.y.max, 100, 'normalized area scale ends at 100');
    assertEqual(config.data.datasets[0].data[0], 25, 'normalized area converts first dataset to percent');
    assertEqual(config.data.datasets[1].data[0], 75, 'normalized area converts second dataset to percent');
    assertEqual(config.data.datasets[0].data[1], 60, 'normalized area converts each label independently');
    assertEqual(config.data.datasets[1].data[1], 40, 'normalized area keeps each label total at 100');
}

console.log('issue-2308 dashboard area modes: ok');
