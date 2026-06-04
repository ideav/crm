/*
 * Тест чистого хелпера normalizeWinding (ideav/atex#52, подзадача D1).
 * Run: node experiments/test-issue-52D-winding.js
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

let n=0; function eq(a,b,name){ assert.strictEqual(a,b,name); n++; }
assert(typeof T.normalizeWinding === 'function', 'normalizeWinding exposed');
eq(T.normalizeWinding('IN'),'IN','IN');
eq(T.normalizeWinding(' out '),'OUT','out→OUT trim/upper');
eq(T.normalizeWinding('in'),'IN','in→IN');
eq(T.normalizeWinding(''),'','пусто');
eq(T.normalizeWinding('xxx'),'','чужое→пусто');
eq(T.normalizeWinding(null),'','null');
console.log(n+' assertions passed');
