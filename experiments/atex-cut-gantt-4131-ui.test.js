// UI smoke test for ideav/crm#4131 — бейджи «N (M мин)» по дням в строке-заголовке станка.
// Поверх того же лёгкого DOM-стаба, что и atex-cut-gantt-4007-ui.test.js: рендерим _buildBody на
// интервале из трёх дней и проверяем, что в дорожке .atex-cg-machine-track появились бейджи
// .atex-cg-machine-day — по одному на день с заданиями, с текстом и подсказкой своего дня.
// На интервале в один день бейдж дублировал бы итог в первой ячейке — его быть не должно.
//
// Run with: node experiments/atex-cut-gantt-4131-ui.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (копия из atex-cut-gantt-4007-ui.test.js) ──
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

// Один станок, три дня: 29.06 — 2 задания (105+45=150 мин), 30.06 — 1 (120), 01.07 — 2 (30+70=100).
var SL = { id: '10', label: 'SL-01' };
var cuts = [
    { id: 'A1', planDate: '2026-06-29 08:00', setupKnifeMin: 30, setupMaterialMin: 15, cutTimeMin: 60, slitter: SL },
    { id: 'A2', planDate: '2026-06-29 10:00', cutTimeMin: 45, slitter: SL },
    { id: 'B1', planDate: '2026-06-30 08:00', setupMaterialMin: 20, cutTimeMin: 100, slitter: SL },
    { id: 'C1', planDate: '2026-07-01 09:00', cutTimeMin: 30, slitter: SL },
    { id: 'C2', planDate: '2026-07-01 11:00', setupKnifeMin: 15, cutTimeMin: 55, slitter: SL }
];

function buildBody(fromIso, toIso) {
    var inst = Object.create(Controller.prototype);
    inst.root = new StubNode('div');
    inst.cuts = cuts;
    inst.state = { mode: 'day', anchor: fromIso, slitter: '', status: '', zoom: 1, fromIso: fromIso, toIso: toIso };
    inst.lunchDurationMin = 0;
    inst.lunchStartMin = NaN;
    inst.breaks = [];
    inst.calendarByDay = {};
    inst.calendarEnabled = false;
    inst._fitTrackPx = function() { return 0; };
    var range = gantt.ganttRangeFromTo(fromIso, toIso);
    return inst._buildBody(range, gantt.parseDateTimeMs('2026-06-29 07:00'));
}

// ── Несколько дней: бейдж на каждый день с заданиями, в строке-заголовке станка ──
var body = buildBody('2026-06-29', '2026-07-01');
var head = body.querySelector('.atex-cg-machine-head');
assert(!!head, 'строка-заголовок станка отрисована');
assert(head.querySelector('.atex-cg-machine-count').textContent === '5 (370 мин)',
    'итог станка за интервал в первой ячейке: «5 (370 мин)»');

var badges = head.querySelectorAll('.atex-cg-machine-day');
assert(badges.length === 3, 'три дня с заданиями — три бейджа');
assert(badges.map(function(b) { return b.textContent; }).join(' | ') === '2 (150 мин) | 1 (120 мин) | 2 (100 мин)',
    'подписи бейджей: число заданий и сумма минут КАЖДОГО дня');
assert(badges[0].attributes.title === '29.06 · заданий: 2 · 150 мин', 'подсказка бейджа — дата, задания, минуты');
assert(badges[2].attributes.title === '01.07 · заданий: 2 · 100 мин', 'подсказка последнего дня');

// Бейджи стоят В дорожке строки станка и над колонками своих дней (слева направо, без нахлёста).
assert(head.querySelector('.atex-cg-machine-track').childNodes.length === 3,
    'бейджи лежат в дорожке .atex-cg-machine-track');
var lefts = badges.map(function(b) { return parseFloat(b.style.left); });
var widths = badges.map(function(b) { return parseFloat(b.style.width); });
assert(lefts[0] === 0 && lefts[1] > lefts[0] && lefts[2] > lefts[1], 'колонки дней идут слева направо');
assert(Math.abs(lefts[0] + widths[0] - lefts[1]) < 0.01 && Math.abs(lefts[1] + widths[1] - lefts[2]) < 0.01,
    'бейдж занимает ровно свою колонку дня (дни встык, без нахлёста)');

// Сумма минут по бейджам = итогу станка (то же число, что в первой ячейке).
var sum = badges.reduce(function(acc, b) { return acc + Number(/\((\d+) мин\)/.exec(b.textContent)[1]); }, 0);
assert(sum === 370, 'сумма минут бейджей = итогу станка (370)');

// ── Один день: поденный бейдж повторял бы итог — не рисуем ──
var oneDay = buildBody('2026-06-30', '2026-06-30');
assert(oneDay.querySelectorAll('.atex-cg-machine-day').length === 0, 'один день на оси — бейджей нет');
assert(oneDay.querySelector('.atex-cg-machine-count').textContent === '1 (120 мин)', 'итог одного дня — как прежде');
assert(oneDay.querySelectorAll('.atex-cg-bar').length === 1, 'бары резок при этом на месте');

console.log('\n' + passed + '/' + total + ' assertions passed');
