// Test for issue #2421: numeric inputs in dashboard display variant
// settings use whole-number increments.

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

const code = `
var DASH_PANEL_COLUMN_BREAKPOINTS = [
    { key: 'xs', label: 'XS', range: '<576px', minWidth: 0, defaultValue: 12 },
    { key: 'sm', label: 'SM', range: '>=576px', minWidth: 576, defaultValue: 12 },
    { key: 'md', label: 'MD', range: '>=768px', minWidth: 768, defaultValue: 6 },
    { key: 'lg', label: 'LG', range: '>=992px', minWidth: 992, defaultValue: 4 },
    { key: 'xl', label: 'XL', range: '>=1200px', minWidth: 1200, defaultValue: 4 },
    { key: 'xxl', label: 'XXL', range: '>=1400px', minWidth: 1400, defaultValue: 3 }
];
var DASH_GENERAL_AXIS_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right', 'none'];
var DASH_GENERAL_X_ROTATIONS = [0, 45, 90];
var DASH_GENERAL_TOOLTIP_DECIMALS = [0, 1, 2, 3];
${extractFunction('dashAttr')}
${extractFunction('dashNormalizeIntegerInRange')}
${extractFunction('dashNormalizePanelHeight')}
${extractFunction('dashNormalizePanelColumns')}
${extractFunction('dashPanelColumnsWithDefaults')}
${extractFunction('dashBuildPanelHeightHtml')}
${extractFunction('dashBuildPanelColumnsHtml')}
${extractFunction('dashBrowserSupportsColor')}
${extractFunction('dashNormalizeColorToken')}
${extractFunction('dashNormalizeColorPalette')}
${extractFunction('dashColorPaletteToText')}
${extractFunction('dashBuildSelectOptions')}
${extractFunction('dashBuildPanelGeneralHtml')}
`;

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const html = [
    ctx.dashBuildPanelHeightHtml({ min: 240, max: 720 }),
    ctx.dashBuildPanelColumnsHtml({ md: 5, lg: 3 }),
    ctx.dashBuildPanelGeneralHtml({ yStepSize: 50 })
].join('\n');

[
    'name="panelHeightMin"',
    'name="panelHeightMax"',
    'name="panelColumnsXS"',
    'name="panelColumnsSM"',
    'name="panelColumnsMD"',
    'name="panelColumnsLG"',
    'name="panelColumnsXL"',
    'name="panelColumnsXXL"',
    'name="generalYStepSize"'
].forEach(function(nameAttr) {
    const inputMatch = html.match(new RegExp('<input[^>]*' + nameAttr + '[^>]*>'));
    assert(inputMatch, nameAttr + ' input is rendered');
    assert(inputMatch[0].indexOf('step="1"') !== -1, nameAttr + ' uses step=1');
    assert(inputMatch[0].indexOf('step="0.1"') === -1, nameAttr + ' does not use step=0.1');
});

[
    'name="sizeWidthValue"',
    'name="sizeHeightValue"',
    'name="panelMaxWidthDesktopValue"',
    'name="panelMaxWidthMobileValue"'
].forEach(function(nameAttr) {
    assert(html.indexOf(nameAttr) === -1, nameAttr + ' is not rendered in panel display settings');
});

console.log('\nissue-2421 dashboard number step: ok');
