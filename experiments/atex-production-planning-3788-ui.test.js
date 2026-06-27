// UI smoke test for #3788 — разметка выходного дня в очереди (поверх лёгкого DOM-стаба,
// как issue-3411-search.test.js): на нерабочую дату пустая очередь показывает красным
// «Выходной день» перед «Заданий в очереди нет»; на рабочую дату — нет. Плюс гейтинг
// контроллерного dayIsWorking по наличию таблицы «Календарь».
//
// Run with: node experiments/atex-production-planning-3788-ui.test.js

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

function makeController(filterDate, withCalendar) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: filterDate, dateTo: filterDate, query: '' };
    c.slitters = [{ id: '101', label: 'Слиттер №1' }];
    c.activeSlitter = '101';
    c.cuts = [];   // пустая очередь → ветка пустого состояния
    c.positions = []; c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.actualWidthIndex = null; c.daySettings = {}; c.prevSetupBySlitter = {};
    c.renderLink = function() {};
    if (withCalendar) {
        c.meta.calendar = { id: '123162', reqs: [{ id: '123165', val: 'Тип дня' }] };
        c.calendarByDay = { 20260108: 'Праздничный день' };   // 08.01.2026 — праздник (Чт)
    }
    return c;
}

// ── 1) Нерабочая дата (праздник 08.01.2026) → «Выходной день» перед пустым состоянием ──
var cHol = makeController('2026-01-08', true);
cHol.renderQueue();
var note = cHol.queueEl.querySelector('.atex-pp-dayoff-note');
assert(!!note && /Выходной день/.test(note.textContent), '#3788-ui: на праздник 08.01 показано «Выходной день»');
var empty = cHol.queueEl.querySelector('.atex-pp-empty');
assert(!!empty && /Заданий в очереди нет/.test(empty.textContent), '#3788-ui: «Заданий в очереди нет» присутствует');
// порядок: dayoff-note идёт раньше empty в общем порядке узлов
var all = cHol.queueEl._all([]);
assert(all.indexOf(note) < all.indexOf(empty), '#3788-ui: «Выходной день» отрисован ПЕРЕД «Заданий в очереди нет»');

// ── 2) Рабочая дата (понедельник 12.01.2026) → без пометки ──
var cWork = makeController('2026-01-12', true);
cWork.renderQueue();
assert(!cWork.queueEl.querySelector('.atex-pp-dayoff-note'), '#3788-ui: на рабочий понедельник 12.01 пометки нет');

// ── 3) Гейтинг: без таблицы «Календарь» — даже воскресенье не помечается ──
var cOff = makeController('2026-01-11', false);   // 11.01 — воскресенье, но фича выключена
cOff.renderQueue();
assert(!cOff.queueEl.querySelector('.atex-pp-dayoff-note'), '#3788-ui: без «Календаря» воскресенье не помечается (фича выключена)');
assert(cOff.dayIsWorking(Date.UTC(2026, 0, 11)) === true, '#3788-ui: dayIsWorking без календаря → всегда рабочий');

// ── 4) Контроллерный dayIsWorking с календарём ──
var cM = makeController('2026-01-12', true);
assert(cM.dayIsWorking(Date.UTC(2026, 0, 8)) === false, '#3788-ui: 08.01 (праздник) — нерабочий');
assert(cM.dayIsWorking(Date.UTC(2026, 0, 12)) === true, '#3788-ui: 12.01 (Пн) — рабочий');

console.log('\n' + passed + ' assertions passed');
