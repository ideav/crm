// Test for issue #2412: dashboard "Варианты отображения панели" settings are
// organised into two tabs (panels and general). The general tab provides
// panel-wide chart options (bar thickness, axis font size, Y ticks, X label
// rotation, tooltip format) which are persisted alongside the maximum width
// settings and applied to chart options when supported by each chart type.

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
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_PANEL_MAX_WIDTH_UNITS = ['%', 'px'];
var DASH_PANEL_MAX_WIDTH_MOBILE_BREAKPOINT = 767;
var DASH_GENERAL_AXIS_FONT_SIZES = [10, 12, 14, 16];
var DASH_GENERAL_X_ROTATIONS = [0, 45, 90];
var DASH_GENERAL_TOOLTIP_DECIMALS = [0, 1, 2, 3];
var dashModelData = {};
${extractFunction('dashAttr')}
${extractFunction('dashNormalizeVizSizeValue')}
${extractFunction('dashNormalizeVizSizeUnit')}
${extractFunction('dashNormalizeVizSizeDimension')}
${extractFunction('dashNormalizePanelMaxWidthUnit')}
${extractFunction('dashNormalizePanelMaxWidthDimension')}
${extractFunction('dashNormalizePanelMaxWidth')}
${extractFunction('dashPanelMaxWidthFromSettings')}
${extractFunction('dashSetPanelMaxWidthInSettings')}
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

