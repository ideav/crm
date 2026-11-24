// rules: none (defect #5713)
// Issue #5713: после «Создать задание первичной резки» новое задание трудно найти — форма карты
// внизу, страница остаётся прокрученной вниз. Ожидание: страница прокручивается к началу
// рабочего места, записанное задание стоит первой строкой очереди и подсвечено зелёным (is-fresh);
// подсветка одна — у последнего записанного задания.
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

function job(id, no, start) {
    return { id: id, start: start, minutes: 90, edge: 0, created: 0, status: 'Запланировано',
        strips: [{ format: 255, count: 6 }], progress: { total: 12 },
        batch: { no: no, material: 'SG', geometry: { width: 1530 } } };
}
// Строки tbody по порядку: [id задания из кнопки «Снять», класс строки].
function rows(html) {
    var body = html.split('<tbody>')[1] || '';
    return body.split('</tr>').filter(function(s) { return s.indexOf('<tr') !== -1; }).map(function(s) {
        var cls = (s.match(/<tr class="([^"]*)"/) || [])[1] || '';
        var id = (s.match(/data-job-id="([^"]*)"/) || [])[1] || '';
        return [id, cls];
    });
}

(async function() {
    var root = fakeEl('atex-jc-app');
    var jc = new api.AtexJumboCutting(root);
    var queue = document.getElementById('atex-jc-queue');
    var batch = { id: 'b1', no: 'Д-0002', material: 'SG', materialId: 'm1', geometry: { width: 1530, length: 4000, rest: 4000 } };
    var older = job('j0', 'Д-0001', 1000);
    jc.state = { batchesToCut: [batch], openJobs: [older], settings: { runningWidths: [], minEdge: 0, rollLength: 2000, jobMinutes: 60 },
        tables: { jumboJob: { id: 'J', reqs: {} }, jumboStrip: { id: 'S', reqs: {} } } };
    jc.groups = [];

    jc.client = { post: function() { return Promise.resolve({ id: 'j1' }); } };
    jc.progressUi = { open: function() { return { tick: function() {}, step: function() {}, close: function() {} }; } };
    // reload после записи: очередь с сервера — новое задание в конце (план-старт позже).
    jc.reload = function() {
        jc.state.batchesToCut = [];
        jc.state.openJobs = [older, job('j1', 'Д-0002', 9000)];
        jc.renderQueue();
        return Promise.resolve();
    };
    await jc.create(batch, { strips: [{ format: 255, count: 6, purpose: 'дефицит' }], edge: 0, length: 4000 }, 9000, 90);

    var r = rows(queue.innerHTML);
    assert(r.length === 2, 'в очереди два задания', JSON.stringify(r));
    assert(r[0] && r[0][0] === 'j1', 'записанное задание — первой строкой очереди', JSON.stringify(r));
    assert(r[0] && /\bis-fresh\b/.test(r[0][1]), 'записанное задание подсвечено (is-fresh)', JSON.stringify(r));
    assert(r[1] && !/\bis-fresh\b/.test(r[1][1]), 'прежнее задание без подсветки', JSON.stringify(r));
    assert(root.scrolled >= 1, 'после записи страница прокручена к началу рабочего места', 'scrollIntoView корня: ' + root.scrolled);

    // Задание сняли — подсветки и особого порядка нет.
    jc.state.openJobs = [older];
    jc.renderQueue();
    r = rows(queue.innerHTML);
    assert(r.length === 1 && !/\bis-fresh\b/.test(r[0][1]), 'снятое свежее задание не оставляет подсветки', JSON.stringify(r));

    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
})();
