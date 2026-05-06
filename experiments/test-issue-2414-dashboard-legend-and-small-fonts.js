// Test for issue #2414: extension of the dashboard "Общие настройки" tab
// (introduced in PR #2413) to support:
//   1. legend size and position (top/bottom in particular)
//   2. additional axis label font sizes 8 px and 9 px
//
// The added settings are persisted alongside the rest of the general
// configuration and applied to chart options for charts that expose a
// legend (Chart.js plugins.legend).

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
    assert(actual === expected, message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

const code = `
var DASH_GENERAL_AXIS_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right'];
var DASH_GENERAL_X_ROTATIONS = [0, 45, 90];
var DASH_GENERAL_TOOLTIP_DECIMALS = [0, 1, 2, 3];
${extractFunction('dashAttr')}
${extractFunction('dashNormalizePositiveNumber')}
${extractFunction('dashNormalizeIntegerInRange')}
${extractFunction('dashNormalizeEnum')}
${extractFunction('dashNormalizeGeneralSettings')}
${extractFunction('dashGeneralSettingsFromSettings')}
${extractFunction('dashSetGeneralSettingsInSettings')}
${extractFunction('dashFormatTooltipValue')}
${extractFunction('dashApplyGeneralChartOptions')}
${extractFunction('dashApplyGeneralBarDataset')}
${extractFunction('dashBuildSelectOptions')}
${extractFunction('dashBuildPanelGeneralHtml')}
${extractFunction('dashCollectPanelGeneral')}
`;

const ctx = { console, document: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

// 1. Axis font sizes 8 and 9 are accepted
{
    [8, 9, 10, 12, 14, 16].forEach(function(size) {
        const g = ctx.dashNormalizeGeneralSettings({ axisFontSize: String(size) });
        assertEqual(g && g.axisFontSize, size, 'axisFontSize accepts ' + size);
    });
    [7, 11, 18].forEach(function(size) {
        const g = ctx.dashNormalizeGeneralSettings({ axisFontSize: String(size) });
        assert(g === null, 'axisFontSize rejects ' + size);
    });
}

// 2. Legend font sizes are accepted with the same set
{
    [8, 9, 10, 12, 14, 16].forEach(function(size) {
        const g = ctx.dashNormalizeGeneralSettings({ legendFontSize: String(size) });
        assertEqual(g && g.legendFontSize, size, 'legendFontSize accepts ' + size);
    });
    [7, 11, 18].forEach(function(size) {
        const g = ctx.dashNormalizeGeneralSettings({ legendFontSize: String(size) });
        assert(g === null, 'legendFontSize rejects ' + size);
    });
}

// 3. Legend position accepts top/bottom (and left/right) but rejects unknown values
{
    ['top', 'bottom', 'left', 'right'].forEach(function(pos) {
        const g = ctx.dashNormalizeGeneralSettings({ legendPosition: pos });
        assertEqual(g && g.legendPosition, pos, 'legendPosition accepts ' + pos);
    });
    ['middle', '', 'TOP', 'auto'].forEach(function(pos) {
        const g = ctx.dashNormalizeGeneralSettings({ legendPosition: pos });
        assert(g === null, 'legendPosition rejects ' + JSON.stringify(pos));
    });
}

// 4. dashApplyGeneralChartOptions wires legend.position and legend.labels.font.size
{
    const opts = ctx.dashApplyGeneralChartOptions({}, 'bar', {
        legendPosition: 'top',
        legendFontSize: 9
    });
    assertEqual(opts.plugins.legend.position, 'top', 'legend position propagates to bar');
    assertEqual(opts.plugins.legend.labels.font.size, 9, 'legend font size propagates to bar');
}

// 5. Legend settings work for pie chart (the one with default `position: right`)
{
    // mirrors how dashRenderChart sets up pie initially
    const initial = { plugins: { legend: { position: 'right' } } };
    const opts = ctx.dashApplyGeneralChartOptions(initial, 'pie', { legendPosition: 'bottom' });
    assertEqual(opts.plugins.legend.position, 'bottom', 'pie legend overrides default position');
}

// 6. Round-trip through settings array (sentinel `{ general: {...} }`)
{
    let settings = [{ type: 'pie' }];
    settings = ctx.dashSetGeneralSettingsInSettings(settings, {
        legendPosition: 'top',
        legendFontSize: '8',
        axisFontSize: '9'
    });
    const general = ctx.dashGeneralSettingsFromSettings(settings);
    assertEqual(general.legendPosition, 'top', 'legendPosition persisted');
    assertEqual(general.legendFontSize, 8, 'legendFontSize persisted');
    assertEqual(general.axisFontSize, 9, 'axisFontSize persisted');
}

// 7. HTML builder renders legend controls
{
    const html = ctx.dashBuildPanelGeneralHtml({
        legendFontSize: 8,
        legendPosition: 'bottom'
    });
    assert(html.indexOf('name="generalLegendFontSize"') !== -1, 'HTML has legend font size select');
    assert(html.indexOf('name="generalLegendPosition"') !== -1, 'HTML has legend position select');
    assert(html.indexOf('value="8" selected') !== -1, 'legend font size 8 marked selected');
    assert(html.indexOf('value="bottom" selected') !== -1, 'legend position bottom marked selected');
    assert(html.indexOf('value="9"') !== -1, 'legend font size 9 is in select options');
    // axis font select also includes the new sizes
    assert(html.indexOf('name="generalAxisFontSize"') !== -1, 'HTML has axis font size select');
}

// 8. dashCollectPanelGeneral reads legend inputs from the modal DOM
{
    const inputs = {
        '[name="generalLegendFontSize"]': { value: '8' },
        '[name="generalLegendPosition"]': { value: 'top' }
    };
    const container = {
        querySelector(selector) { return inputs[selector] || { value: '', checked: false }; }
    };
    ctx.document = { getElementById(id) { return id === 'dash-panel-general-settings' ? container : null; } };
    const collected = ctx.dashCollectPanelGeneral();
    assertEqual(collected.legendFontSize, 8, 'collected legendFontSize');
    assertEqual(collected.legendPosition, 'top', 'collected legendPosition');
}

console.log('\nissue-2414 dashboard legend & small fonts: ok');
