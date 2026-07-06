// UI smoke test for #4007 (ТЗ §5) — короткие перерывы рисуются строкой «☕ Перерыв · N мин».
// Поверх того же лёгкого DOM-стаба, что и atex-cut-gantt-3875-ui.test.js: рендерим _buildBody с
// настроенными перерывами и проверяем, что появилась строка .atex-cg-break-row с баром
// .atex-cg-break (несущий — резка, чьё окно накрывает 10:00), а без настройки перерывов — нет.
//
// Run with: node experiments/atex-cut-gantt-4007-ui.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (копия из atex-cut-gantt-3875-ui.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = '';
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
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = { createElement: function(tag) { return new StubNode(tag); } };

var api = require('../download/atex/js/cut-gantt.js');
var gantt = api.gantt;
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

// Три резки одного станка 29.06.2026: C1 09:00–11:00 накрывает перерыв 10:00.
var cuts = [
    { id: 'C0', planDate: '2026-06-29 08:00', cutTimeMin: 60, slitter: { id: '10', label: 'SL-01' } },
    { id: 'C1', planDate: '2026-06-29 09:00', cutTimeMin: 120, slitter: { id: '10', label: 'SL-01' } },
    { id: 'C2', planDate: '2026-06-29 11:00', cutTimeMin: 60, slitter: { id: '10', label: 'SL-01' } }
];

function buildBody(breaks) {
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'day', anchor: '2026-06-29', slitter: '', status: '', zoom: 1, fromIso: '2026-06-29', toIso: '2026-06-29' };
    inst.lunchDurationMin = 0;
    inst.lunchStartMin = NaN;
    inst.breaks = breaks;
    inst.calendarByDay = {};
    inst.calendarEnabled = false;
    inst._fitTrackPx = function() { return 0; };
    var range = gantt.ganttRangeFromTo('2026-06-29', '2026-06-29');
    return inst._buildBody(range, gantt.parseDateTimeMs('2026-06-29 12:00'));
}

// ── #4052: перерыв — серая накладка .atex-cg-brk ПОВЕРХ несущего бара (без отдельной строки) ──
var on = buildBody([{ startMin: 600, durationMin: 10, label: 'Перерыв' }]);
assert(on.querySelectorAll('.atex-cg-break-row').length === 0, '#4052 UI: отдельной строки перерыва больше нет');
var bands = on.querySelectorAll('.atex-cg-brk');
assert(bands.length === 1, '#4052 UI: одна накладка перерыва (.atex-cg-brk)');
var band = bands[0];
assert(band && band.style.width === (10 * 2) + 'px', '#4052 UI: ширина накладки = 10 мин × 2px/мин');
assert(band && band.attributes.title === 'Перерыв 10:00-10:10',
    '#4052 UI: title накладки = «Перерыв 10:00-10:10» (подпись + диапазон), без текста внутри');
assert(band && band.textContent === '', '#4052 UI: накладка без текста');
// Накладка лежит В строке несущего бара (C1, 09:00–11:00 накрывает 10:00), а не отдельной строкой.
var rowsWithBrk = on.querySelectorAll('.atex-cg-row').filter(function(r) { return r.querySelector('.atex-cg-brk'); });
assert(rowsWithBrk.length === 1 && rowsWithBrk[0].querySelector('.atex-cg-bar'),
    '#4052 UI: накладка — в строке несущего бара (в той же .atex-cg-row есть и бар)');

// ── Без настройки перерывов: накладок нет (деградация без поломки Ганта) ──
var off = buildBody([]);
assert(off.querySelectorAll('.atex-cg-brk').length === 0, '#4052 UI: без настройки перерывов — накладок нет');
// Обычные бары резок при этом на месте.
assert(off.querySelectorAll('.atex-cg-bar').length === 3, '#4052 UI: без перерывов — три бара резок отрисованы');

console.log('\n' + passed + '/' + total + ' assertions passed');
