// #5037 — слитая плашка заказа читается однозначно.
//
// Живой случай — заказ 5547: два задания одного заказа (05:13 — 594 шт, не
// упаковано; 01:00 — 918 шт, упаковано) на одной плашке. Путало три вещи:
//   • упакованная строка выглядела так же, как неупакованная (у неё просто не было
//     кнопки) — теперь у неё метка «упаковано», строка приглушена;
//   • у последней неупакованной позиции было две одинаковые кнопки «Упаковано»
//     (строковая и карточная пишут одно и то же) — строковая не рисуется, пока
//     неупакованная позиция на плашке одна;
//   • номера джамбо двух заданий шли одной строкой («Z41316, Z41321, Z41321 — 95 шт»)
//     — у заданий с разным временем они идут группами «05:13: … · 01:00: …», а
//     одинаковые номера внутри задания схлопываются (количества складываются).
//
// Run with: node experiments/atex-packer-5037-merged-card-clarity.test.js

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
// 05:13 — не упаковано, 594 шт; 01:00 — упаковано, 918 шт.
function order5547() {
    return [
        item({}),
        item({ task: '1790557200', task_id: 'T0100', gp_id: 'g2', qty_fact: '918', packed: '918' })
    ];
}
var STATS_5547 = {
    T0513: [{ no: 'Z41316', cuts: 0, defect: 0 }, { no: 'Z41321', cuts: 0, defect: 0 }],
    T0100: [{ no: 'Z41321', cuts: 7, defect: 0 }, { no: 'Z41320', cuts: 8, defect: 0 }, { no: 'Z41318', cuts: 53, defect: 0 }]
};

function renderCard(items, stats) {
    var inst = Object.create(mod.Controller.prototype);
    inst.items = items;
    inst.sizes = [];
    inst.jumbos = {};
    inst.jumboStats = stats || {};
    return inst.renderCard(core.groupByOrder(items)[0]);
}
function lineWithQty(card, qty) {
    return card.querySelectorAll('.atex-pk-desc').filter(function(d) {
        return d.textContent.indexOf(' · ' + qty + ' шт') !== -1;
    })[0] || null;
}

// ── 1) упакованная строка слитой плашки помечена ──
section('#5037: упакованная строка — с меткой «упаковано», неупакованная — без', function() {
    var card = renderCard(order5547(), STATS_5547);
    var done = lineWithQty(card, 918);
    var open = lineWithQty(card, 594);
    assert(!!done && !!open, 'подготовка: на плашке обе строки (918 и 594)');
    assert(!!done && done.classList.contains('is-packed'), '#5037: строка 918 шт помечена как упакованная');
    var badge = done && done.querySelector('.atex-pk-line-done');
    assertEqual(badge ? badge.textContent : null, '✓ упаковано', '#5037: у строки 918 шт — метка «✓ упаковано»');
    assert(!!open && !open.classList.contains('is-packed') && !open.querySelector('.atex-pk-line-done'),
        '#5037: неупакованная строка 594 шт без метки');
});

// ── 2) одна неупакованная позиция — одна кнопка «Упаковано» ──
section('#5037: последняя неупакованная позиция — без строковой кнопки', function() {
    var card = renderCard(order5547(), STATS_5547);
    assertEqual(card.querySelectorAll('.atex-pk-btn-line').length, 0,
        '#5037: строковой кнопки нет — карточная пишет ту же позицию');
    var side = card.querySelector('.atex-pk-side');
    var cardBtns = side ? side.querySelectorAll('.atex-pk-btn').filter(function(b) { return b.textContent === 'Упаковано'; }) : [];
    assertEqual(cardBtns.length, 1, '#5037: на плашке ровно одна кнопка «Упаковано»');
});

section('#5037: две неупакованные позиции — строковые кнопки на месте (#5011)', function() {
    var items = [item({}), item({ task: '1790557200', task_id: 'T0100', gp_id: 'g2', qty_fact: '918' })];
    var card = renderCard(items, STATS_5547);
    assertEqual(card.querySelectorAll('.atex-pk-btn-line').length, 2, '#5037: у каждой из двух неупакованных строк — своя кнопка');
});

// ── 3) джамбо — по заданиям, одинаковые номера схлопнуты ──
section('#5037: джамбо слитой плашки — группами по заданиям', function() {
    assertEqual(core.jumboPlateText(order5547(), STATS_5547),
        '05:13: Z41316, Z41321 · 01:00: Z41321 — 95 шт, Z41320 — 108 шт, Z41318 — 716 шт',
        '#5037: номера каждого задания — под его временем');
    var card = renderCard(order5547(), STATS_5547);
    var value = card.querySelector('.atex-pk-jumbo');
    assert(!!value && value.textContent.indexOf('05:13: Z41316, Z41321 · 01:00: Z41321 — 95 шт') !== -1,
        '#5037: плашка «Джамбо» на карточке — та же группировка');
});

section('#5037: одинаковый номер в задании — одной записью, количества сложены', function() {
    var one = [item({ task_id: 'T1', qty_fact: '150' })];
    assertEqual(core.jumboPlateText(one, { T1: [
        { no: 'Z41321', cuts: 3, defect: 0 }, { no: 'Z41320', cuts: 8, defect: 0 }, { no: 'Z41321', cuts: 4, defect: 0 }
    ] }), 'Z41321 — 70 шт, Z41320 — 80 шт', '#5037: Z41321 из двух записей — одной строкой 70 шт');
    assertEqual(core.jumboPlateText(one, { T1: [
        { no: 'Z41321', cuts: 0, defect: 0 }, { no: 'Z41321', cuts: 0, defect: 0 }
    ] }), 'Z41321', '#5037: без количеств повтор номера не печатается');
});

section('#5037: одиночное задание и задания с одним временем — без групп', function() {
    var one = [item({ task_id: 'T1', qty_fact: '150' })];
    assertEqual(core.jumboPlateText(one, { T1: [{ no: 'Z1', cuts: 5, defect: 0 }, { no: 'Z2', cuts: 10, defect: 0 }] }),
        'Z1 — 50 шт, Z2 — 100 шт', '#5037: одно задание — без префикса времени');
    var same = [item({ task_id: 'A', gp_id: 'a' }), item({ task_id: 'B', gp_id: 'b', cut_width: '64.00' })];
    assertEqual(core.jumboPlateText(same, { A: [{ no: 'Z1', cuts: 0 }], B: [{ no: 'Z2', cuts: 0 }] }),
        'Z1, Z2', '#5037: у заданий одно время — метка времени ничего не различает, строка плоская');
});

console.log('\n' + passed + '/' + total + ' assertions passed');
