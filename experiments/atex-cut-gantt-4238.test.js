// Tests for #4238 — «Отпуск» станка на Ганте: в ХРОНОЛОГИЧЕСКОМ порядке по старту (а не всегда внизу
// дня), подпись бара = диапазон времени + Примечание (обрезанное до 10 символов).
//   1) mergeGroupRows — чистая вставка отпуска в порядок заданий по времени старта;
//   2) layout barText — «HH:MM-HH:MM Примечание≤10» (пустое примечание не дописывается);
//   3) UI — строка отпуска (.atex-cg-downtime-row) стоит ПЕРЕД поздним заданием того же станка.
//
// Run with: node experiments/atex-cut-gantt-4238.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как atex-cut-gantt-4229.test.js) ──
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
global.document = { createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
                    createElement: function(tag) { return new StubNode(tag); } };

var api = require('../download/atex/js/cut-gantt.js');
var gantt = api.gantt;
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function utc(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0, 0, 0); }
function kinds(rows) { return rows.map(function(r) { return r.kind; }).join(','); }

// ── 1) mergeGroupRows: отпуск встаёт по времени старта, задания сохраняют порядок ──────────────────
(function () {
    var tasks = [{ startMs: 100 }, { startMs: 300 }];
    var dts = [{ startMs: 200 }];
    var rows = gantt.mergeGroupRows(tasks, dts);
    assert(kinds(rows) === 'task,downtime,task', '#4238 отпуск (200) встаёт МЕЖДУ заданий 100 и 300: ' + kinds(rows));
    assert(rows[0].task.startMs === 100 && rows[2].task.startMs === 300, '#4238 задания сохраняют относительный порядок');
    assert(rows[0].taskIdx === 0 && rows[2].taskIdx === 1, '#4238 taskIdx сохраняется для накладок обеда/перерыва');
})();

// Отпуск раньше ВСЕХ заданий (случай из тикета: отпуск 08:00, задания с 10:00) → идёт первым.
(function () {
    var rows = gantt.mergeGroupRows([{ startMs: utc(2026, 7, 2, 10, 0) }, { startMs: utc(2026, 7, 2, 10, 14) }],
                                    [{ startMs: utc(2026, 7, 2, 8, 0) }]);
    assert(kinds(rows) === 'downtime,task,task', '#4238 отпуск раньше всех заданий → строка отпуска ПЕРВАЯ: ' + kinds(rows));
})();

// Отпуск позже всех заданий и отпуск без старта (null) → в конец.
(function () {
    var later = gantt.mergeGroupRows([{ startMs: 100 }], [{ startMs: 999 }]);
    assert(kinds(later) === 'task,downtime', '#4238 отпуск позже всех заданий → в конец: ' + kinds(later));
    var noStart = gantt.mergeGroupRows([{ startMs: 100 }], [{ startMs: null }]);
    assert(kinds(noStart) === 'task,downtime', '#4238 отпуск без старта → в конец: ' + kinds(noStart));
    var twoDts = gantt.mergeGroupRows([{ startMs: 500 }], [{ startMs: 900 }, { startMs: 100 }]);
    assert(kinds(twoDts) === 'downtime,task,downtime', '#4238 два отпуска сортируются по старту вокруг задания: ' + kinds(twoDts));
})();

// Нет заданий — только отпуска (в порядке старта).
(function () {
    var rows = gantt.mergeGroupRows([], [{ startMs: 300 }, { startMs: 100 }]);
    assert(kinds(rows) === 'downtime,downtime' && rows[0].downtime.startMs === 100,
        '#4238 без заданий — отпуска по возрастанию старта');
})();

// ── 2) layout: подпись бара отпуска = «HH:MM-HH:MM Примечание≤10»; пустое примечание не дописывается ──
(function () {
    var range = gantt.ganttRangeFromTo('2026-07-14', '2026-07-14');
    var downtimes = { '10': [
        { id: 'd1', startMs: utc(2026, 7, 14, 8, 0), endMs: utc(2026, 7, 14, 10, 0), notes: 'Плановое ТО' },
        { id: 'd2', startMs: utc(2026, 7, 14, 13, 0), endMs: utc(2026, 7, 14, 14, 0), notes: '' }
    ] };
    var data = gantt.layoutGroups([], range, utc(2026, 7, 14, 12, 0), {},
        { downtimesBySlitter: downtimes, slitterLabels: { '10': 'SL-01' } });
    var g = data.groups.filter(function (x) { return x.slitter.id === '10'; })[0];
    var byId = {}; (g.downtimes || []).forEach(function (d) { byId[d.id] = d; });
    assert(byId.d1 && byId.d1.barText === '08:00-10:00 Плановое Т',
        '#4238 бар с примечанием: диапазон + примечание≤10 («08:00-10:00 Плановое Т»), стало «' + (byId.d1 && byId.d1.barText) + '»');
    assert(byId.d1 && byId.d1.notesFull === 'Плановое ТО', '#4238 notesFull несёт ПОЛНОЕ примечание для тултипа');
    assert(byId.d2 && byId.d2.barText === '13:00-14:00',
        '#4238 пустое примечание → подпись = только диапазон («13:00-14:00»), стало «' + (byId.d2 && byId.d2.barText) + '»');
})();

// ── 3) UI: строка отпуска (08:00) стоит ПЕРЕД поздним заданием (10:00) того же станка ────────────────
(function () {
    var cuts = gantt.rowsToCuts([
        { cut_id: '1', cut_plan_date: '2026-07-14 10:00', cut_slitter: 'SL-01', cut_slitter_id: '10', cut_status: 'Запланировано', cut_length: '1000', cut_planned_runs: '1' }
    ]);
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'day', anchor: '2026-07-14', slitter: '', status: '', zoom: 1, fromIso: '2026-07-14', toIso: '2026-07-14' };
    inst.lunchDurationMin = 0; inst.calendarByDay = {}; inst.calendarEnabled = false;
    inst._fitTrackPx = function () { return 0; };
    inst.slitterLabels = { '10': 'SL-01' };
    inst.downtimesBySlitter = { '10': [{ id: 'd1', startMs: utc(2026, 7, 14, 8, 0), endMs: utc(2026, 7, 14, 9, 0), notes: 'ТО' }] };
    var range = gantt.ganttRangeFromTo('2026-07-14', '2026-07-14');
    var body = inst._buildBody(range, utc(2026, 7, 14, 12, 0));

    // .atex-cg-row несут и служебные строки (ось .atex-cg-scale-row, шапка станка .atex-cg-machine-head) —
    // берём только строки заданий и отпуска.
    var rows = body.querySelectorAll('.atex-cg-row');
    var idxDown = -1, idxTask = -1;
    rows.forEach(function (r, i) {
        if (r.classList.contains('atex-cg-scale-row') || r.classList.contains('atex-cg-machine-head')) return;
        if (r.classList.contains('atex-cg-downtime-row')) { if (idxDown < 0) idxDown = i; }
        else if (idxTask < 0) idxTask = i;
    });
    assert(idxDown >= 0 && idxTask >= 0, '#4238 UI: есть и строка отпуска, и строка задания');
    assert(idxDown < idxTask, '#4238 UI: отпуск (08:00) выше позднего задания (10:00) — хронологический порядок, а не внизу (down=' + idxDown + ', task=' + idxTask + ')');
    var bar = body.querySelector('.atex-cg-bar--downtime');
    var main = bar && bar.querySelector('.atex-cg-bar-main');
    assert(main && main.textContent === '08:00-09:00 ТО', '#4238 UI: подпись бара — «08:00-09:00 ТО», стало «' + (main && main.textContent) + '»');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
