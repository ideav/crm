// #5041 — упаковщику вес коробки с заказанным количеством.
//
// В отчёт `packers` добавлена колонка `pack_kg` («Заказанное количество -> Вес»).
// На слитой плашке после количества строки (.atex-pk-desc-qty) в скобках идёт
// вес: «· 594 шт (3.562 кг)». Веса нет — скобок нет.
//
// Run with: node experiments/atex-packer-5041-pack-weight.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-packer-5011-per-position-pack.test.js) ──
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
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) {
    var classes = sel.split('.').filter(Boolean);
    return this._all([]).filter(function(n) {
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
function section(name, fn) {
    try { fn(); } catch (e) {
        total++;
        console.log('FAIL — ' + name + ' (упало: ' + e.message + ')');
        process.exitCode = 1;
    }
}

// Строка отчёта `packer?JSON_KV` — заказ 5547 из issue.
function row(over) {
    var base = {
        task: '1790485980', task_id: 'T0513', gp_id: 'g1',
        order_no: '5547', order: '3345',
        material: 'MWR118', cut_width: '33.00', cut_length: '900.00',
        wind_direction: 'OUT', sleeve: 'Втулка пластиковая PPC-CORES черная 1" длина 1 метр', add_sleeve: 'Приклеить',
        qty: '1512', qty_fact: '594', packed: '', notes: '', events: '1', art: '00006960'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}
function item(over) { return core.itemFromReportRow(row(over)); }

function renderCard(items, stats) {
    var inst = Object.create(mod.Controller.prototype);
    inst.items = items;
    inst.sizes = [];
    inst.jumbos = {};
    inst.jumboStats = stats || {};
    return inst.renderCard(core.groupByOrder(items)[0]);
}
function descQty(card) {
    return card.querySelectorAll('.atex-pk-desc-qty').map(function(n) { return n.textContent; });
}

section('#5041: pack_kg читается в позицию', function() {
    assertEqual(item({ pack_kg: '3.562' }).packKg, '3.562', 'вес из отчёта');
    assertEqual(item({ pack_kg: '3.5620' }).packKg, '3.562', 'хвостовые нули не показываются');
    assertEqual(item({ pack_kg: '' }).packKg, '', 'пустой вес — пусто');
    assertEqual(item({}).packKg, '', 'колонки нет — пусто');
    assertEqual(item({ pack_kg: '0' }).packKg, '', 'нулевой вес — как отсутствие');
});

section('#5041: вес в скобках после количества строки', function() {
    var card = renderCard([
        item({ pack_kg: '3.562' }),
        item({ task: '1790557200', task_id: 'T0100', gp_id: 'g2', qty_fact: '918', packed: '918', cut_width: '64.00', pack_kg: '5,5' })
    ]);
    assertEqual(descQty(card), [' · 594 шт (3.562 кг)', ' · 918 шт (5.5 кг)'], 'у каждой строки — свой вес');
});

section('#5041: веса нет — скобок нет', function() {
    var card = renderCard([
        item({}),
        item({ task: '1790557200', task_id: 'T0100', gp_id: 'g2', qty_fact: '918', packed: '918', cut_width: '64.00', pack_kg: '4' })
    ]);
    assertEqual(descQty(card), [' · 594 шт', ' · 918 шт (4 кг)'], 'пустой вес — только штуки');
});

section('#5041: одинаковые строки с разным весом не схлопываются', function() {
    var card = renderCard([
        item({ gp_id: 'a', pack_kg: '1' }),
        item({ gp_id: 'b', pack_kg: '2' })
    ]);
    assertEqual(descQty(card), [' · 594 шт (1 кг)', ' · 594 шт (2 кг)'], 'вес входит в ключ повтора');
});

function descKg(card) {
    return card.querySelectorAll('.atex-pk-desc-kg').map(function(n) { return n.textContent; });
}

section('#5041: одиночная позиция — вес в строке описания', function() {
    var card = renderCard([item({ pack_kg: '3.562' })]);
    assertEqual(descQty(card), [], 'подготовка: у одиночной позиции нет количества в строке');
    assertEqual(descKg(card), [' (3.562 кг)'], 'вес в скобках в конце строки');
});

section('#5041: одиночная позиция без веса — без скобок', function() {
    assertEqual(descKg(renderCard([item({})])), [], 'пусто — ничего');
    assertEqual(descKg(renderCard([item({ pack_kg: '0' })])), [], 'ноль — ничего');
});

section('#5041: слитая плашка — вес только в количестве, без второго span', function() {
    var card = renderCard([
        item({ pack_kg: '3.562' }),
        item({ task: '1790557200', task_id: 'T0100', gp_id: 'g2', qty_fact: '918', packed: '918', cut_width: '64.00', pack_kg: '4' })
    ]);
    assertEqual(descKg(card), [], 'на слитой плашке вес стоит в .atex-pk-desc-qty');
});

console.log('\n' + passed + '/' + total + ' assertions passed');
