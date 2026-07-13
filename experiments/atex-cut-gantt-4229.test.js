// Tests for #4229 — «Отпуск» станка на Ганте: серым, ОТДЕЛЬНОЙ строкой, с Примечаниями (≤100 симв.).
// Ядро (downtimeInRange/Notes/SpanClamped, ось workingSegments с днями отпуска, group.downtimes) +
// UI-строка (.atex-cg-downtime-row с серым баром .atex-cg-bar--downtime и текстом примечаний).
//
// Run with: node experiments/atex-cut-gantt-4229.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как atex-cut-gantt-3875-ui.test.js) ──
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

// ── 1) Обрезка Примечаний до 10 символов (#4238); пусто → «Отпуск» ───────────────────────────────────
(function () {
    var long = new Array(250).join('я');   // 249 символов
    var t = gantt.downtimeNotesText(long);
    assert(t.length === 10, '#4238 Примечания обрезаны до 10 символов (было ' + long.length + ', стало ' + t.length + ')');
    assert(gantt.downtimeNotesText('') === 'Отпуск', '#4229 пустые примечания → «Отпуск»');
    assert(gantt.downtimeNotesText('  ТО линии  ') === 'ТО линии', '#4229 примечания триммятся');
})();

// ── 2) downtimeInRange / downtimeSpanClamped ───────────────────────────────────────────────────────
(function () {
    var range = gantt.ganttRangeFromTo('2026-07-13', '2026-07-15');
    var inside = { id: 'd', startMs: utc(2026, 7, 14, 8, 0), endMs: utc(2026, 7, 14, 18, 0), notes: '' };
    var before = { id: 'd', startMs: utc(2026, 7, 1, 8, 0), endMs: utc(2026, 7, 1, 18, 0), notes: '' };
    assert(gantt.downtimeInRange(inside, range), '#4229 отпуск в периоде → true');
    assert(!gantt.downtimeInRange(before, range), '#4229 отпуск до периода → false');
    var span = gantt.downtimeSpanClamped({ id: 'd', startMs: utc(2026, 7, 10), endMs: utc(2026, 7, 14, 18, 0) }, range);
    assert(span && span.startMs === range.startMs, '#4229 спан обрезан слева по периоду');
    assert(span && span.endMs <= range.endMs, '#4229 спан обрезан справа по периоду');
    var noEnd = gantt.downtimeEndMs({ startMs: utc(2026, 7, 14, 8, 0), endMs: null });
    assert(noEnd > utc(2026, 7, 14, 8, 0), '#4229 без «Окончания» — простой до конца смены дня начала');
})();

// ── 3) Ось (workingSegments) держит день отпуска БЕЗ резок ──────────────────────────────────────────
(function () {
    var range = gantt.ganttRangeFromTo('2026-07-13', '2026-07-15');
    // Резка только 13.07; отпуск 14.07 (в этот день резок нет).
    var cuts = gantt.rowsToCuts([
        { cut_id: '1', cut_plan_date: '2026-07-13 09:00', cut_slitter: 'SL-01', cut_slitter_id: '10', cut_status: 'Запланировано', cut_length: '1000', cut_planned_runs: '1' }
    ]);
    var downtimes = { '10': [{ id: 'd1', startMs: utc(2026, 7, 14, 8, 0), endMs: utc(2026, 7, 14, 18, 0), notes: 'ТО линии' }] };
    var data = gantt.layoutGroups(cuts, range, utc(2026, 7, 13, 12, 0), {},
        { downtimesBySlitter: downtimes, slitterLabels: { '10': 'SL-01' } });
    var segDays = data.scale.segments.map(function (s) { return new Date(s.startMs).getUTCDate(); });
    assert(segDays.indexOf(13) >= 0 && segDays.indexOf(14) >= 0,
        '#4229 ось содержит и день резки (13), и день отпуска без резок (14): ' + segDays.join(','));
    var g = data.groups.filter(function (x) { return x.slitter.id === '10'; })[0];
    assert(g && g.downtimes && g.downtimes.length === 1, '#4229 у станка есть окно отпуска в group.downtimes');
    assert(g.downtimes[0].leftPx > 0 && g.downtimes[0].widthPx > 0, '#4229 бар отпуска спозиционирован (leftPx/widthPx > 0)');
    assert(g.downtimes[0].notes === 'ТО линии', '#4229 примечания попали в бар отпуска');
})();

