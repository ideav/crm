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
var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_PANEL_MAX_WIDTH_UNITS = ['%', 'px'];
var DASH_GENERAL_AXIS_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right'];
var DASH_GENERAL_X_ROTATIONS = [0, 45, 90];
var DASH_GENERAL_TOOLTIP_DECIMALS = [0, 1, 2, 3];
${extractFunction('dashAttr')}
${extractFunction('dashNormalizeVizSizeValue')}
${extractFunction('dashNormalizeVizSizeUnit')}
${extractFunction('dashNormalizeVizSizeDimension')}
${extractFunction('dashNormalizeVizSize')}
${extractFunction('dashBuildVizSizeUnitOptions')}
${extractFunction('dashBuildVizSizeRow')}
${extractFunction('dashBuildVizSizeHtml')}
${extractFunction('dashNormalizePanelMaxWidthUnit')}
${extractFunction('dashNormalizePanelMaxWidthDimension')}
${extractFunction('dashNormalizePanelMaxWidth')}
${extractFunction('dashBuildPanelMaxWidthUnitOptions')}
${extractFunction('dashBuildPanelMaxWidthRow')}
${extractFunction('dashBuildPanelMaxWidthHtml')}
${extractFunction('dashBuildSelectOptions')}
${extractFunction('dashBuildPanelGeneralHtml')}
`;

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const html = [
    ctx.dashBuildVizSizeHtml({
        width: { value: 640, unit: 'px' },
        height: { value: 360, unit: 'px' }
    }),
    ctx.dashBuildPanelMaxWidthHtml({
        desktop: { value: 960, unit: 'px' },
        mobile: { value: 100, unit: '%' }
    }),
    ctx.dashBuildPanelGeneralHtml({ yStepSize: 50 })
].join('\n');

[
    'name="sizeWidthValue"',
    'name="sizeHeightValue"',
    'name="panelMaxWidthDesktopValue"',
    'name="panelMaxWidthMobileValue"',
    'name="generalYStepSize"'
].forEach(function(nameAttr) {
    const inputMatch = html.match(new RegExp('<input[^>]*' + nameAttr + '[^>]*>'));
    assert(inputMatch, nameAttr + ' input is rendered');
    assert(inputMatch[0].indexOf('step="1"') !== -1, nameAttr + ' uses step=1');
    assert(inputMatch[0].indexOf('step="0.1"') === -1, nameAttr + ' does not use step=0.1');
});

console.log('\nissue-2421 dashboard number step: ok');