const ctx = {
    console,
    document: {},
    window: {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// Normalization tests
{
    const g = ctx.dashNormalizeGeneralSettings({
        barThickness: '40',
        axisFontSize: '14',
        yMaxTicksLimit: '5',
        yStepSize: '50',
        xLabelRotation: '45',
        xLabelAutoSkip: true,
        tooltipDecimals: '2',
        tooltipPrefix: '$',
        tooltipSuffix: ' шт.'
    });
    assert(g, 'general settings produce a non-null normalized object');
    assertEqual(g.barThickness, 40, 'barThickness normalized to number');
    assertEqual(g.axisFontSize, 14, 'axisFontSize accepts allowed value');
    assertEqual(g.yMaxTicksLimit, 5, 'yMaxTicksLimit normalized to integer');
    assertEqual(g.yStepSize, 50, 'yStepSize accepts positive number');
    assertEqual(g.xLabelRotation, 45, 'xLabelRotation accepts allowed value');
    assertEqual(g.xLabelAutoSkip, true, 'xLabelAutoSkip is preserved');
    assertEqual(g.tooltipDecimals, 2, 'tooltipDecimals accepts allowed value');
    assertEqual(g.tooltipPrefix, '$', 'tooltipPrefix preserved');
    assertEqual(g.tooltipSuffix, ' шт.', 'tooltipSuffix preserved');

    const empty = ctx.dashNormalizeGeneralSettings({});
    assert(empty === null, 'empty object normalizes to null');

    const invalid = ctx.dashNormalizeGeneralSettings({
        barThickness: '-5',
        axisFontSize: '7',
        yMaxTicksLimit: 'abc',
        xLabelRotation: '37'
    });
    assert(invalid === null, 'invalid values are rejected');
}

// Settings round-trip
{
    let settings = [{ type: 'line' }];
    settings = ctx.dashSetGeneralSettingsInSettings(settings, { barThickness: '60', axisFontSize: '12' });
    const general = ctx.dashGeneralSettingsFromSettings(settings);
    assert(general, 'general settings entry is found in settings array');
    assertEqual(general.barThickness, 60, 'general settings barThickness stored');
    assertEqual(general.axisFontSize, 12, 'general settings axisFontSize stored');

    // Replacing existing general settings
    settings = ctx.dashSetGeneralSettingsInSettings(settings, { tooltipDecimals: '1' });
    const replaced = ctx.dashGeneralSettingsFromSettings(settings);
    assertEqual(replaced.tooltipDecimals, 1, 'general settings can be replaced');
    assert(!('barThickness' in replaced), 'old general fields are not retained when replaced');

    // Preserves existing non-general entries
    const types = settings.map(function(entry) { return entry.type || (entry.general ? 'general' : 'other'); });
    assert(types.indexOf('line') !== -1, 'visualization entries preserved when general settings change');
}

// Tooltip formatting
{
    const general = { tooltipDecimals: 2, tooltipPrefix: '$', tooltipSuffix: '' };
    assertEqual(ctx.dashFormatTooltipValue(1500000.5555, general), '$1500000.56', 'tooltip value uses decimals + prefix');

    const percent = { tooltipDecimals: 1, tooltipSuffix: '%' };
    assertEqual(ctx.dashFormatTooltipValue(25.333333, percent), '25.3%', 'tooltip percent format applied');

    assertEqual(ctx.dashFormatTooltipValue(10, null), null, 'no formatter when no general settings');
}

// Bar thickness applied to dataset
{
    const dataset = ctx.dashApplyGeneralBarDataset({ data: [1, 2, 3] }, { barThickness: 80 });
    assertEqual(dataset.barThickness, 80, 'barThickness applied to dataset');
    assertEqual(dataset.maxBarThickness, 80, 'maxBarThickness applied to dataset');
}

// Chart options for axis settings (bar)
{
    const opts = ctx.dashApplyGeneralChartOptions({}, 'bar', {
        axisFontSize: 14,
        yMaxTicksLimit: 5,
        yStepSize: 100,
        xLabelRotation: 45,
        xLabelAutoSkip: true
    });
    assertEqual(opts.scales.x.ticks.font.size, 14, 'X axis font size set on bar chart');
    assertEqual(opts.scales.y.ticks.font.size, 14, 'Y axis font size set on bar chart');
    assertEqual(opts.scales.y.ticks.maxTicksLimit, 5, 'Y maxTicksLimit applied');
    assertEqual(opts.scales.y.ticks.stepSize, 100, 'Y stepSize applied');
    assertEqual(opts.scales.x.ticks.maxRotation, 45, 'X maxRotation applied');
    assertEqual(opts.scales.x.ticks.minRotation, 45, 'X minRotation applied');
    assertEqual(opts.scales.x.ticks.autoSkip, true, 'X autoSkip applied');
}

// Pie chart should not gain axis options (charts without axes)
{
    const opts = ctx.dashApplyGeneralChartOptions({}, 'pie', { axisFontSize: 14, yStepSize: 50 });
    assert(!opts.scales || !opts.scales.x, 'pie chart does not get x axis font size');
}

// Tooltip callback wired up
{
    const opts = ctx.dashApplyGeneralChartOptions({}, 'line', { tooltipDecimals: 1, tooltipPrefix: '$' });
    assert(opts.plugins && opts.plugins.tooltip && opts.plugins.tooltip.callbacks
        && typeof opts.plugins.tooltip.callbacks.label === 'function',
        'tooltip label callback installed when tooltip options provided');
    const label = opts.plugins.tooltip.callbacks.label({
        parsed: { y: 12.345 },
        dataset: { label: 'Sales' }
    });
    assertEqual(label, 'Sales: $12.3', 'tooltip callback formats label + value');
}

// Existing options preserved when applying general settings
{
    const initial = { plugins: { legend: { position: 'right' } } };
    const opts = ctx.dashApplyGeneralChartOptions(initial, 'pie', { tooltipDecimals: 0 });
    assertEqual(opts.plugins.legend.position, 'right', 'preserves existing plugin config');
}

// HTML builder produces all expected fields
{
    const html = ctx.dashBuildPanelGeneralHtml({
        barThickness: 40,
        axisFontSize: 12,
        yMaxTicksLimit: 5,
        yStepSize: 10,
        xLabelRotation: 45,
        xLabelAutoSkip: true,
        tooltipDecimals: 1,
        tooltipPrefix: '$',
        tooltipSuffix: '%'
    });
    [
        'generalBarThickness',
        'generalAxisFontSize',
        'generalYMaxTicksLimit',
        'generalYStepSize',
        'generalXLabelRotation',
        'generalXLabelAutoSkip',
        'generalTooltipDecimals',
        'generalTooltipPrefix',
        'generalTooltipSuffix'
    ].forEach(function(name) {
        assert(html.indexOf('name="' + name + '"') !== -1, 'general settings HTML includes ' + name);
    });
    assert(html.indexOf('value="40"') !== -1, 'barThickness value rendered');
    assert(html.indexOf('value="12" selected') !== -1, 'axisFontSize selected option rendered');
    assert(html.indexOf('value="45" selected') !== -1, 'xLabelRotation selected option rendered');
    assert(html.indexOf('checked') !== -1, 'xLabelAutoSkip checkbox checked');
}

// Collect panel general from a fake DOM
{
    const inputs = {
        '[name="generalBarThickness"]': { value: '60' },
        '[name="generalAxisFontSize"]': { value: '14' },
        '[name="generalYMaxTicksLimit"]': { value: '4' },
        '[name="generalYStepSize"]': { value: '25' },
        '[name="generalXLabelRotation"]': { value: '90' },
        '[name="generalXLabelAutoSkip"]': { checked: true },
        '[name="generalTooltipDecimals"]': { value: '2' },
        '[name="generalTooltipPrefix"]': { value: 'USD ' },
        '[name="generalTooltipSuffix"]': { value: '' }
    };
    const container = {
        querySelector(selector) { return inputs[selector] || null; }
    };
    ctx.document = { getElementById(id) { return id === 'dash-panel-general-settings' ? container : null; } };
    const collected = ctx.dashCollectPanelGeneral();
    assertEqual(collected.barThickness, 60, 'bar thickness collected');
    assertEqual(collected.axisFontSize, 14, 'axis font size collected');
    assertEqual(collected.yMaxTicksLimit, 4, 'y ticks limit collected');
    assertEqual(collected.yStepSize, 25, 'y step size collected');
    assertEqual(collected.xLabelRotation, 90, 'x label rotation collected');
    assertEqual(collected.xLabelAutoSkip, true, 'x label auto skip collected');
    assertEqual(collected.tooltipDecimals, 2, 'tooltip decimals collected');
    assertEqual(collected.tooltipPrefix, 'USD ', 'tooltip prefix collected');
    assert(!('tooltipSuffix' in collected), 'empty tooltip suffix omitted');
}

// dashCollectPanelGeneral returns null when nothing is configured
{
    const inputs = {
        '[name="generalBarThickness"]': { value: '' },
        '[name="generalAxisFontSize"]': { value: '' },
        '[name="generalYMaxTicksLimit"]': { value: '' },
        '[name="generalYStepSize"]': { value: '' },
        '[name="generalXLabelRotation"]': { value: '' },
        '[name="generalXLabelAutoSkip"]': { checked: false },
        '[name="generalTooltipDecimals"]': { value: '' },
        '[name="generalTooltipPrefix"]': { value: '' },
        '[name="generalTooltipSuffix"]': { value: '' }
    };
    const container = {
        querySelector(selector) { return inputs[selector] || null; }
    };
    ctx.document = { getElementById(id) { return id === 'dash-panel-general-settings' ? container : null; } };
    const collected = ctx.dashCollectPanelGeneral();
    assert(collected === null, 'returns null when no general settings configured');
}

console.log('\nissue-2412 dashboard general settings: ok');
