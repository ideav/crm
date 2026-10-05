// #5080 — «Резок 4, а проходов 8 посчиталось» (боевое 05.10, задание 5677 / 884425,
// джамбо 918422). Оператор до первой отметки вписал в «Проходов» (#5029) плановые 4 —
// запись получила «Кол-во резок» 4 и «Счётчик кон.» 1606 − 4×300 = 406. Затем четыре
// отметки резки (#5005) прибавили к записи ещё 4: проходов 8, «Счётчик кон.» −985.
//
// Правило: проходы по записям джамбо задания — это распределение ФАКТА резки
// («Кол-во резок факт»). Отметка кладёт в активную запись свои проходы, но сумма по
// записям не уходит выше факта задания: заранее вписанные проходы уже и есть эти
// резки, второй раз их не считаем — ни в «Кол-во резок», ни в «Счётчик кон.».
//
// Run with: node experiments/atex-slitter-5080-runs-over-fact.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-slitter-4914-jumbo-tabs.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, force) {   // setBusy переключает is-busy
            var has = self.classList.contains(c);
            var want = force === undefined ? !has : !!force;
            if (want && !has) self.classList.add(c);
            if (!want && has) self.classList.remove(c);
        }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var slitter = require('../download/atex/js/slitter.js');
var Controller = slitter.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Боевая схема 82374 «Номер джамбо» (как в atex-slitter-4914) ──
var JUMBO_82374 = {
    id: '82374',
    reqs: [
        { id: '82376', val: 'Начальная длина, м' },
        { id: '791706', val: 'Счётчик нач.' },
        { id: '82378', val: 'Кол-во резок' },
        { id: '791707', val: 'Счётчик кон.' },
        { id: '82380', val: 'Конечная длина, м' },
        { id: '82382', val: 'Рабочий расход, м' },
        { id: '82384', val: 'К списанию, м' },
        { id: '82386', val: 'Брак, м' },
        { id: '791708', val: 'Брак, шт' },
        { id: '791712', val: 'Фото брака' }
    ]
};

function cutMeta() {
    return {
        id: '1078',
        reqs: [
            { id: '1164', val: 'Счётчик нач.' }, { id: '1166', val: 'Счётчик кон.' },
            { id: '1168', val: 'Погонаж факт, м' }, { id: '24305', val: 'Метраж, м' },
            { id: '657315', val: 'Кол-во резок факт' }, { id: '1161', val: 'Начато' },
            { id: '1162', val: 'В работе' }, { id: '1171', val: 'Примечания' },
            { id: '3861x', val: 'Расход сырья' },
            { id: '787042', val: 'Рабочий расход, м' }, { id: '787043', val: 'К списанию, м' },
            { id: '8458', val: 'Брак, м' }, { id: '785730', val: 'Брак, шт' },
            { id: '82', val: 'Брак, м²' }
        ]
    };
}

function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.db = 'testdb';
    c.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
    c.notify = function() {};
    c.render = function() {};
    c.post = function(path, fields) { c.posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.posts = [];
    c.createEvent = function() { return Promise.resolve({}); };
    c.syncBatchRemainder = function() { return Promise.resolve(null); };
    c.loadEvents = function() { return Promise.resolve(); };
    c.loadCuts = function() { return Promise.resolve(); };
    c.loadBatches = function() { return Promise.resolve(); };
    c.recordActualRolls = function() { return Promise.resolve(); };
    c.applyEventStatuses = function() {};
    c.advanceToNextCut = function() {};
    c.isCutLocked = function() { return false; };
    c.eventDateTime = function() { return '2026-09-24T10:00:00'; };
    c.findBatch = function() { return { id: '700', remainderM: 20000, materialId: '2086', widthMm: 300 }; };
    return c;
}

function baseCut(over) {
    var cut = {
        id: '500501', batchId: '700', status: 'В работе',
        counterStart: '20000', meterage: '0', actualRuns: '0', plannedRuns: '10', runLength: '450',
        notes: '', materialId: '2086', material: 'MR194',
        jumbos: [], jumboActive: 0
    };
    Object.keys(over || {}).forEach(function(k) { cut[k] = over[k]; });
    return cut;
}

function jumboRecord(id, no, over) {
    var rec = { id: id, jumboNo: no, counterStart: '20000', counterEnd: '',
                cutsCount: '', spent: '', writeoff: '', defectM: '', defectQty: '',
                spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: '' };
    Object.keys(over || {}).forEach(function(k) { rec[k] = over[k]; });
    return rec;
}

