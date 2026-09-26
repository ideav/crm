// Tests for ideav/crm#5011 — «Упаковано» на каждую позицию.
//
// На слитой плашке заказа упаковка отмечается одним нажатием «Упаковано» —
// все позиции разом, а оператору нужно упаковать и ЗАПИСАТЬ позиции по отдельности
// (например, один размер готов, второй ещё режется). У каждой строки много-позиционной
// карточки появляется своя кнопка «Упаковано»: она пишет «Упаковано шт» ТОЛЬКО этой
// позиции (в её Партию ГП) её текущим количеством; карточка остаётся со статусом
// «частично», пока не упакуются остальные. У одиночной плашки своей строки-кнопки нет —
// «Упаковано» карточки и есть позиция (#4680).
//
// Run with: node experiments/atex-packer-5011-per-position-pack.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-packer-4918-order-merge.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false;
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function() { return ''; }, set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
Object.defineProperty(StubNode.prototype, 'firstChild', { get: function() { return this.childNodes[0] || null; } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) {
    var tag = /^[A-Za-z]/.test(sel) ? sel.toUpperCase() : '';
    var classes = sel.replace(/^[A-Za-z]*/, '').split('.').filter(Boolean);
    return this._all([]).filter(function(n) {
        if (tag && n.tagName !== tag) return false;
        return classes.every(function(c) { return n.classList.contains(c); });
    });
};
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/packer.js');
var core = mod.core;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Строка отчёта `packer?JSON_KV` (как в базовом atex-packer.test.js).
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MR194', cut_width: '110.00', cut_length: '74.00',
        wind_direction: 'OUT', sleeve: 'втулка картонная 0.5"', add_sleeve: '',
        qty: '2', qty_fact: '2', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function item(over) { return core.itemFromReportRow(row(over)); }
function group(list) { return core.groupByOrder(list)[0]; }

function makeController() {
    var c = new Controller(new StubNode('div'));
    c.db = 'testdb';
    c.notify = function(msg) { c.notes.push(msg); };
    c.notes = [];
    c.renderList = function() {};
    c.setBusy = function() {};
    c.meta = { gp: { id: '1081', reqs: [{ id: '673786', val: 'Упаковано шт' }, { id: '673789', val: 'Примечание' }] }, event: { id: '1082' } };
    c.post = function(path, fields) { c.posts.push({ path: path, fields: fields }); return Promise.resolve({}); };
    c.posts = [];
    c.userId = '462';
    return c;
}

// ── 1) у каждой строки много-позиционной плашки — своя кнопка «Упаковано» ──
(function() {
    var g = group([
        item({ gp_id: 'a', order_no: '4619', cut_width: '110.00', qty: '2', qty_fact: '2' }),
        item({ gp_id: 'b', order_no: '4619', cut_width: '55.00', qty: '12', qty_fact: '12' })
    ]);
    var c = makeController();
    var card = c.renderCard(g);
    var lines = card.querySelectorAll('.atex-pk-desc');
    var lineBtns = card.querySelectorAll('.atex-pk-line-pack');
    assertEqual(lines.length, 2, '#5011: плашка показывает обе позиции');
    assertEqual(lineBtns.length, 2, '#5011: у каждой строки — своя кнопка «Упаковано»');
    next();
})();

function next() {
    // ── 2) клик по строковой кнопке пишет ТОЛЬКО эту позицию её количеством ──
    (function() {
        var g = group([
            item({ gp_id: 'a', order_no: '4619', cut_width: '110.00', qty: '2', qty_fact: '2' }),
            item({ gp_id: 'b', order_no: '4619', cut_width: '55.00', qty: '12', qty_fact: '12' })
        ]);
        var c = makeController();
        c.markPacked = function(item, qty, note) {
            c.packed = { gpId: item.gpId, qty: qty, note: note };
        };
        var card = c.renderCard(g);
        var btns = card.querySelectorAll('.atex-pk-line-pack');
        btns[1].click();   // вторая позиция (55 мм, 12 шт)
        setImmediate(function() {
            assertEqual(c.packed && c.packed.gpId, 'b', '#5011: строковая кнопка пакует свою позицию');
            assertEqual(c.packed && c.packed.qty, 12, '#5011: количеством позиции (12 шт), не общей суммой');
            next2();
        });
    })();
}

function next2() {
    // ── 3) упакованная позиция: строка без кнопки, карточка живёт («частично») ──
    (function() {
        var g = group([
            item({ gp_id: 'a', order_no: '4619', cut_width: '110.00', qty: '2', qty_fact: '2', packed: '2' }),
            item({ gp_id: 'b', order_no: '4619', cut_width: '55.00', qty: '12', qty_fact: '12' })
        ]);
        var c = makeController();
        var card = c.renderCard(g);
        assertEqual(card.querySelectorAll('.atex-pk-line-pack').length, 1,
            '#5011: упакованная позиция строки-кнопки не имеет');
        assertEqual(core.orderPartial(g), true, '#5011: частичная упаковка — статус «частично»');
        assertEqual(core.orderTotal(g), 12, '#5011: бейдж карточки — остаток по неупакованным');
        next3();
    })();
}

function next3() {
    // ── 4) одиночная плашка: строковых кнопок нет ──
    (function() {
        var c = makeController();
        var card = c.renderCard(item({ gp_id: 'a', order_no: '4619', qty: '14', qty_fact: '14' }));
        assertEqual(card.querySelectorAll('.atex-pk-line-pack').length, 0,
            '#5011: у одиночной позиции строковой кнопки нет — «Упаковано» карточки (#4680)');
        console.log('\n' + passed + ' / ' + total + ' assertions passed');
    })();
}
