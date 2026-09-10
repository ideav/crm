// #4933 — РМ слиттера, изменения по решению заказчика:
//   п.1: шапка компактнее — .atex-sl-section-head больше не рендерится (строку
//        статуса сохранения несёт строка корешков джамбо);
//   п.2: номер джамбо при смене задания НЕ подставляется из памяти по сырью —
//        оператор вводит его руками (механизм «память по сырью» удалён);
//   п.3: номер джамбо СУЩЕСТВУЮЩЕЙ записи правится и после закрытия задания:
//        номер — главное значение записи, `_m_set` его молча игнорирует
//        (docs/kb/crud.md, #4906) — правка уезжает через `_m_save/{id}` с t{82374}.
//
// Run with: node experiments/atex-slitter-4933.test.js

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
        toggle: function(c, force) {
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
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function() { return ''; }, set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() {}; StubNode.prototype.setSelectionRange = function() {};
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

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

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

function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.notify = function() {};
    return c;
}

// ── п.1: панель показаний без .atex-sl-section-head, статус — в строке корешков ──
(function() {
    var c = makeController();
    c.meta = { cut: null, jumboTable: JUMBO_82374 };
    c.currentCut = {
        id: '779317', counterStart: '12510', meterage: '620', notes: '',
        jumbos: [{ id: '791461', jumboNo: 'C200cp383941', spent: '20', writeoff: '', defectM: '', defectQty: '', counterStart: '12510', counterEnd: '' }],
        jumboActive: 0
    };
    c.loadJumboRecords = function() { return Promise.resolve(); };
    c.render = function() {};
    var readings = c.renderReadings();
    assertEqual(readings.querySelectorAll('.atex-sl-section-head').length, 0,
        'п.1: строки .atex-sl-section-head в панели показаний нет');
    var tabs = readings.querySelector('.atex-sl-jumbo-tabs');
    assert(!!(tabs && tabs.querySelector('.atex-sl-save-status')),
        'п.1: статус сохранения живёт в строке корешков джамбо');
})();

// ── п.2: номер джамбо из памяти по сырью НЕ подставляется — механизм удалён ──
(function() {
    var store = { 'atex-sl-jumbo-by-material:testdb': JSON.stringify({ '2086': { no: '102605081738', counterEnd: 1813 } }) };
    global.window.localStorage = {
        getItem: function(k) { return store[k] == null ? null : store[k]; },
        setItem: function(k, v) { store[k] = String(v); },
        removeItem: function(k) { delete store[k]; }
    };
    var c = makeController();
    c.db = 'testdb';
    c.meta = { cut: null, jumboTable: JUMBO_82374 };
    var cut = { id: '700001', counterStart: '', meterage: '', notes: '', materialId: '2086', material: 'MR194' };
    c.currentCut = cut;
    c.render = function() {};
    // Отчёт task_jumbo отвечает пусто — записей у задания нет.
    c.getJson = function() { return Promise.resolve([]); };
    c.loadJumboRecords(cut).then(function() {
        assertEqual(cut.pendingJumbo || null, null,
            'п.2: при смене задания черновик номера НЕ подставляется из localStorage');
        step2();
    });
})();

// ── п.3: правка номера существующей записи уезжает `_m_save` (не `_m_set`) ──
function step2() {
    var c = makeController();
    c.db = 'testdb';
    c.meta = { cut: null, jumboTable: JUMBO_82374 };
    var rec = {
        id: '791295', jumboNo: 'C200cp383941', savedNo: 'C200cp383941',
        spent: '20', writeoff: '', defectM: '', defectQty: '',
        counterStart: '12510', counterEnd: '',
        spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: ''
    };
    var cut = { id: '786385', status: 'Завершён', notes: '', counterStart: '12510', jumbos: [rec], jumboActive: 0 };
    c.currentCut = cut;
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };

    // Оператор поправил номер закрытого задания (поле активно) и вышел из ячейки.
    rec.jumboNo = 'C200cp999999';
    c.saveJumboValues(true);
    setImmediate(function() {
        var save = posts.filter(function(p) { return p.path.indexOf('_m_save/791295') === 0; })[0];
        assert(!!save, 'п.3: правка номера пишется через _m_save/{id}');
        assertEqual(save && save.fields['t82374'], 'C200cp999999',
            'п.3: номер уезжает ключом первой колонки t{tableId}');
        var wrongSet = posts.filter(function(p) {
            return p.path.indexOf('_m_set/') === 0 && p.fields && ('t82374' in p.fields);
        })[0];
        assertEqual(wrongSet || null, null, 'п.3: номер НЕ кладётся в _m_set (он его игнорирует)');
        step3();
    });
}

// ── п.3 (границы): номер не менялся или записи ещё нет — _m_save не зовётся ──
function step3() {
    var c = makeController();
    c.db = 'testdb';
    c.meta = { cut: null, jumboTable: JUMBO_82374 };
    var rec = {
        id: '791295', jumboNo: 'C200cp383941', savedNo: 'C200cp383941',
        spent: '20', writeoff: '', defectM: '', defectQty: '',
        counterStart: '12510', counterEnd: '',
        spentDraft: '5', writeoffDraft: '', defectMDraft: '', defectQtyDraft: ''
    };
    var cut = { id: '786385', status: 'В работе', notes: '', counterStart: '12510', jumbos: [rec], jumboActive: 0 };
    c.currentCut = cut;
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.saveJumboValues(true);
    setImmediate(function() {
        assertEqual(posts.filter(function(p) { return p.path.indexOf('_m_save/') === 0; }).length, 0,
            'п.3: номер не менялся — _m_save не зовётся');
        assert(posts.some(function(p) { return p.path.indexOf('_m_set/791295') === 0; }),
            'п.3: редактируемые поля по-прежнему уезжают _m_set');
        console.log('\n' + passed + ' / ' + total + ' assertions passed');
    });
}
