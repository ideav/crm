// Tests for #4381 — начатые задания неприкосновенны, даже если не зафиксированы.
// «Начато» = заполнен реквизит 1161 (колонка cut_start_date отчёта cut_planning).
// Покрываем:
//   1) предикат cutIsStarted;
//   2) карточку задания (рендер очереди на DOM-стабе, как atex-production-planning-4304-*-ui):
//      у начатого убраны atex-pp-drag-handle, atex-pp-move (↑↓), atex-pp-cut-fix,
//      atex-pp-cut-move, atex-pp-cut-del — остаются только «Полосы»;
//   3) dayDeletionTargets — «Удалить» день начатые не сносит;
//   4) planDragReorder — начатое задание «стена» для перетаскивания;
//   5) deviationSettlePlan (#4346) — «Урегулировать» начатые не двигает и не встаёт перед ними.
//
// Run with: node experiments/atex-production-planning-4381.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-4304-split-warn-ui.test.js) ──
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
var planning = api.planning;
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }

// ── 1) Предикат ──────────────────────────────────────────────────────────────
assert(planning.cutIsStarted({ startDate: String(tsAt(2026, 7, 24, 8, 5)) }) === true, 'заполнено «Начато» → задание начато');
assert(planning.cutIsStarted({ startDate: '' }) === false, 'пустое «Начато» → не начато');
assert(planning.cutIsStarted({}) === false, 'нет поля вовсе → не начато');
assert(planning.cutIsStarted(null) === false, 'null → не начато');
assert(planning.cutIsStarted({ startDate: String(tsAt(2026, 7, 24, 8, 5) * 1000) }) === true, '«Начато» в миллисекундах тоже считается');

// ── 2) Карточка задания: у начатого управляющих контролов нет ────────────────
function cutOf(id, planTs, over) {
    var c = { id: id, number: id, slitter: { id: '101', label: 'Станок 3' },
        materialName: 'MW308', materialId: '500', winding: 'OUT', knifeWidths: [110], knifeCount: 1,
        orderId: '4242', planDate: planTs, startDate: '', endDate: '' };
    over = over || {};
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) c[k] = over[k];
    return c;
}
function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '', dateTo: '', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 3' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = [];
    c.supplies = cuts.map(function(x, i) { return { id: 's' + i, cutId: x.id, positionId: null, rolls: 0, dueKey: 20260731 }; });
    c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {};
    c.renderLink = function() {};
    return c;
}
function cardOf(queueEl, cutId) {
    return queueEl._all([]).filter(function(n) {
        return n.classList.contains('atex-pp-cut') && n.dataset && n.dataset.cutId === cutId;
    })[0] || null;
}
function controlsOf(queueEl, cutId) {
    var card = cardOf(queueEl, cutId);
    if (!card) return null;
    return {
        drag: card.querySelectorAll('.atex-pp-drag-handle').length,
        move: card.querySelectorAll('.atex-pp-move').length,        // ↑ и ↓
        fix: card.querySelectorAll('.atex-pp-cut-fix').length,
        cal: card.querySelectorAll('.atex-pp-cut-move').length,
        del: card.querySelectorAll('.atex-pp-cut-del').length,
        strips: card.querySelectorAll('.atex-pp-strips').length
    };
}

(function () {
    var plain = cutOf('P1', tsAt(2026, 7, 24, 8, 0));
    var started = cutOf('S1', tsAt(2026, 7, 24, 12, 0), { startDate: String(tsAt(2026, 7, 24, 12, 5)) });
    var c = makeController([plain, started]);
    c.renderQueue();

    assertEqual(controlsOf(c.queueEl, 'P1'), { drag: 1, move: 2, fix: 1, cal: 1, del: 1, strips: 1 },
        'обычное задание: все контролы на месте (⠿, ↑↓, 🔒, 🗓, 🗑, «Полосы»)');
    assertEqual(controlsOf(c.queueEl, 'S1'), { drag: 0, move: 0, fix: 0, cal: 0, del: 0, strips: 1 },
        'начатое задание: убраны ⠿, ↑↓, 🔒, 🗓, 🗑 — остались только «Полосы»');
})();

