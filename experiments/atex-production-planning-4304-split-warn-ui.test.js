// UI smoke test for #4304 (продолжение) — красная плашка «разорвано по дням» на КАРТОЧКЕ очереди
// (поверх лёгкого DOM-стаба, как atex-production-planning-3788-ui.test.js).
//
// Проверяем ПРОВОДКУ, которую не видит чистый daySplitWarning: просрочка считается по «Дате план»
// КОНКРЕТНОГО сегмента, а разрыв — по значкам смежности дня (←/→). Данные повторяют кейс ateh
// (Станок 3): задание на 158 проходов не влезает в смену (470 мин нетто) и разрезано 22.07 → 23.07
// при сроке 22.07. Голова стоит В СРОК — красной плашки быть не должно; хвост уехал за срок — должна.
//
// Run with: node experiments/atex-production-planning-4304-split-warn-ui.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
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
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; if (this.tagName === 'SELECT' && n.tagName === 'OPTION') this.options.push(n); return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
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

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0;
function assert(cond, name) { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

// planDate резки — unix-секунды старта окна (scheduleFromStored читает его как t1078).
function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
var DUE_2207 = 20260722;   // «Срок изготовления» обеспечиваемой позиции — 22.07

// Сегмент разрезанного задания: одна конфигурация резки + один заказ = соседи по isDaySplitSibling.
function seg(id, planTs, over) {
    var c = { id: id, number: id, slitter: { id: '101', label: 'Станок 3' }, status: 'В работе',
        materialName: 'MW308', materialId: '500', winding: 'OUT', knifeWidths: [110], knifeCount: 1,
        orderId: '4242', planDate: planTs, storedCutAndLeaderMin: 448 };
    over = over || {};
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) c[k] = over[k];
    return c;
}

function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '', dateTo: '', query: '' };   // без фильтра дат — видны оба дня
    c.slitters = [{ id: '101', label: 'Станок 3' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = [];   // позиция вне активного списка → срок из обеспечения (#4051)
    c.supplies = cuts.map(function(x, i) { return { id: 's' + i, cutId: x.id, positionId: null, rolls: 0, dueKey: DUE_2207 }; });
    c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {};
    c.renderLink = function() {};
    return c;
}

// Плашка карточки: ищем среди узлов между этой и следующей карточкой .atex-pp-cut.
function warnOfCard(queueEl, cutId) {
    var card = queueEl._all([]).filter(function(n) {
        return n.classList.contains('atex-pp-cut') && n.dataset && n.dataset.cutId === cutId;
    })[0];
    if (!card) return null;
    return card.querySelector('.atex-pp-fixed-split-warn');
}
function spanBadges(queueEl, cutId) {
    var card = queueEl._all([]).filter(function(n) {
        return n.classList.contains('atex-pp-cut') && n.dataset && n.dataset.cutId === cutId;
    })[0];
    return card ? card.querySelectorAll('.atex-pp-cut-span').map(function(n) { return n.textContent; }) : [];
}

// ── 1) Просроченный разрыв авто-планирования: голова 22.07 (в срок) → хвост 23.07 (за сроком) ──
(function () {
    var head = seg('638509', tsAt(2026, 7, 22, 8, 0));
    var tail = seg('638515', tsAt(2026, 7, 23, 8, 0));
    var c = makeController([head, tail]);
    c.renderQueue();

    assert(spanBadges(c.queueEl, '638509').indexOf('→') !== -1, 'проводка: голова 638509 помечена «→» (задание разорвано по дням)');
    assert(spanBadges(c.queueEl, '638515').indexOf('←') !== -1, 'проводка: хвост 638515 помечен «←» (продолжение вчерашнего)');

    var wTail = warnOfCard(c.queueEl, '638515');
    assert(!!wTail && /разорвано по дням и просрочено/.test(wTail.textContent),
        'А: на ХВОСТЕ (23.07 при сроке 22.07) — красная плашка о разрыве и просрочке');
    assert(!warnOfCard(c.queueEl, '638509'),
        'А: на ГОЛОВЕ (22.07, в срок) плашки нет — просрочка считается по «Дате план» сегмента');
})();

// ── 2) Разрыв на ТРИ дня: середина цепочки (и «←», и «→») тоже предупреждает ──
(function () {
    var c = makeController([
        seg('A0', tsAt(2026, 7, 22, 8, 0)),
        seg('A1', tsAt(2026, 7, 23, 8, 0)),
        seg('A2', tsAt(2026, 7, 24, 8, 0))
    ]);
    c.renderQueue();
    var mid = warnOfCard(c.queueEl, 'A1');
    assert(spanBadges(c.queueEl, 'A1').join('') === '←→', 'проводка: середина трёхдневной цепочки помечена и «←», и «→»');
    assert(!!mid && /просрочено/.test(mid.textContent), 'А: середина трёхдневного разрыва (23.07) — плашка есть (не только голова/хвост)');
    assert(!!warnOfCard(c.queueEl, 'A2'), 'А: хвост трёхдневного разрыва (24.07) — плашка есть');
})();

// ── 3) Зафиксированное задание, разорванное В СРОК: плашка на зафикс-сегменте (случай Б, #4304) ──
(function () {
    var head = seg('F0', tsAt(2026, 7, 22, 8, 0), { fixed: true });
    var tail = seg('F1', tsAt(2026, 7, 23, 8, 0));
    var c = makeController([head, tail]);
    c.supplies.forEach(function(s) { s.dueKey = 20260731; });   // срок далёкий → просрочки нет ни у одного сегмента
    c.renderQueue();
    var wHead = warnOfCard(c.queueEl, 'F0');
    assert(!!wHead && /Зафиксированное задание разорвано по дням — не помещается в смену/.test(wHead.textContent),
        'Б: зафиксированная голова, разорванная по дням в срок — плашка о фиксации');
    assert(!warnOfCard(c.queueEl, 'F1'),
        'Б: продолжение (не зафиксировано, в срок) — без плашки');
})();

// ── 4) Контроль: целое задание в срок — плашки нет ни на одной карточке ──
(function () {
    var c = makeController([seg('S0', tsAt(2026, 7, 22, 8, 0), { orderId: '1' }), seg('S1', tsAt(2026, 7, 23, 8, 0), { orderId: '2' })]);
    c.supplies.forEach(function(s) { s.dueKey = 20260731; });
    c.renderQueue();
    assert(!warnOfCard(c.queueEl, 'S0') && !warnOfCard(c.queueEl, 'S1'),
        'контроль: разные заказы (не сегменты одного задания) — ни значков смежности, ни плашек');
})();

console.log('\n' + passed + ' assertions passed');
