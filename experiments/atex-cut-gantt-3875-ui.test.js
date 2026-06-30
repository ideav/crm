// UI smoke test for #3875 — подсветка нерабочих дней (выходные/праздники по «Календарю» #3788)
// на оси Ганта. Поверх лёгкого DOM-стаба (как atex-production-planning-3788-ui.test.js):
// резка в субботу (нерабочий день) получает полосу «.atex-cg-dayoff-band» и красную дату
// «.atex-cg-hour-label.is-dayoff», резка в пятницу (рабочий) — нет. Плюс гейтинг по
// calendarEnabled: без «Календаря» разметка не появляется.
//
// Run with: node experiments/atex-cut-gantt-3875-ui.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб ──
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

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Две резки одного станка: пятница 26.06.2026 (рабочий) и суббота 27.06.2026 (выходной).
var cuts = gantt.rowsToCuts([
    { cut_id: '1', cut_plan_date: '2026-06-26 09:00', cut_slitter: 'SL-01', cut_slitter_id: '10', cut_status: 'Запланировано', cut_length: '1000', cut_planned_runs: '1' },
    { cut_id: '2', cut_plan_date: '2026-06-27 09:00', cut_slitter: 'SL-01', cut_slitter_id: '10', cut_status: 'Запланировано', cut_length: '1000', cut_planned_runs: '1' }
]);

function buildBody(calendarEnabled) {
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'three', anchor: '2026-06-26', slitter: '', status: '', zoom: 1, fromIso: '2026-06-26', toIso: '2026-06-27' };
    inst.lunchDurationMin = 0;
    inst.calendarByDay = {};                 // календарь пуст → Сб/Вс по обычному правилу
    inst.calendarEnabled = calendarEnabled;  // фича включается этим флагом (наличием таблицы)
    inst._fitTrackPx = function() { return 0; };
    var range = gantt.ganttRangeFromTo('2026-06-26', '2026-06-27');
    return inst._buildBody(range, Date.UTC(2026, 5, 26, 12, 0, 0));
}

// Сводка дат-меток оси: { date: 'DD.MM', dayoff: bool }.
function datedLabels(body) {
    return body.querySelectorAll('.atex-cg-hour-label').map(function(lbl) {
        var dateNode = lbl.querySelector('.atex-cg-hour-date');
        return { date: dateNode ? dateNode.textContent : '', dayoff: lbl.classList.contains('is-dayoff') };
    }).filter(function(x) { return x.date; });
}

// ── С календарём: суббота помечена, пятница — нет ──
var on = buildBody(true);
assert(on.querySelectorAll('.atex-cg-dayoff-band').length > 0, '#3875: суббота (выходной) → есть полоса .atex-cg-dayoff-band');
var labels = datedLabels(on);
var sat = labels.filter(function(l) { return /^27\./.test(l.date); });
var fri = labels.filter(function(l) { return /^26\./.test(l.date); });
assert(sat.length >= 1 && sat.every(function(l) { return l.dayoff; }), '#3875: дата субботы (27.06) помечена is-dayoff');
assert(fri.length >= 1 && fri.every(function(l) { return !l.dayoff; }), '#3875: дата пятницы (26.06) НЕ помечена');

// ── Гейтинг: без «Календаря» (calendarEnabled=false) разметки нет ──
var off = buildBody(false);
assert(off.querySelectorAll('.atex-cg-dayoff-band').length === 0, '#3875 гейтинг: без «Календаря» полос нет');
assert(datedLabels(off).every(function(l) { return !l.dayoff; }), '#3875 гейтинг: без «Календаря» дата не помечается');

console.log('\n' + passed + ' assertions passed');
