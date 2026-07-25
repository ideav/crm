// Tests for #4392 — разрешить перестановку порядка в очереди для ЗАФИКСИРОВАННЫХ (🔒) заданий:
// кнопки ↑↓ (.atex-pp-move) и ручка перетаскивания (.atex-pp-drag-handle) должны работать, даже если
// одно или оба соседних задания зафиксированы. Фиксация держит ДЕНЬ, а не позицию в дне — перестановка
// лишь обменивает planStart В ПРЕДЕЛАХ того же дня, замок не нарушается. Начатое (#4381) остаётся «стеной».
//
// Покрываем:
//   1) карточка зафиксированного задания: ⠿ перетаскиваема (draggable, без is-disabled), ↑↓ не заблокированы
//      флагом fixed (лишь границами дня);
//   2) planDragReorder — сквозь фикс и сам фикс переставляются (см. также обновлённый #4306);
//   3) moveCutInDay — не отказывает при зафиксированных соседях (обмен planStart идёт).
//
// Run with: node experiments/atex-production-planning-4392.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в #4381) ──
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
    if (ok) { passed++; } else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }

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
    return queueEl._all([]).filter(function(n) { return n.classList.contains('atex-pp-cut') && n.dataset && n.dataset.cutId === cutId; })[0] || null;
}

// ── 1) Карточка ЗАФИКСИРОВАННОГО задания: ⠿ перетаскиваема, ↑↓ не заблокированы флагом fixed ──────────
(function () {
    // Два зафиксированных задания одного дня. Раньше (#3508/#4306) ↑↓/⠿ у них были заблокированы.
    var f1 = cutOf('F1', tsAt(2026, 7, 24, 8, 0), { fixed: true });
    var f2 = cutOf('F2', tsAt(2026, 7, 24, 12, 0), { fixed: true });
    var c = makeController([f1, f2]);
    c.renderQueue();

    var card1 = cardOf(c.queueEl, 'F1'), card2 = cardOf(c.queueEl, 'F2');
    assert(!!card1 && !!card2, '#4392: карточки обоих зафиксированных заданий отрисованы');

    // ⠿ ручка: присутствует, перетаскиваема, без is-disabled.
    var drag1 = card1.querySelector('.atex-pp-drag-handle');
    assert(!!drag1, '#4392: ⠿ у зафиксированного присутствует');
    assert(drag1 && drag1.getAttribute('draggable') === 'true', '#4392: ⠿ у зафиксированного ПЕРЕТАСКИВАЕМА (draggable=true)');
    assert(drag1 && !drag1.classList.contains('is-disabled'), '#4392: ⠿ у зафиксированного НЕ is-disabled');

    // ↑↓: у первого дня down НЕ заблокирован; у второго (последнего) up НЕ заблокирован.
    // (границы дня по-прежнему блокируют: у первого up, у последнего down.)
    var mv1 = card1.querySelectorAll('.atex-pp-move'), mv2 = card2.querySelectorAll('.atex-pp-move');
    assertEqual([mv1.length, mv2.length], [2, 2], '#4392: обе кнопки ↑↓ присутствуют у зафиксированных');
    assert(mv1[1] && mv1[1].disabled === false, '#4392: у F1 «↓» НЕ заблокирована флагом fixed (раньше была)');
    assert(mv2[0] && mv2[0].disabled === false, '#4392: у F2 «↑» НЕ заблокирована флагом fixed (раньше была)');
    // граница дня всё ещё блокирует крайние
    assert(mv1[0] && mv1[0].disabled === true, '#4392: у первого дня «↑» заблокирована границей (не фиксом)');
    assert(mv2[1] && mv2[1].disabled === true, '#4392: у последнего дня «↓» заблокирована границей (не фиксом)');
})();

// ── 2) planDragReorder — фикс переставляется и через фикс можно тащить (см. также #4306) ─────────────
(function () {
    var day = [
        { id: 'A', planDate: 1000 },
        { id: 'F', planDate: 2000, fixed: true },
        { id: 'B', planDate: 3000, fixed: true }
    ];
    assertEqual(planning.planDragReorder(day, 'B', 'A').error, null,
        '#4392: перетащить зафиксированный B перед A (через зафиксированный F) — без ошибки');
    var r = planning.planDragReorder(day, 'B', 'A');
    var byId = {}; r.assignments.forEach(function (w) { byId[w.id] = w.planStartTs; });
    assertEqual([byId.B, byId.A, byId.F], [1000, 2000, 3000],
        '#4392: времена дня переназначены по порядку [B,A,F] — все, включая зафиксированные');
})();

// ── 3) moveCutInDay — не отказывает при зафиксированных соседях, идёт обмен planStart ────────────────
(function () {
    var a = { id: 'A', slitter: { id: '101' }, planDate: '1000', startDate: '', fixed: true };
    var b = { id: 'B', slitter: { id: '101' }, planDate: '2000', startDate: '', fixed: true };
    var writes = [], notes = [];
    var self = {
        busy: false, meta: { cut: { id: '1078' } },
        setBusy: function () {}, render: function () {}, _manualMoveDirty: {},
        notify: function (m, k) { notes.push({ m: m, k: k }); },
        post: function (url, fields) { writes.push({ url: url, fields: fields }); return Promise.resolve({}); },
        reload: function () { return Promise.resolve(); }
    };
    return Controller.prototype.moveCutInDay.call(self, [a, b], 0, 1).then(function (res) {
        assert(res === true, '#4392: moveCutInDay при двух зафиксированных вернул true (перестановка выполнена)');
        assert(!notes.some(function (n) { return /нельзя переставить/i.test(n.m); }),
            '#4392: НЕТ отказа «Зафиксированное задание нельзя переставить»');
        assertEqual(writes.length, 2, '#4392: записаны оба обмена planStart (_m_save × 2)');
        var byCut = {}; writes.forEach(function (w) { var id = w.url.match(/_m_save\/([^?]+)/)[1]; byCut[id] = w.fields.t1078; });
        assertEqual([byCut.A, byCut.B], ['2000', '1000'], '#4392: A↔B обменялись planStart (A→2000, B→1000)');
    });
})().then(function () {
    console.log('\n' + passed + '/' + total + ' проверок прошло');
    if (passed !== total) process.exitCode = 1;
}).catch(function (e) { console.error(e); process.exitCode = 1; });
