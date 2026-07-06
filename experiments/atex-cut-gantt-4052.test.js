// UI test for ideav/crm#4052 — обед и перерывы на Ганте: серые накладки ПОВЕРХ баров, а не
// отдельные строки. Несущий их бар удлиняется на их длительность; накладка без текста, с title
// «Обед 12:20-13:00» / «Перерыв 10:00-10:10»; в легенде — единый серый пункт «Обед / перерыв».
//
// Закрывает и #4046: у резки, через которую идёт обед, бар растёт на обед (нет голого зазора).
//
// Run with: node experiments/atex-cut-gantt-4052.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-cut-gantt-4007-ui.test.js) ──
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

function buildBody(cuts, opts) {
    opts = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'day', anchor: '2026-06-23', slitter: '', status: '', zoom: 1, fromIso: '2026-06-23', toIso: '2026-06-23' };
    inst.lunchDurationMin = opts.lunchDurationMin || 0;
    inst.lunchStartMin = opts.lunchStartMin == null ? NaN : opts.lunchStartMin;
    inst.breaks = opts.breaks || [];
    inst.calendarByDay = {};
    inst.calendarEnabled = false;
    inst._fitTrackPx = function() { return 0; };
    var range = gantt.ganttRangeFromTo('2026-06-23', '2026-06-23');
    return inst._buildBody(range, gantt.parseDateTimeMs('2026-06-01 12:00'));
}
function cut(id, iso, knife, material, cutTime) {
    return { id: id, planDate: iso, setupKnifeMin: knife, setupMaterialMin: material, cutTimeMin: cutTime, slitter: { id: '1', label: 'St1' } };
}
var LUNCH = { lunchDurationMin: 40, lunchStartMin: 12 * 60 + 20 };

// ── Легенда: единый серый пункт «Обед / перерыв» ──
var legend = Object.create(Controller.prototype)._buildLegend
    ? (function () { var i = Object.create(Controller.prototype); return i._buildLegend(); })()
    : null;
assert(legend && legend.querySelectorAll('.is-break').length === 1, '#4052: в легенде один пункт .is-break');
var brkLeg = legend.querySelector('.is-break');
assert(brkLeg && brkLeg.textContent === 'Обед / перерыв', '#4052: пункт легенды подписан «Обед / перерыв»');

// ── #4046-кейс: резка через обед (12:02, наладка 15 + резка 50), следующая в 13:42 (зазор 35) ──
// Обед попадает ВНУТРЬ резки → бар удлиняется на обед и упирается в следующий бар (нет голого зазора);
// накладка обеда «Обед 12:20-13:00» лежит ПОВЕРХ этого бара; отдельной строки обеда нет.
var body = buildBody([
    cut('3784', '2026-06-23 11:44', 0, 0, 18),
    cut('3797', '2026-06-23 12:02', 0, 15, 50),
    cut('3790', '2026-06-23 13:42', 0, 0, 8)
], LUNCH);
assert(body.querySelectorAll('.atex-cg-lunch-row').length === 0, '#4052: отдельных строк обеда нет');
assert(body.querySelectorAll('.atex-cg-break-row').length === 0, '#4052: отдельных строк перерыва нет');
var bands = body.querySelectorAll('.atex-cg-brk');
assert(bands.length === 1, '#4052: одна накладка обеда (.atex-cg-brk)');
assert(bands[0].attributes.title === 'Обед 12:20-13:00', '#4052: title накладки = «Обед 12:20-13:00»');
assert(bands[0].textContent === '', '#4052: накладка без текста');
// Накладка — в строке несущего бара (той, где бар 3797).
var brkRows = body.querySelectorAll('.atex-cg-row').filter(function (r) { return r.querySelector('.atex-cg-brk'); });
assert(brkRows.length === 1 && brkRows[0].querySelector('.atex-cg-bar'), '#4052: накладка лежит в строке несущего бара');
// Бар 3797 удлинён (широкий) и правым краем доходит до старта 3790 (нет голого зазора #4046).
var bars = body.querySelectorAll('.atex-cg-bar');
var carrier = bars[1], nextBar = bars[2];   // порядок строк = 3784, 3797, 3790
var carrLeft = parseFloat(carrier.style.left), carrW = parseFloat(carrier.style.width);
var nextLeft = parseFloat(nextBar.style.left);
assert(Math.abs((carrLeft + carrW) - nextLeft) < 1, '#4046/#4052: правый край бара-обеда доходит до старта следующего (голого зазора нет)');
assert(carrW / 2 > 65, '#4046/#4052: бар-обеда шире голой работы 65 мин (удлинён на обед)');

// ── Обед И перерыв в один день → две накладки (обе серые .atex-cg-brk) ──
var body2 = buildBody([
    cut('A', '2026-06-23 09:00', 0, 0, 120),   // 09:00–11:00 накрывает перерыв 10:00
    cut('B', '2026-06-23 12:00', 0, 0, 90)      // 12:00–13:30 накрывает обед 12:20
], { lunchDurationMin: 40, lunchStartMin: 12 * 60 + 20, breaks: [{ startMin: 600, durationMin: 10, label: 'Перерыв' }] });
var bands2 = body2.querySelectorAll('.atex-cg-brk');
assert(bands2.length === 2, '#4052: обед + перерыв → две накладки .atex-cg-brk');
var titles = bands2.map(function (b) { return b.attributes.title; }).sort();
assert(JSON.stringify(titles) === JSON.stringify(['Обед 12:20-13:00', 'Перерыв 10:00-10:10']),
    '#4052: title — «Обед 12:20-13:00» и «Перерыв 10:00-10:10»');

console.log('\n' + passed + '/' + total + ' assertions passed');
