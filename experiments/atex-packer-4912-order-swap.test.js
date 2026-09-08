// Tests for ideav/crm#4912 — номера в карточке упаковщика поменяны местами:
// крупно (.atex-pk-order-main) — НАШ внутренний номер заказа (order_no),
// мелко (.atex-pk-order-sub) — «Заказ клиента» (order). До #4912 было наоборот (#4688):
// крупно ставили клиентский номер, потому что он напечатан на этикетке ролика.
//
// Run with: node experiments/atex-packer-4912-order-swap.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-4394-cut-id-links.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = '';
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

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Строка отчёта `packer?JSON_KV` (как в atex-packer.test.js).
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '80.00', cut_length: '450.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '110', qty_fact: '110', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

// ── core.orderTitle: крупно внутренний, мелко клиентский (#4912) ──
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '4619', order: 'ЗК-2026/117' }))),
    { main: '4619', sub: 'ЗК-2026/117' },
    '#4912: крупно внутренний номер, клиентский — строкой ниже');
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '4619', order: '' }))),
    { main: '4619', sub: '' },
    '#4912: клиентского нет → крупно внутренний, второй строки нет');
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '', order: '  ЗК-7  ' }))),
    { main: '—', sub: 'ЗК-7' },
    '#4912: внутреннего нет → крупно прочерк, клиентский остаётся мелким');
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '', order: '' }))),
    { main: '—', sub: '' },
    '#4912: нет ни одного номера → прочерк крупно, второй строки нет');

// ── Карточка: классы соответствуют содержимому ──
(function() {
    function render(over) {
        var self = Object.create(mod.Controller.prototype);
        self.sizes = [];
        return self.renderCard(core.itemFromReportRow(row(over)));
    }

    var card = render({ order_no: '4619', order: 'ЗК-2026/117' });
    var main = card.querySelector('.atex-pk-order-main');
    var sub = card.querySelector('.atex-pk-order-sub');
    assert(!!main && main.textContent === '4619',
        '#4912: .atex-pk-order-main — наш внутренний номер');
    assert(!!sub && sub.textContent === 'ЗК-2026/117',
        '#4912: .atex-pk-order-sub — номер заказа клиента');

    var noClient = render({ order_no: '4619', order: '' });
    assertEqual(noClient.querySelectorAll('.atex-pk-order-sub').length, 0,
        '#4912: без клиентского номера узла .atex-pk-order-sub нет');
})();

console.log('\n' + passed + ' assertions passed');
