// #5082 — «Не получается закрыть заказ в РМ slitter» (боевое 05.10, Станок 3, задание
// 894619, MR194, партия 74926 с «Остаток, м» −3450). У задания «Счётчик нач.» пуст, а
// оператор уже завёл запись джамбо и вписал её «Счётчик нач.» (запись 918676, 88888):
// с #5010 поле на пульте при сохранённой записи правит запись, а не задание. Отметка
// брала начало только из задания, иначе из остатка партии — партия в минусе, отказ
// «Заполните «Счётчик нач.»», и так по кругу: поле заполнено, а отметка его не видит.
//
// Правило: пустое начало задания берётся из «Счётчик нач.» активной записи джамбо, если
// он задан; только записи нет — из «Остатка, м» партии. Партия в минусе (#5075) этому
// не мешает: резать с неё оператору не запрещено.
//
// Run with: node experiments/atex-slitter-5082-start-from-jumbo.test.js

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
var notices = [];
function battleController() {
    var c = makeController();
    c.notify = function(msg, kind) { notices.push({ msg: msg, kind: kind }); };
    c.findBatch = function() { return { id: '74926', remainderM: -3450, materialId: '2086', widthMm: 910 }; };
    return c;
}

// ── боевой случай: начало задания пусто, у записи 918676 «Счётчик нач.» 88888 ──
(function() {
    var c = battleController();
    var rec = jumboRecord('918676', '1111', { counterStart: '88888' });
    c.currentCut = baseCut({ id: '894619', batchId: '74926', counterStart: '', plannedRuns: '4',
                             runLength: '300', jumbos: [rec] });
    c.markPassDone(false);
    setImmediate(function() {
        assertEqual(notices.filter(function(n) { return n.kind === 'error'; }).map(function(n) { return n.msg; }), [],
            '#5082: партия в минусе, начало есть у записи джамбо — отметка без отказа');
        var cutSet = setOf(c.posts, '_m_set/894619?JSON');
        assertEqual(cutSet && String(cutSet.fields['t1164']), '88888',
            '#5082: «Счётчик нач.» задания = «Счётчик нач.» активной записи');
        assertEqual(cutSet && String(cutSet.fields['t657315']), '1', '#5082: проход отмечен — факт 1');
        var jumboSet = setOf(c.posts, '_m_set/918676?JSON');
        assertEqual(jumboSet && jumboSet.fields['t791707'], 88588,
            '#5082: «Счётчик кон.» записи 88888 − 300');
        noJumboCase();
    });
})();

function noJumboCase() {
    // Записи с началом нет, партия в минусе — отказ #4902 остаётся (взять начало неоткуда).
    notices = [];
    var c = battleController();
    c.currentCut = baseCut({ id: '894619', batchId: '74926', counterStart: '', plannedRuns: '4',
                             runLength: '300', jumbos: [jumboRecord('918676', '1111', { counterStart: '' })] });
    c.markPassDone(false);
    setImmediate(function() {
        assert(notices.some(function(n) { return n.kind === 'error' && /Счётчик нач/.test(n.msg); }),
            '#4902: начала нет ни у задания, ни у записи — просим вписать');
        assertEqual(c.posts.length, 0, '#4902: при отказе ничего не пишется');
        batchCase();
    });
}

function batchCase() {
    // Записи ещё нет — начало, как и прежде, из «Остатка, м» партии.
    notices = [];
    var c = makeController();
    c.currentCut = baseCut({ counterStart: '', jumbos: [], pendingJumbo: { jumboNo: 'J1', counterStart: '' } });
    c.markPassDone(false);
    setImmediate(function() {
        var cutSet = setOf(c.posts, '_m_set/500501?JSON');
        assertEqual(cutSet && String(cutSet.fields['t1164']), '20000','#4902: без записи начало из остатка партии');
        console.log('\n' + passed + ' assertions passed');
    });
}
