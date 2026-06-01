/*
 * Тест ядра подбора «Тип резки» при вводе заказа (ideav/atex#52, подзадача C).
 * Чистая функция matchCutTypes(index, materialId, width) — без DOM/сети.
 * Run: node experiments/test-issue-52C-cuttype-suggest.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const scriptPath = path.join(__dirname, '..', 'download', 'atex', 'js', 'orders.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {
    window: {}, document: { readyState: 'loading', addEventListener: function(){}, getElementById: function(){ return null; } },
    console, URLSearchParams, URL, setTimeout, clearTimeout,
    fetch: function(){ throw new Error('fetch should not be called by helper tests'); }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
vm.runInNewContext(source, sandbox, { filename: scriptPath });
const T = sandbox.window.AtexOrdersTesting;
assert(T && typeof T.matchCutTypes === 'function', 'matchCutTypes exposed');

const index = {
    '10': { materialId: '1', widths: [110] },
    '11': { materialId: '1', widths: [60, 40] },
    '12': { materialId: '2', widths: [110] },
    '13': { materialId: '1' }
};
let n = 0;
function eq(a, b, name){ assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, name); n++; }

eq(T.matchCutTypes(index, '', '').sort(), ['10','11','12','13'], 'no material → all');
eq(T.matchCutTypes(index, '1', '').sort(), ['10','11','13'], 'material only');
eq(T.matchCutTypes(index, '1', '110'), ['10'], 'material + width 110');
eq(T.matchCutTypes(index, '1', '60'), ['11'], 'combo strip matches');
eq(T.matchCutTypes(index, '1', '999'), [], 'no width match');
eq(T.matchCutTypes(index, '1', '70'), [], 'unloaded widths excluded when width set');
eq(T.matchCutTypes(index, '1', ' 110 '), ['10'], 'width tolerant parse');

// findReqIndex — чистый хелпер поиска индекса колонки по имени реквизита.
assert(typeof T.findReqIndex === 'function', 'findReqIndex exposed');
var fMeta = { id: '104', reqs: [{ id: '1025', val: 'Вид сырья' }, { id: '1027', val: 'Ширина входа, мм' }] };
assert.strictEqual(T.findReqIndex(fMeta, 'Вид сырья'), 1, 'findReqIndex known req → 1'); n++;
assert.strictEqual(T.findReqIndex(fMeta, 'нет'), -1, 'findReqIndex unknown req → -1'); n++;
assert.strictEqual(T.findReqIndex(null, 'x'), -1, 'findReqIndex null meta → -1'); n++;

console.log(n + ' assertions passed');
