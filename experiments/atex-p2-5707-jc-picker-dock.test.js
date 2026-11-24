// rules: none (defect #5707)
// Issue #5707: панель карты раскроя (#atex-jc-picker) на «Раскрое джамбо».
// Без выбранной партии — невысокая плашка (класс is-collapsed, CSS прилепляет её к низу экрана);
// партия выбрана — полная форма, панель прокручивается в вид; после записи задания — снова плашка.
'use strict';
var path = require('path');

var passed = 0, total = 0;
function assert(cond, msg, extra) {
    total++;
    if (cond) { passed++; console.log('  ✓ ' + msg); }
    else { console.log('  ✖ ' + msg + (extra ? ' — ' + extra : '')); process.exitCode = 1; }
}

function fakeEl(id) {
    var set = {};
    return {
        id: id, innerHTML: '', hidden: false, className: '', value: '', scrolled: 0,
        classList: {
            toggle: function(c, on) { if (on === undefined) on = !set[c]; if (on) set[c] = 1; else delete set[c]; return !!on; },
            add: function(c) { set[c] = 1; }, remove: function(c) { delete set[c]; },
            contains: function(c) { return !!set[c]; }
        },
        scrollIntoView: function() { this.scrolled++; },
        addEventListener: function() {}, removeEventListener: function() {}, getAttribute: function() { return ''; }
    };
}
var els = {};
Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    getElementById: function(id) { return els[id] || (els[id] = fakeEl(id)); }
} });

var api = require(path.join('..', 'download', 'atex-p2', 'js', 'jumbo-cutting.js'));

(async function() {
    var jc = new api.AtexJumboCutting(fakeEl('atex-jc-app'));
    var picker = document.getElementById('atex-jc-picker');
    var batch = { id: 'b1', no: 'Д-1', material: 'ПП', materialId: 'm1', geometry: { width: 1000, length: 4000, rest: 4000 } };
    jc.state = { batchesToCut: [batch], openJobs: [], settings: { runningWidths: [], minEdge: 0, rollLength: 2000, jobMinutes: 60 },
        tables: { jumboJob: { id: 'J', reqs: {} }, jumboStrip: { id: 'S', reqs: {} } } };
    jc.groups = [];
    jc.renderBatches = function() {};

    jc.renderPicker();
    assert(picker.classList.contains('is-collapsed'), 'партия не выбрана — панель свёрнута в плашку');

    jc.selectBatch('b1');
    assert(!picker.classList.contains('is-collapsed'), 'партия выбрана — панель раскрыта в полную форму');
    assert(picker.scrolled === 1, 'при выборе партии форма прокручивается в вид', 'scrollIntoView: ' + picker.scrolled);

    jc.client = { post: function() { return Promise.resolve({ id: 'j1' }); } };
    jc.progressUi = { open: function() { return { tick: function() {}, step: function() {}, close: function() {} }; } };
    jc.reload = function() { jc.state.batchesToCut = []; jc.renderPicker(); return Promise.resolve(); };
    await jc.create(batch, { strips: [{ format: 500, count: 2, purpose: 'в запас' }], edge: 0, length: 4000 }, 0, 60);
    assert(picker.classList.contains('is-collapsed'), 'задание записано — панель снова свёрнута');

    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
})();
