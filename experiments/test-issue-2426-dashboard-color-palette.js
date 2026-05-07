// Issue #2426: dashboard panels can define a custom chart color palette.
// Run with: node experiments/test-issue-2426-dashboard-color-palette.js

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

function assertDeepEqual(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

const code = `
var CHART_COLORS = [
    'rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)', 'rgba(255,206,86,0.7)',
    'rgba(75,192,192,0.7)', 'rgba(153,102,255,0.7)', 'rgba(255,159,64,0.7)',
    'rgba(99,255,132,0.7)', 'rgba(235,54,162,0.7)'
];
var DASH_GENERAL_AXIS_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right'];
var DASH_GENERAL_X_ROTATIONS = [0, 45, 90];
var DASH_GENERAL_TOOLTIP_DECIMALS = [0, 1, 2, 3];
${extractFunction('dashAttr')}
${extractFunction('dashNormalizePositiveNumber')}
${extractFunction('dashNormalizeEnum')}
${extractFunction('dashBrowserSupportsColor')}
${extractFunction('dashNormalizeColorToken')}
${extractFunction('dashNormalizeColorPalette')}
${extractFunction('dashColorPaletteToText')}
${extractFunction('dashNormalizeGeneralSettings')}
${extractFunction('dashChartPaletteFromGeneral')}
${extractFunction('dashChartColor')}
${extractFunction('dashColorWithAlpha')}
${extractFunction('dashNormalizeAreaMode')}
${extractFunction('dashNormalizePercentDatasets')}
${extractFunction('dashBuildAreaDatasets')}
${extractFunction('dashBuildSelectOptions')}
${extractFunction('dashBuildPanelGeneralHtml')}
${extractFunction('dashCollectPanelGeneral')}
`;

const ctx = {
    console,
    CSS: {
        supports(prop, value) {
            return prop === 'color' && ['cyan', 'red', 'rebeccapurple'].indexOf(String(value).toLowerCase()) !== -1;
        }
    },
    document: {}
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

{
    const palette = ctx.dashNormalizeColorPalette('#1B50F3, cyan, A4B9FA');
    assertDeepEqual(palette, ['#1B50F3', 'cyan', '#A4B9FA'], 'palette parses comma-separated hex and CSS names');
    assertEqual(ctx.dashColorPaletteToText(palette), '#1B50F3, cyan, #A4B9FA', 'palette renders back to editable text');
}

{
    const palette = ctx.dashNormalizeColorPalette(' bad(), #12, red, 071233 ');
    assertDeepEqual(palette, ['red', '#071233'], 'invalid colors are ignored while valid entries remain');
}

{
    const general = ctx.dashNormalizeGeneralSettings({ colorPalette: '#1B50F3, cyan, A4B9FA' });
    assertDeepEqual(general.colorPalette, ['#1B50F3', 'cyan', '#A4B9FA'], 'general settings persist normalized palette');
    assertEqual(ctx.dashChartColor(ctx.dashChartPaletteFromGeneral(general), 3), '#1B50F3', 'chart color helper cycles custom palette');
}

{
    assertEqual(ctx.dashColorWithAlpha('#A4B9FA', 0.3), 'rgba(164,185,250,0.3)', 'hex colors can be made translucent for area fills');
    assertEqual(ctx.dashColorWithAlpha('rgba(54,162,235,0.7)', 0.3), 'rgba(54,162,235,0.3)', 'rgba alpha is replaced for area fills');
}

{
    const area = ctx.dashBuildAreaDatasets([
        { label: 'A', data: [1, 2] },
        { label: 'B', data: [3, 4] }
    ], {}, ['#1B50F3', '#A4B9FA']);
    assertEqual(area[0].borderColor, '#1B50F3', 'area chart uses first custom palette color');
    assertEqual(area[0].backgroundColor, 'rgba(27,80,243,0.3)', 'area chart uses translucent first custom color');
    assertEqual(area[1].borderColor, '#A4B9FA', 'area chart uses second custom palette color');
}

{
    const html = ctx.dashBuildPanelGeneralHtml({ colorPalette: ['#1B50F3', 'cyan', '#A4B9FA'] });
    assert(html.indexOf('name="generalColorPalette"') !== -1, 'general settings HTML includes palette input');
    assert(html.indexOf('value="#1B50F3, cyan, #A4B9FA"') !== -1, 'palette input value is rendered');
}

{
    const inputs = {
        '[name="generalBarThickness"]': { value: '' },
        '[name="generalAxisFontSize"]': { value: '' },
        '[name="generalLegendFontSize"]': { value: '' },
        '[name="generalLegendPosition"]': { value: '' },
        '[name="generalYMaxTicksLimit"]': { value: '' },
        '[name="generalYStepSize"]': { value: '' },
        '[name="generalXLabelRotation"]': { value: '' },
        '[name="generalXLabelAutoSkip"]': { checked: false },
        '[name="generalTooltipDecimals"]': { value: '' },
        '[name="generalTooltipPrefix"]': { value: '' },
        '[name="generalTooltipSuffix"]': { value: '' },
        '[name="generalColorPalette"]': { value: '#1B50F3, cyan, A4B9FA' }
    };
    const container = {
        querySelector(selector) { return inputs[selector] || null; }
    };
    ctx.document = { getElementById(id) { return id === 'dash-panel-general-settings' ? container : null; } };
    const collected = ctx.dashCollectPanelGeneral();
    assertDeepEqual(collected.colorPalette, ['#1B50F3', 'cyan', '#A4B9FA'], 'palette is collected from the modal field');
}

console.log('\nissue-2426 dashboard color palette: ok');