function setOf(posts, path) {
    var found = null;
    posts.forEach(function(p) { if (p.path === path) found = p; });
    return found;
}

var core = slitter.core;

// ── core: сколько проходов отметки кладётся в активную запись ──
assertEqual(core.jumboRunsForMark([{ cutsCount: '' }], 1, 1), 1,
    '#5080: обычная отметка — свой проход в запись');
assertEqual(core.jumboRunsForMark([{ cutsCount: 4 }], 1, 1), 0,
    '#5080: вписанные заранее 4 прохода покрывают первую отметку — ничего не прибавляется');
assertEqual(core.jumboRunsForMark([{ cutsCount: 4 }], 2, 4), 0,
    '#5080: «✓4» при вписанных 4 — ничего не прибавляется');
assertEqual(core.jumboRunsForMark([{ cutsCount: 2 }, { cutsCount: '1' }], 2, 5), 2,
    '#5080: две записи (2+1), отметка до 5 — свои 2 прохода');
assertEqual(core.jumboRunsForMark([{ cutsCount: 3 }], 2, 4), 1,
    '#5080: вписано 3, отметка до 4 — добирается только 1');
assertEqual(core.jumboRunsForMark([], 5, 7), 5,
    '#5005: записи без накопления (отметки до ввода) — свои 5, недостачу доносит завершение');

// ── боевой случай: план 4 × 300, нач. 1606, в «Проходов» вписано 4 ──
function battleCut(rec, over) {
    var cut = baseCut({ counterStart: '1606', plannedRuns: '4', runLength: '300', jumbos: [rec] });
    Object.keys(over || {}).forEach(function(k) { cut[k] = over[k]; });
    return cut;
}

(function() {
    var c = makeController();
    var rec = jumboRecord('918422', '84250904-0350', { counterStart: '1606', cutsCount: '4', counterEnd: '406' });
    c.currentCut = battleCut(rec);
    c.markPassDone(false);
    setImmediate(function() {
        var jumboSet = setOf(c.posts, '_m_set/918422?JSON');
        assertEqual(jumboSet && jumboSet.fields['t82378'], 4,
            '#5080: первая отметка после вписанных 4 проходов — в записи 4, не 5');
        assertEqual(jumboSet && jumboSet.fields['t791707'], 406,
            '#5080: «Счётчик кон.» записи остаётся 406, а не −85');
        markAllCase();
    });
})();

function markAllCase() {
    var c = makeController();
    var rec = jumboRecord('918422', '84250904-0350', { counterStart: '1606', cutsCount: '4', counterEnd: '406' });
    c.currentCut = battleCut(rec, { actualRuns: '2', meterage: '600' });
    c.confirmModal = function(msg, ok) { ok(); };
    c.markPassDone(true);   // «Готово» — до 4 из 4, затем завершение (finishCut)
    setImmediate(function() {
        var finals = c.posts.filter(function(p) { return p.path === '_m_set/918422?JSON'; });
        var finalSet = finals[finals.length - 1];
        assertEqual(finalSet && finalSet.fields['t82378'], 4,
            '#5080: «Резка 4 из 4» — проходов в записи 4, не 8');
        assertEqual(finalSet && finalSet.fields['t791707'], 406,
            '#5080: «Счётчик кон.» записи 406 = 1606 − 4 × 300, не −985');
        normalCase();
    });
}

function normalCase() {
    // Без ручного ввода поведение #5005 прежнее: каждая отметка кладёт свой проход.
    var c = makeController();
    var rec = jumboRecord('918500', 'qqq', { counterStart: '1606', cutsCount: '1', counterEnd: '1306' });
    c.currentCut = battleCut(rec, { actualRuns: '1', meterage: '300' });
    c.markPassDone(false);
    setImmediate(function() {
        var jumboSet = setOf(c.posts, '_m_set/918500?JSON');
        assertEqual(jumboSet && jumboSet.fields['t82378'], 2, '#5005: вторая отметка — 2 прохода в записи');
        assertEqual(jumboSet && jumboSet.fields['t791707'], 1006, '#5005: «Счётчик кон.» 1606 − 2 × 300');
        console.log('\n' + passed + ' assertions passed');
    });
}
