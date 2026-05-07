// Sanity tests for dashApplyCustomChartConfig & helpers added in issue #2440.
// Run with: node experiments/test_custom_options.js
//
// We extract the helper functions from js/dash.js by name so we can test the
// merge/parse logic in isolation.

var fs = require('fs');
var path = require('path');

var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'dash.js'), 'utf8');

function extractFunction(name) {
    var marker = 'function ' + name;
    var start = src.indexOf(marker);
    if (start < 0) throw new Error('Cannot find ' + name);
    // Find the matching closing brace after the body.
    var depth = 0, i = src.indexOf('{', start), inStr = false, strCh = '', escape = false;
    if (i < 0) throw new Error('No body for ' + name);
    for (; i < src.length; i++) {
        var ch = src[i];
        if (inStr) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === strCh) inStr = false;
            continue;
        }
        if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

var sandbox = { console: console };
var code = ''
    + 'var DASH_CUSTOM_OPTIONS_MAX_LENGTH = 8000;\n'
    + extractFunction('dashNormalizeCustomOptionsString') + '\n'
    + extractFunction('dashParseCustomOptions') + '\n'
    + extractFunction('dashIsPlainObject') + '\n'
    + extractFunction('dashDeepMergeOptions') + '\n'
    + extractFunction('dashResolveDatasetIndex') + '\n'
    + extractFunction('dashApplyDatasetOverride') + '\n'
    + extractFunction('dashApplyCustomChartConfig') + '\n'
    + 'module.exports = { dashParseCustomOptions: dashParseCustomOptions, dashApplyCustomChartConfig: dashApplyCustomChartConfig };\n';

var tmp = path.join(__dirname, '_extracted_custom_options.js');
fs.writeFileSync(tmp, code);
var helpers = require(tmp);
var parse = helpers.dashParseCustomOptions;
var apply = helpers.dashApplyCustomChartConfig;

var assertions = 0, failures = 0;
function eq(actual, expected, label) {
    assertions++;
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) { failures++; console.error('FAIL ' + label + '\n  expected: ' + b + '\n  actual:   ' + a); }
    else console.log('ok  ' + label);
}

eq(parse(''), null, 'empty -> null');
eq(parse('not json'), null, 'malformed -> null');
eq(parse('"just a string"'), null, 'non-object -> null');
eq(parse('[]'), null, 'array -> null');
eq(parse('{"a":1}'), { a: 1 }, 'simple object');

// Last-bar recolor case from the issue.
var cfg = {
    type: 'bar',
    data: { labels: ['A', 'B', 'C'], datasets: [{ data: [1, 2, 3], backgroundColor: '#1B50F3' }] },
    options: { plugins: { legend: { display: true } } }
};
apply(cfg, JSON.stringify({ dataset: { pointColors: { '-1': '#e53935' } } }));
eq(cfg.data.datasets[0].backgroundColor, ['#1B50F3', '#1B50F3', '#e53935'], 'pointColors recolors last bar');

// Targeting a specific dataset by negative index.
var cfg2 = {
    type: 'bar',
    data: { labels: ['x', 'y'], datasets: [
        { data: [1, 2], backgroundColor: '#1B50F3' },
        { data: [3, 4], backgroundColor: '#A4B9FA' }
    ] }
};
apply(cfg2, JSON.stringify({ datasets: { '-1': { pointColors: { '-1': '#e53935' } } } }));
eq(cfg2.data.datasets[0].backgroundColor, '#1B50F3', 'first dataset untouched');
eq(cfg2.data.datasets[1].backgroundColor, ['#A4B9FA', '#e53935'], 'last dataset last bar recolored');

// Deep merge of options.
var cfg3 = { type: 'line', data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: true, position: 'top' } } } };
apply(cfg3, JSON.stringify({ options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } }));
eq(cfg3.options.plugins.legend, { display: false, position: 'top' }, 'legend deep merged');
eq(cfg3.options.scales.y, { beginAtZero: true }, 'scales added');

// Bad JSON keeps config unchanged.
var cfg4 = { type: 'bar', data: { datasets: [{ data: [1, 2], backgroundColor: '#abc' }] }, options: {} };
var snap = JSON.stringify(cfg4);
apply(cfg4, '{not json');
eq(JSON.stringify(cfg4), snap, 'invalid JSON leaves config untouched');

// Array form of datasets.
var cfg5 = { type: 'bar', data: { datasets: [
    { data: [1, 2], backgroundColor: '#111' },
    { data: [3, 4], backgroundColor: '#222' }
] }, options: {} };
apply(cfg5, JSON.stringify({ datasets: [{ borderWidth: 2 }, { borderWidth: 4 }] }));
eq(cfg5.data.datasets[0].borderWidth, 2, 'array datasets index 0');
eq(cfg5.data.datasets[1].borderWidth, 4, 'array datasets index 1');

// pointColors with positional indexes (not just negative).
var cfg6 = { type: 'bar', data: { datasets: [{ data: [1, 2, 3], backgroundColor: '#abc' }] }, options: {} };
apply(cfg6, JSON.stringify({ dataset: { pointColors: { '0': '#111', '2': '#333' } } }));
eq(cfg6.data.datasets[0].backgroundColor, ['#111', '#abc', '#333'], 'positional pointColors');

fs.unlinkSync(tmp);

console.log('\n' + (assertions - failures) + '/' + assertions + ' passed');
if (failures) process.exit(1);
