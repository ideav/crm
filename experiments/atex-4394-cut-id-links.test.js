// Tests for ideav/crm#4394 — id задания видно в интерфейсе планирования.
// Покрываем:
//   1) очередь «Планирования производства» (renderQueue на DOM-стабе, как
//      atex-production-planning-4381.test.js):
//      • .atex-pp-cut-seq — ссылка <a href="/{db}/edit_obj/{id}" target="_blank">,
//        подпись «№ N» и вид (класс) прежние;
//      • .atex-pp-cut-time — title содержит «id {id}»;
//   2) Гант (cutBarTitle): первая строка тултипа несёт id задания, а когда «номера»
//      нет — вырождается в «#id» без дубля.
//
// Run with: node experiments/atex-4394-cut-id-links.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-4381.test.js) ──
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

var Controller = require('../download/atex/js/production-planning.js').Controller;
var gantt = require('../download/atex/js/cut-gantt.js').gantt;

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

// ── 1) Карточка очереди: номер — ссылка на edit_obj, время — с id в тултипе ───
function cutOf(id, planTs) {
    return { id: id, number: String(planTs), slitter: { id: '101', label: 'Станок 3' },
        materialName: 'MW308', materialId: '500', winding: 'OUT', knifeWidths: [110], knifeCount: 1,
        plannedRuns: 1, length: 1000, orderId: '4242', planDate: planTs, startDate: '', endDate: '' };
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

(function () {
    var c = makeController([cutOf('12345', tsAt(2026, 7, 24, 8, 0)), cutOf('777', tsAt(2026, 7, 24, 12, 0))]);
    c.renderQueue();

    var card = cardOf(c.queueEl, '12345');
    assert(!!card, 'карточка задания 12345 отрисована');
    var seq = card && card.querySelector('.atex-pp-cut-seq');
    assert(!!seq, '.atex-pp-cut-seq на месте');
    assertEqual(seq && seq.tagName, 'A', 'номер задания — ссылка <a>, а не <span>');
    assertEqual(seq && seq.getAttribute('href'), '/testdb/edit_obj/12345',
        'href ведёт на форму правки задания: /{db}/edit_obj/{id}');
    assertEqual(seq && seq.getAttribute('target'), '_blank', 'открывается в новой вкладке');
    assertEqual(seq && seq.getAttribute('rel'), 'noopener', 'rel=noopener');
    assertEqual(seq && seq.getAttribute('draggable'), 'false',
        'draggable=false — нативный drag ссылки не перебивает перетаскивание карточки (#4306)');
    assertEqual(seq && seq.textContent, '№ 1', 'подпись прежняя — «№ {позиция в дне}», не id');
    assert(seq && String(seq.getAttribute('title')).indexOf('id 12345') !== -1,
        'title ссылки подсказывает id задания');

    // Второе задание того же дня — своя ссылка, свой id (не «прилипает» первый).
    var seq2 = cardOf(c.queueEl, '777').querySelector('.atex-pp-cut-seq');
    assertEqual(seq2.getAttribute('href'), '/testdb/edit_obj/777', 'у второй карточки — свой id в href');
    assertEqual(seq2.textContent, '№ 2', 'нумерация в дне продолжается (№ 2)');

    // .atex-pp-cut-time — id в тултипе (первая часть #4394).
    var timeEl = card.querySelector('.atex-pp-cut-time');
    assert(!!timeEl, '.atex-pp-cut-time на месте');
    assert(timeEl && String(timeEl.getAttribute('title')).indexOf('id 12345') !== -1,
        'title строки времени содержит «id {id}»');
    assert(timeEl && String(timeEl.getAttribute('title')).indexOf('Показать тайминг резки') === 0,
        'прежняя подсказка «Показать тайминг резки» осталась первой');
})();

// ── 2) Гант: id задания в тултипе бара ───────────────────────────────────────
(function () {
    var status = { key: 'planned', label: 'Запланировано' };
    var withNumber = gantt.cutBarTitle({ id: '12345', number: String(tsAt(2026, 7, 24, 8, 0)) }, {}, status);
    var head = withNumber.split('\n')[0];
    assert(head.indexOf('id 12345') !== -1, 'Гант: тултип бара несёт id задания');
    assert(head.indexOf('Задание ') === 0, 'Гант: строка по-прежнему начинается с «Задание …»');

    // Номера нет → подпись и так «#id», второй раз id не пишем.
    var noNumber = gantt.cutBarTitle({ id: '777', number: '' }, {}, status).split('\n')[0];
    assertEqual(noNumber, 'Задание #777', 'Гант: без «номера» — просто «Задание #id», без дубля');

    // Не роняемся на пустом задании.
    assertEqual(gantt.cutBarTitle(null, {}, status).split('\n')[0], 'Задание #', 'Гант: cut=null не роняет тултип');
})();

console.log('\n' + passed + '/' + total + ' passed');
