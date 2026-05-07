'use strict';

// Issue #2448: the general dashboard panel height setting is labeled as
// panel/chart height, and chart views apply it to the chart area rather than
// the whole panel content block.

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

function makePanel(id, activeVizType) {
    const content = { style: { minHeight: '10px', maxHeight: '20px', overflow: 'auto' } };
    const chartWrap = { style: {} };
    const canvas = { style: {} };
    const activeIcon = { dataset: { vizType: activeVizType } };
    return {
        id,
        _els: { content, chartWrap, canvas },
        querySelector(selector) {
            if (selector === '.f-panel-content') return content;
            if (selector === '.f-chart-wrap') return chartWrap;
            if (selector === '.f-chart-canvas') return canvas;
            if (selector === '.f-viz-type-icon.active') return activeIcon;
            return null;
        }
    };
}

function styleValue(el, prop) {
    return (el.style && el.style[prop]) || '';
}

const code = `
var dashModelData = {};
${extractFunction('dashAttr')}
${extractFunction('dashNormalizeIntegerInRange')}
${extractFunction('dashNormalizePanelHeight')}
${extractFunction('dashPanelHeightFromSettings')}
${extractFunction('dashIsResizableChartViz')}
${extractFunction('dashPanelActiveVizType')}
${extractFunction('dashApplyPanelHeight')}
${extractFunction('dashBuildPanelHeightHtml')}
`;

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);

assert(/if\s*\(\s*\(vizSize && vizSize\.height\)\s*\|\|\s*panelEl\._dashPanelHeightAppliesToChart\s*\)\s*options\.maintainAspectRatio = false;/.test(source),
    'chart rendering disables aspect ratio when panel/chart height constrains chart area');

{
    const html = ctx.dashBuildPanelHeightHtml({ min: 180, max: 360 });
    assert(html.includes('Высота панели / графика'),
        'general settings label mentions panel/chart height');
    assert(html.includes('name="panelHeightMin"'), 'minimum height input is still rendered');
    assert(html.includes('name="panelHeightMax"'), 'maximum height input is still rendered');
}

{
    const panel = makePanel('fp-table', 'table');
    ctx.dashModelData['fp-table'] = { settings: [{ panelHeight: { min: 220, max: 360 } }] };

    ctx.dashApplyPanelHeight(panel, 'table');

    assert.strictEqual(styleValue(panel._els.content, 'minHeight'), '220px',
        'table view applies minimum height to panel content');
    assert.strictEqual(styleValue(panel._els.content, 'maxHeight'), '360px',
        'table view applies maximum height to panel content');
    assert.strictEqual(styleValue(panel._els.content, 'overflow'), 'auto',
        'table view keeps content scrolling when maximum height is set');
    assert.strictEqual(styleValue(panel._els.chartWrap, 'minHeight'), '',
        'table view does not apply panel height to chart wrapper');
}

{
    const panel = makePanel('fp-chart', 'line');
    ctx.dashModelData['fp-chart'] = { settings: [{ panelHeight: { min: 260, max: 420 } }] };

    ctx.dashApplyPanelHeight(panel, 'line');

    assert.strictEqual(styleValue(panel._els.content, 'minHeight'), '',
        'chart view clears panel content minimum height');
    assert.strictEqual(styleValue(panel._els.content, 'maxHeight'), '',
        'chart view clears panel content maximum height');
    assert.strictEqual(styleValue(panel._els.chartWrap, 'minHeight'), '260px',
        'chart view applies minimum height to chart wrapper');
    assert.strictEqual(styleValue(panel._els.chartWrap, 'maxHeight'), '420px',
        'chart view applies maximum height to chart wrapper');
    assert.strictEqual(styleValue(panel._els.chartWrap, 'overflow'), 'auto',
        'chart view scrolls the chart wrapper when maximum height is set');
    assert.strictEqual(styleValue(panel._els.canvas, 'height'), '100%',
        'chart canvas fills the height-constrained chart wrapper');
    assert.strictEqual(panel._dashPanelHeightAppliesToChart, true,
        'chart height application is recorded for Chart.js sizing');
}

console.log('issue-2448 dashboard chart height: ok');
