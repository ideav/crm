// Integration test for ideav/crm#3411 — быстрый поиск в очереди резок и очистка
// панели «Связанные позиции» при переключении станков.
//
// Прогоняет НАСТОЯЩИЙ AtexProductionPlanning.prototype.renderQueue поверх лёгкого
// DOM-стаба (без jsdom) и проверяет:
//   • поле поиска появляется между «Дата плана» и «Статус»;
//   • счётчики на закладках станков показывают число совпавших позиций;
//   • при активном поиске рендерятся только совпавшие карточки;
//   • клик по закладке станка очищает selectedCutId и зовёт renderLink.
//
// Run with: node experiments/issue-3411-search.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.options = [];
    this._className = '';
    this._text = '';
    this._listeners = {};
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        toggle: function(c, on) { if (on === undefined) on = self._classes().indexOf(c) === -1; if (on) self.classList.add(c); else self.classList.remove(c); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', {
    get: function() { return this._className; },
    set: function(v) { this._className = String(v || ''); }
});
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() {
        if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join('');
        return this._text;
    },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
});
Object.defineProperty(StubNode.prototype, 'innerHTML', {
    get: function() { return ''; },
    set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } }
});
Object.defineProperty(StubNode.prototype, 'firstChild', {
    get: function() { return this.childNodes[0] || null; }
});
StubNode.prototype.appendChild = function(node) {
    this.childNodes.push(node); node.parentNode = this;
    if (this.tagName === 'SELECT' && node.tagName === 'OPTION') this.options.push(node);
    return node;
};
StubNode.prototype.removeChild = function(node) { this.childNodes = this.childNodes.filter(function(c) { return c !== node; }); return node; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() { this._focused = true; };
StubNode.prototype.setSelectionRange = function() {};
StubNode.prototype._all = function(acc) {
    var self = this;
    this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } });
    return acc;
};
StubNode.prototype.querySelectorAll = function(sel) {
    var cls = sel.replace(/^\./, '');
    return this._all([]).filter(function(n) { return n.classList.contains(cls); });
};
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'),
    readyState: 'loading',   // не запускать api.init() при require — ждём DOMContentLoaded (no-op)
    getElementById: function() { return null; },
    addEventListener: function() {}
};
global.window = { db: 'testdb' };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Подготовка контроллера с минимальными данными ──
var root = new StubNode('div');
root.attributes['data-db'] = 'testdb';
var c = new Controller(root);
c.queueEl = new StubNode('div');
c.linkEl = new StubNode('div');
c.filter = { slitter: '', status: '', date: '', query: '' };  // дата пустая → видимость не фильтрует
c.slitters = [
    { id: '101', label: 'Слиттер №1' },
    { id: '102', label: 'Слиттер №2' }
];
c.activeSlitter = '101';
c.cuts = [
    { id: 'A', number: '1', slitter: { id: '101', label: 'Слиттер №1' }, status: 'В работе', materialName: 'BOPP прозрачный', materialId: '500', winding: 'IN' },
    { id: 'B', number: '2', slitter: { id: '101', label: 'Слиттер №1' }, status: 'В работе', materialName: 'PET фольга', materialId: '501', winding: 'IN' },
    { id: 'C', number: '3', slitter: { id: '102', label: 'Слиттер №2' }, status: 'В работе', materialName: 'BOPP матовый', materialId: '502', winding: 'OUT' }
];
c.positions = [{ id: 'p1', label: '1234/5 · 600мм * 1000м', qty: 0 }];
c.supplies = [{ id: 's1', cutId: 'A', positionId: 'p1', rolls: 0 }];
c.genBatches = [];
c.opTimes = {};
c.changeTimes = {};
c.footageBySupply = {};
c.consumptionByCut = {};
c.jumboWidthByMaterial = {};
c.actualWidthIndex = null;
c.daySettings = {};

// Спай на renderLink — фиксируем вызовы.
var renderLinkCalls = 0;
c.renderLink = function() { renderLinkCalls++; };

// ── 1) Поле поиска между «Дата плана» и «Статус» ──
c.renderQueue();
var filters = c.queueEl.querySelector('.atex-pp-filters');
var labels = filters.childNodes.map(function(field) {
    var lbl = field.childNodes[0];
    return lbl ? lbl.textContent : '';
});
assert(JSON.stringify(labels) === JSON.stringify(['Дата плана', 'Поиск', 'Статус']),
    'поле «Поиск» стоит между «Дата плана» и «Статус» (' + labels.join(', ') + ')');
assert(!!c.queueEl.querySelector('.atex-pp-search'), 'поле поиска присутствует');

// ── 2) Без поиска: счётчики закладок = числу резок станка ──
var tabsNoQuery = c.queueEl.querySelectorAll('.atex-pp-tab');
function tabCount(tab) { return Number(tab.querySelector('.atex-pp-tab-count').textContent); }
assert(tabsNoQuery.length === 2, 'две закладки станков');
assert(tabCount(tabsNoQuery[0]) === 2, 'Слиттер №1: 2 резки без поиска');
assert(tabCount(tabsNoQuery[1]) === 1, 'Слиттер №2: 1 резка без поиска');
var cardsNoQuery = c.queueEl.querySelectorAll('.atex-pp-cut');
assert(cardsNoQuery.length === 2, 'активный станок (101) показывает 2 карточки без поиска');

// ── 3) Поиск «BOPP»: счётчики и карточки сужаются ──
c.filter.query = 'BOPP';
c.renderQueue();
var tabsBopp = c.queueEl.querySelectorAll('.atex-pp-tab');
assert(tabCount(tabsBopp[0]) === 1, 'Слиттер №1: 1 совпадение по «BOPP» (cut A)');
assert(tabCount(tabsBopp[1]) === 1, 'Слиттер №2: 1 совпадение по «BOPP» (cut C)');
var cardsBopp = c.queueEl.querySelectorAll('.atex-pp-cut');
assert(cardsBopp.length === 1 && cardsBopp[0].dataset.cutId === 'A',
    'активный станок (101) показывает только совпавшую карточку A');

// ── 4) Поиск по подписи связанной позиции ──
c.filter.query = '1234/5';
c.renderQueue();
var tabsPos = c.queueEl.querySelectorAll('.atex-pp-tab');
assert(tabCount(tabsPos[0]) === 1, 'Слиттер №1: 1 совпадение по подписи позиции «1234/5» (cut A)');
assert(tabCount(tabsPos[1]) === 0, 'Слиттер №2: 0 совпадений по «1234/5»');

// ── 5) Поиск без совпадений в активном станке — подсказка ──
c.activeSlitter = '102';
c.renderQueue();
var emptyHint = c.queueEl.querySelector('.atex-pp-empty');
assert(!!emptyHint && /нет позиций по запросу/.test(emptyHint.textContent),
    'станок без совпадений показывает подсказку');

// ── 6) Клик по закладке станка очищает selectedCutId и зовёт renderLink ──
c.filter.query = '';
c.activeSlitter = '101';
c.selectedCutId = 'A';
c.renderQueue();
var before = renderLinkCalls;
var tab102 = c.queueEl.querySelectorAll('.atex-pp-tab')[1];
tab102.click();
assert(c.selectedCutId === null, 'переключение станка очистило selectedCutId');
assert(renderLinkCalls === before + 1, 'переключение станка вызвало renderLink');
assert(c.activeSlitter === '102', 'переключение станка сменило активный станок');

console.log('\n' + passed + ' assertions passed');
