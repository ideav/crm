/*
 * Regression test for issue #3041.
 *
 * Reference fields in generated workplaces must be searchable. The Atex orders
 * workplace previously rendered Клиент / Вид сырья / Тип резки as native
 * <select> elements, which made long dictionaries difficult to use.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'download', 'atex', 'js', 'orders.js');
const stylePath = path.join(root, 'download', 'atex', 'css', 'orders.css');
const docsPath = path.join(root, 'docs', 'integram-app-workflow.md');

const source = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {
    window: {},
    document: {
        readyState: 'loading',
        addEventListener: function() {},
        getElementById: function() { return null; }
    },
    console,
    URLSearchParams,
    URL,
    setTimeout,
    clearTimeout,
    fetch: function() {
        throw new Error('fetch should not be called by helper tests');
    }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;

vm.runInNewContext(source, sandbox, { filename: scriptPath });

const helpers = sandbox.window.AtexOrdersTesting;
assert(helpers, 'AtexOrdersTesting helper API is exposed');
assert.strictEqual(typeof helpers.searchableRefSelectHtml, 'function', 'searchable reference control renderer is exposed');
assert.strictEqual(typeof helpers.filterRefOptions, 'function', 'reference option filtering helper is exposed');

const options = [
    { id: '1', text: '25мм×35 / MWR118' },
    { id: '2', text: '110мм×8 / MW308' },
    { id: '3', text: 'ООО Ромашка-Термолента #3002' }
];

const html = helpers.searchableRefSelectHtml('atex-pos-cut-8182', options, '2', 'Выберите тип резки', '1071');
assert(!html.includes('<select'), 'reference control is not rendered as a native select');
assert(html.includes('role="combobox"'), 'reference control exposes a combobox input');
assert(html.includes('type="text"'), 'reference control has a text input for searching');
assert(html.includes('autocomplete="off"'), 'browser autocomplete is disabled for the search input');
assert(html.includes('id="atex-pos-cut-8182"'), 'reference control preserves the hidden value input id used by submit handlers');
assert(html.includes('value="2"'), 'reference control preserves current selected id');
assert(html.includes('value="110мм×8 / MW308"'), 'reference search input shows current selected text');
assert(html.includes('data-ref-req-id="1071"'), 'reference control carries the requisite id for server-side q search');

assert.deepStrictEqual(
    Array.from(helpers.filterRefOptions(options, 'mw308', 10).map(function(opt) { return opt.id; })),
    ['2'],
    'local search matches option text case-insensitively'
);
assert.deepStrictEqual(
    Array.from(helpers.filterRefOptions(options, 'РОМАШКА', 10).map(function(opt) { return opt.id; })),
    ['3'],
    'local search matches Cyrillic text case-insensitively'
);
assert.deepStrictEqual(
    Array.from(helpers.filterRefOptions(options, 'm', 1).map(function(opt) { return opt.id; })),
    ['1'],
    'local search respects the visible result limit'
);

const searchUrl = helpers.buildRefOptionsUrl('atex', '1071', 'MW308', 50);
assert.strictEqual(searchUrl, '/atex/_ref_reqs/1071?JSON&LIMIT=50&q=MW308', 'reference search uses server-side q parameter');

const style = fs.readFileSync(stylePath, 'utf8');
assert(style.includes('.atex-orders-ref-select'), 'CSS styles searchable reference wrapper');
assert(style.includes('.atex-orders-ref-dropdown'), 'CSS styles searchable reference dropdown');

const docs = fs.readFileSync(docsPath, 'utf8');
assert(docs.includes('поисковый комбобокс'), 'workflow docs require searchable comboboxes for generated selects');
assert(docs.includes('_ref_reqs/{reqId}?JSON&LIMIT=50&q='), 'workflow docs mention server-side reference search');

console.log('issue-3041 atex orders searchable selects: ok');
