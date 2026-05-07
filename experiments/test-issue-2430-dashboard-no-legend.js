// Test for issue #2430: the dashboard "Общие настройки" legend position
// selector must offer "Без легенды" and persist/apply it by hiding Chart.js
// legends.

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('js/dash.js', 'utf8');

function extractVar(name) {
    const re = new RegExp('var\\s+' + name + '\\s*=\\s*[^;]+;');
    const match = source.match(re);
    if (!match) throw new Error('Missing var ' + name);
    return match[0];
}

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
${extractVar('DASH_GENERAL_AXIS_FONT_SIZES')}
${extractVar('DASH_GENERAL_LEGEND_FONT_SIZES')}
${extractVar('DASH_GENERAL_LEGEND_POSITIONS')}
${extractVar('DASH_GENERAL_X_ROTATIONS')}
${extractVar('DASH_GENERAL_TOOLTIP_DECIMALS')}
${extractFunction('dashAttr')}
${extractFunction('dashNormalizePositiveNumber')}
${extractFunction('dashNormalizeEnum')}
${extractFunction('dashBrowserSupportsColor')}
${extractFunction('dashNormalizeColorToken')}
${extractFunction('dashNormalizeColorPalette')}
${extractFunction('dashColorPaletteToText')}
${extractFunction('dashNormalizeGeneralSettings')}
${extractFunction('dashApplyGeneralChartOptions')}
${extractFunction('dashBuildSelectOptions')}
${extractFunction('dashBuildPanelGeneralHtml')}
${extractFunction('dashCollectPanelGeneral')}
`;

const ctx = { console, document: {}, window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

assert(ctx.DASH_GENERAL_LEGEND_POSITIONS.indexOf('none') !== -1, 'legend position enum includes none');

{
    const g = ctx.dashNormalizeGeneralSettings({ legendPosition: 'none' });
    assert(g, 'no-legend position normalizes to a general settings object');
    assertEqual(g.legendPosition, 'none', 'legendPosition none is persisted');
}

{
    const opts = ctx.dashApplyGeneralChartOptions({ plugins: { legend: { position: 'right' } } }, 'pie', { legendPosition: 'none' });
    assertEqual(opts.plugins.legend.display, false, 'legendPosition none hides the legend');
}

{
    const html = ctx.dashBuildPanelGeneralHtml({ legendPosition: 'none' });
    assert(html.indexOf('name="generalLegendPosition"') !== -1, 'HTML has legend position select');
    assert(html.indexOf('value="none" selected') !== -1, 'no-legend option is selected when saved');
    assert(html.indexOf('>Без легенды</option>') !== -1, 'no-legend option has the requested label');
}

{
    const inputs = {
        '[name="generalLegendPosition"]': { value: 'none' }
    };
    const container = {
        querySelector(selector) { return inputs[selector] || { value: '', checked: false }; }
    };
    ctx.document = { getElementById(id) { return id === 'dash-panel-general-settings' ? container : null; } };
    const collected = ctx.dashCollectPanelGeneral();
    assertEqual(collected.legendPosition, 'none', 'collector reads no-legend selection');
}

console.log('\nissue-2430 dashboard no legend: ok');