// ── 4) Станок ТОЛЬКО с отпуском (без резок) всё равно даёт группу+строку ────────────────────────────
(function () {
    var range = gantt.ganttRangeFromTo('2026-07-13', '2026-07-15');
    var downtimes = { '20': [{ id: 'd2', startMs: utc(2026, 7, 14, 8, 0), endMs: utc(2026, 7, 14, 18, 0), notes: 'Отпуск' }] };
    var data = gantt.layoutGroups([], range, utc(2026, 7, 13, 12, 0), {},
        { downtimesBySlitter: downtimes, slitterLabels: { '20': 'SL-02' } });
    var g = data.groups.filter(function (x) { return x.slitter.id === '20'; })[0];
    assert(!!g, '#4229 станок без резок, но с отпуском — группа создана');
    assert(g && g.tasks.length === 0 && g.downtimes.length === 1, '#4229 у него нет задач, но есть строка отпуска');
})();

// ── 5) UI: строка отпуска .atex-cg-downtime-row с серым баром .atex-cg-bar--downtime и текстом ───────
(function () {
    var cuts = gantt.rowsToCuts([
        { cut_id: '1', cut_plan_date: '2026-07-13 09:00', cut_slitter: 'SL-01', cut_slitter_id: '10', cut_status: 'Запланировано', cut_length: '1000', cut_planned_runs: '1' }
    ]);
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'three', anchor: '2026-07-13', slitter: '', status: '', zoom: 1, fromIso: '2026-07-13', toIso: '2026-07-15' };
    inst.lunchDurationMin = 0; inst.calendarByDay = {}; inst.calendarEnabled = false;
    inst._fitTrackPx = function () { return 0; };
    inst.slitterLabels = { '10': 'SL-01' };
    inst.downtimesBySlitter = { '10': [{ id: 'd1', startMs: utc(2026, 7, 14, 8, 0), endMs: utc(2026, 7, 14, 18, 0), notes: 'Плановое ТО' }] };
    var range = gantt.ganttRangeFromTo('2026-07-13', '2026-07-15');
    var body = inst._buildBody(range, utc(2026, 7, 13, 12, 0));

    var rows = body.querySelectorAll('.atex-cg-downtime-row');
    assert(rows.length === 1, '#4229 UI: одна ОТДЕЛЬНАЯ строка отпуска (.atex-cg-downtime-row)');
    var bar = body.querySelector('.atex-cg-bar--downtime');
    assert(!!bar, '#4229 UI: серый бар отпуска (.atex-cg-bar--downtime)');
    var main = bar && bar.querySelector('.atex-cg-bar-main');
    assert(main && main.textContent === '08:00-18:00 Плановое Т',
        '#4238 UI: подпись бара отпуска — диапазон + Примечание ≤10 симв. («08:00-18:00 Плановое Т»), стало «' + (main && main.textContent) + '»');
    var label = rows[0] && rows[0].querySelector('.atex-cg-label-main');
    assert(label && label.textContent === 'Отпуск', '#4229 UI: в метке слева — «Отпуск»');
    // бар спозиционирован (left задан px)
    assert(bar && /px$/.test(String(bar.style.left)) && parseFloat(bar.style.left) >= 0, '#4229 UI: бар отпуска спозиционирован (left в px)');
})();

// ── 6) Легенда содержит пункт «Отпуск» ──────────────────────────────────────────────────────────────
(function () {
    var inst = Object.create(Controller.prototype);
    var legend = inst._buildLegend();
    var item = legend.querySelectorAll('.is-downtime');
    assert(item.length === 1 && item[0].textContent === 'Отпуск', '#4229 UI: в легенде есть серый пункт «Отпуск»');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