// ── 3) «Удалить» день не сносит начатые ──────────────────────────────────────
(function () {
    var cuts = [
        { id: 'd1', planDate: '2026-07-24', startDate: '' },
        { id: 'd2', planDate: '2026-07-24', startDate: String(tsAt(2026, 7, 24, 9, 0)) },
        { id: 'd3', planDate: '2026-07-24', startDate: '', fixed: true }
    ];
    var supplies = [{ id: 's1', cutId: 'd1' }, { id: 's2', cutId: 'd2' }, { id: 's3', cutId: 'd3' }];
    var t = planning.dayDeletionTargets(cuts, supplies, '2026-07-24', '');
    assertEqual(t.cuts.map(function(c) { return c.id; }), ['d1'],
        'удаление дня: начатое (d2) и зафиксированное (d3) пропускаются');
    assertEqual(t.supplies.map(function(s) { return s.id; }), ['s1'], 'обеспечения начатого при удалении дня тоже не трогаем');
})();

// ── 4) Перетаскивание: начатое — «стена» ─────────────────────────────────────
(function () {
    var day = [
        { id: 'a', planDate: tsAt(2026, 7, 24, 8, 0), startDate: '' },
        { id: 'b', planDate: tsAt(2026, 7, 24, 10, 0), startDate: String(tsAt(2026, 7, 24, 10, 3)) },
        { id: 'c', planDate: tsAt(2026, 7, 24, 12, 0), startDate: '' }
    ];
    assertEqual(planning.planDragReorder(day, 'c', 'a').error, 'started',
        'протащить «c» через начатое «b» нельзя — ошибка «started»');
    assertEqual(planning.planDragReorder(day, 'b', 'a').error, 'started',
        'само начатое задание перетащить нельзя');

    var free = [
        { id: 'a', planDate: tsAt(2026, 7, 24, 8, 0), startDate: '' },
        { id: 'b', planDate: tsAt(2026, 7, 24, 10, 0), startDate: '' },
        { id: 'c', planDate: tsAt(2026, 7, 24, 12, 0), startDate: '' }
    ];
    var okPlan = planning.planDragReorder(free, 'c', 'a');
    assertEqual(okPlan.error, null, 'без начатых перестановка работает как прежде');
    assert(okPlan.assignments.length > 0, 'без начатых перестановка выдаёт назначения времён');
})();

// ── 5) #4346 «Урегулировать» начатые не двигает ──────────────────────────────
(function () {
    var TODAY = 20260724;
    var cuts = [
        // просрочено и НАЧАТО — идёт на станке прямо сейчас, трогать нельзя
        { id: 'run', slitter: { id: '1' }, planDate: String(tsAt(2026, 7, 22, 8, 0)), startDate: String(tsAt(2026, 7, 22, 8, 10)), endDate: '' },
        // просрочено и НЕ начато — переносим
        { id: 'late', slitter: { id: '1' }, planDate: String(tsAt(2026, 7, 23, 8, 0)), startDate: '', endDate: '' },
        // начатое сегодня — не отклонение, но и «следующим» быть не должно
        { id: 'nowrun', slitter: { id: '1' }, planDate: String(tsAt(2026, 7, 24, 8, 0)), startDate: String(tsAt(2026, 7, 24, 8, 5)), endDate: '' },
        // первое НЕ начатое будущее задание станка — вот перед ним и место
        { id: 'next', slitter: { id: '1' }, planDate: String(tsAt(2026, 7, 25, 8, 0)), startDate: '', endDate: '' }
    ];
    var groups = planning.deviationGroups(cuts, TODAY);
    assertEqual(groups.overdue.map(function(c) { return c.id; }), ['run', 'late'],
        'начатое просроченное из списка НЕ исчезает — диспетчер его видит');

    var plan = planning.deviationSettlePlan(cuts, groups, { todayKey: TODAY, shiftStartMin: 480 });
    assertEqual(plan.map(function(p) { return p.id; }), ['late'], 'переносим только НЕ начатое просроченное');
    assertEqual(plan[0].planStart, tsAt(2026, 7, 25, 8, 0) - 60,
        'место — перед первым НЕ начатым заданием станка (начатое «nowrun» якорем не берём)');
})();

console.log('\n' + passed + '/' + total + ' passed');
