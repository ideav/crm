// #5017 — дефекты «N шт с джамбо X» (#5005/#5006) у упаковщика.
//  (а) старая разметка (до #5005 всё количество резок писалось в ПОСЛЕДНЮЮ запись
//      джамбо): делить по ней нельзя — ложное «qqq — 0 шт»; плашка показывает номера
//      джамбо без количеств.
//  (б) слитая плашка: фолбэк к номерам — по КАЖДОМУ заданию, а не только когда не
//      посчиталось ни одно.
//  (в) одно задание на несколько заказов: брак джамбо делится между карточками в
//      доле факта, сумма по карточкам = факт − брак (брак учтён один раз).
//
// Run with: node experiments/atex-packer-5017-jumbo-qty-fixes.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-packer-4910-jumbo-line.test.js) ──
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
        qty: '80', qty_fact: '80', packed: '', notes: '', events: '1',
        tipo: '62-83 Х 330/450', tipo_id: '671017',
        art: '0011332'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

function render(items, jumbos, stats, allItems) {
    var self = Object.create(mod.Controller.prototype);
    self.jumbos = jumbos || {};
    self.jumboStats = stats || {};
    self.items = allItems || items;
    self.applyJumbos();
    var card = self.renderCard(items.length === 1 ? items[0] : { items: items, orderNo: items[0].orderNo });
    var plaque = card.querySelectorAll('.atex-pk-jumbo')[0];
    var value = plaque ? plaque.querySelectorAll('.atex-pk-art-value')[0] : null;
    return value ? value.textContent : null;
}

// ── (а) старая разметка: всё количество в последней записи ──
(function() {
    var old = { '666355': [{ no: 'qqq', cuts: 0, defect: 0 }, { no: 'www', cuts: 10, defect: 0 }] };
    var items = [core.itemFromReportRow(row({}))];
    var lines = core.jumboQtyLines(items, old);
    assert(!lines.some(function(l) { return / 0 шт$/.test(l); }),
        '(а) старая разметка: нет ложного «0 шт» — ' + JSON.stringify(lines));
    assertEqual(render(items, { '666355': ['qqq', 'www'] }, old), 'qqq, www',
        '(а) старая разметка: плашка — номера джамбо без количеств');
    var oldEmpty = { '666355': [{ no: 'qqq', cuts: '', defect: 0 }, { no: 'J2', cuts: 0, defect: 0 }, { no: 'www', cuts: 10, defect: 0 }] };
    assertEqual(render(items, { '666355': ['qqq', 'J2', 'www'] }, oldEmpty), 'qqq, J2, www',
        '(а) старая разметка из трёх записей (пусто/0/всё) — номера без количеств');
    // Новая разметка с одним джамбо — по-прежнему считается.
    assertEqual(core.jumboQtyLines(items, { '666355': [{ no: 'qqq', cuts: 10, defect: 2 }] }),
        ['qqq — 78 шт'], '(а) одно джамбо — считается как раньше');
})();

// ── (б) слитая плашка из двух заданий, у одного нет факта ──
(function() {
    var a = core.itemFromReportRow(row({ task_id: '666355', gp_id: 'a', qty_fact: '80' }));
    var b = core.itemFromReportRow(row({ task_id: '777777', gp_id: 'b', qty_fact: '' }));
    var stats = {
        '666355': [{ no: 'qqq', cuts: 5, defect: 1 }, { no: 'www', cuts: 5, defect: 3 }],
        '777777': [{ no: 'J-9', cuts: 10, defect: 0 }]
    };
    var text = render([a, b], { '666355': ['qqq', 'www'], '777777': ['J-9'] }, stats);
    assertEqual(text, 'qqq — 39 шт, www — 37 шт, J-9',
        '(б) номера джамбо обоих заданий: у задания без факта — без количества');
    var c = core.itemFromReportRow(row({ task_id: '888888', gp_id: 'c', qty_fact: '50' }));
    assertEqual(render([a, c], { '666355': ['qqq', 'www'], '888888': ['Z-1', 'Z-2'] }, stats),
        'qqq — 39 шт, www — 37 шт, Z-1, Z-2',
        '(б) у второго задания нет записей в task_jumbo — его номера из task_jumbo-списка');
})();

// ── (в) одно задание на два заказа, брак джамбо учтён один раз ──
(function() {
    var o1 = core.itemFromReportRow(row({ gp_id: 'g1', order_no: '4619', qty_fact: '40' }));
    var o2 = core.itemFromReportRow(row({ gp_id: 'g2', order_no: '4620', qty_fact: '40' }));
    var stats = { '666355': [{ no: 'qqq', cuts: 5, defect: 2 }, { no: 'www', cuts: 5, defect: 4 }] };
    var all = [o1, o2];
    function total(lines) {
        return lines.reduce(function(s, l) { return s + Number(/— (\d+) шт/.exec(l)[1]); }, 0);
    }
    var l1 = core.jumboQtyLines([o1], stats, all);
    var l2 = core.jumboQtyLines([o2], stats, all);
    assertEqual(total(l1) + total(l2), 80 - 6,
        '(в) сумма по карточкам = факт 80 − брак 6: ' + JSON.stringify(l1) + ' + ' + JSON.stringify(l2));
    assertEqual(l1, ['qqq — 19 шт', 'www — 18 шт'], '(в) карточка заказа 4619: брак в доле факта');
    assertEqual(render([o1], { '666355': ['qqq', 'www'] }, stats, all), 'qqq — 19 шт, www — 18 шт',
        '(в) плашка карточки делит брак с другим заказом задания');
})();

console.log('\n' + passed + ' assertions passed');
