// Tests for ideav/crm#4404 — изменения карточки очереди «Планирование производства»:
//   1) выбранная карточка заметнее — ореол 8px (.atex-pp-cut.is-active);
//   2) title карточки = текст панели «Связанные позиции» (.atex-pp-linked) — заказы и позиции;
//   3) кнопка «🗓 Перенести» обновляет связанные позиции (раньше переносишь одно, а видишь связи
//      другого задания);
//   4) ЛЮБОЕ действие/клик по карточке выбирает её задание.
//
// Причина 3 и 4: кнопки 🔒/🗓/🗑 гасили всплытие (stopPropagation), и bubble-обработчик выбора на
// карточке до них не доходил. Лечится слушателем в фазе ПЕРЕХВАТА — поэтому DOM-стаб здесь честно
// моделирует capture/bubble и stopPropagation, иначе тест ничего не доказывал бы.
//
// Run with: node experiments/atex-pp-4404-card-selection.test.js

// Tests for ideav/crm#4401 — кнопка «↻ Пересчитать наладку»:
//   A) НЕ переставляет задания — пишет только тайминг (три хранимые колонки), planStart не трогает,
//      заданий не создаёт и не удаляет;
//   B) только ЭТОТ станок и только ВИДИМЫЕ дни (диапазон фильтра [С; По]);
//   C) показывается ПО ФАКТУ РАСХОЖДЕНИЯ хранимого тайминга с расчётом по текущему порядку
//      (раньше — по сессионному флагу «двигали задания»: человек мог подвигать и уйти, флаг терялся);
//   D) подтверждения (панель ДО/ПОСЛЕ + «Ок»/«Отменить») больше нет — подтверждать нечего.
//
// Run with: node experiments/atex-pp-4401-recalc-timing-only.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-4396.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, on) { if (on) this.add(c); else this.remove(c); }
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
StubNode.prototype.addEventListener = function(ev, fn, capture) { (this._listeners[ev] = this._listeners[ev] || []).push({ fn: fn, capture: !!capture }); };
// Полноценное распространение: capture сверху вниз, затем обработчики цели, затем bubble вверх.
// stopPropagation в bubble-обработчике кнопки НЕ отменяет уже отработавший capture — ровно это и
// чинит #4404 (выбор задания на карточке слушается в capture).
StubNode.prototype.dispatch = function(ev, e) {
    var target = this, path = [];
    for (var n = target; n; n = n.parentNode) path.push(n);
    var stopped = false;
    var evt = e || {};
    evt.target = evt.target || target;
    evt.stopPropagation = function() { stopped = true; };
    if (!evt.preventDefault) evt.preventDefault = function() {};
    function run(node, capture) {
        ((node._listeners && node._listeners[ev]) || []).forEach(function(l) {
            if (!!l.capture === capture) l.fn(evt);
        });
    }
    for (var i = path.length - 1; i >= 1; i--) { if (stopped) break; run(path[i], true); }
    if (!stopped) { run(target, true); run(target, false); }
    for (var j = 1; j < path.length; j++) { if (stopped) break; run(path[j], false); }
};
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype.focus = function() {}; StubNode.prototype.setSelectionRange = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };
// closest нужен по-настоящему: cutClickSelectsCut через него отличает клики внутри панели полос,
// а без него (typeof !== 'function') гард молча пропускает всё — тест был бы пустым.
StubNode.prototype.closest = function(sel) {
    var cls = sel.replace(/^\./, '');
    for (var n = this; n; n = n.parentNode) { if (n.classList && n.classList.contains(cls)) return n; }
    return null;
};

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var fs = require('fs');
var api = require('../download/atex/js/production-planning.js');
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

// ── 1) Ореол выбранной карточки — 8px ────────────────────────────────────────
(function () {
    var css = fs.readFileSync(__dirname + '/../download/atex/css/production-planning.css', 'utf8');
    var m = /\.atex-pp-cut\.is-active\s*\{[^}]*\}/.exec(css);
    assert(!!m, 'правило .atex-pp-cut.is-active на месте');
    assert(m && /box-shadow:\s*0 0 0 8px rgba\(19, 65, 116, \.15\)/.test(m[0]),
        'ореол выбранной карточки — 8px (было 2px)');
    assert(m && /border-color:\s*var\(--pp-accent\)/.test(m[0]), 'рамка выбранной карточки не потеряна');
})();

// ── Стенд очереди ────────────────────────────────────────────────────────────
var DAY = tsAt(2026, 7, 27, 8, 0);
function cutOf(id, planTs) {
    return { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: '101', label: 'Станок 1' },
        materialId: '500', materialName: 'MW308', winding: 'OUT',
        knifeWidths: [110, 110], knifeCount: 2, plannedRuns: 3, duration: 60, length: 1000,
        startDate: '', endDate: '' };
}
function makeController() {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div'); c.formEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '', dateTo: '', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 1' }];
    c.activeSlitter = '101';
    c.cuts = [cutOf('c1', DAY), cutOf('c2', DAY + 7200)];
    c.positions = [
        { id: 'p1', label: '4242/1 · 600мм * 1000м', qty: 5, orderWidth: 600, length: 1000 },
        { id: 'p2', label: '4243/2 · 330мм * 800м', qty: 3, orderWidth: 330, length: 800 }
    ];
    c.genPositions = c.positions;
    c.supplies = [
        { id: 's1', cutId: 'c1', positionId: 'p1', rolls: 5, orderNo: '4242', dueKey: 20260831 },
        { id: 's2', cutId: 'c1', positionId: 'p2', rolls: 3, orderNo: '4243', dueKey: 20260831 },
        { id: 's3', cutId: 'c2', positionId: 'p2', rolls: 2, orderNo: '4243', dueKey: 20260831 }
    ];
    c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.positionLengthById = { p1: 1000, p2: 800 };
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
    c.meta.cut = { id: '1078', reqs: [] };
    c._notes = []; c.notify = function(m, k) { c._notes.push({ msg: m, kind: k }); };
    c.render = function() {};
    c.openMoveCut = function() { c._openedMove = true; };       // диалог переноса не поднимаем
    c.toggleCutFixed = function() { c._toggledFix = true; };
    c.deleteCut = function() { c._deleted = true; };
    return c;
}
function cardOf(queueEl, cutId) {
    return queueEl._all([]).filter(function(n) {
        return n.classList.contains('atex-pp-cut') && n.dataset && n.dataset.cutId === cutId;
    })[0] || null;
}

// ── 2) title карточки = текст панели «Связанные позиции» ─────────────────────
(function () {
    var c = makeController();
    c.selectedCutId = 'c1';
    c.renderQueue();
    c.renderLink();

    var panelLabels = c.linkEl.querySelectorAll('.atex-pp-linked-label').map(function(n) { return n.textContent; });
    assertEqual(panelLabels.length, 2, 'в панели две связанные позиции задания c1');

    var helperLabels = c.cutLinkedLabels(c.cuts[0]);
    assertEqual(helperLabels, panelLabels, 'cutLinkedLabels даёт РОВНО те же строки, что панель');

    var title = cardOf(c.queueEl, 'c1').getAttribute('title');
    assert(title.indexOf('Связанные позиции (2)') === 0, 'title карточки начинается с заголовка панели');
    panelLabels.forEach(function(lbl, i) {
        assert(title.indexOf(lbl) !== -1, 'в title есть строка позиции №' + (i + 1) + ': ' + lbl);
    });
    assert(title.indexOf('4242') !== -1 && title.indexOf('4243') !== -1, 'в title видны номера заказов');

    // У каждой карточки — СВОЙ список, а не список выбранного задания.
    var title2 = cardOf(c.queueEl, 'c2').getAttribute('title');
    assert(title2.indexOf('Связанные позиции (1)') === 0, 'у второй карточки свой список (1 позиция)');
    assert(title2 !== title, 'title карточек не одинаковый');

    // Задание без связей.
    c.supplies = [];
    c.renderQueue();
    assertEqual(cardOf(c.queueEl, 'c1').getAttribute('title'), 'Связанных позиций нет',
        'без связей title говорит об этом прямо');
})();

// ── 3+4) Любое действие по карточке выбирает её задание ─────────────────────
(function () {
    var c = makeController();
    c.selectedCutId = 'c2';           // выбрано ДРУГОЕ задание
    c.renderQueue();

    var picked = [];
    var origSelect = c.selectCut;
    c.selectCut = function(id) { picked.push(String(id)); return origSelect.call(this, id); };

    var card = cardOf(c.queueEl, 'c1');
    function clickControl(cls) {
        picked.length = 0;
        var btn = card.querySelectorAll(cls)[0];
        assert(!!btn, 'контрол ' + cls + ' есть на карточке');
        if (btn) btn.dispatch('click', { target: btn });
        return picked;
    }

    // Пункт 3 задачи — именно кнопка переноса.
    assertEqual(clickControl('.atex-pp-cut-move'), ['c1'],
        '🗓 «Перенести» выбирает своё задание — связанные позиции больше не от чужого');
    assert(c._openedMove, '🗓 при этом делает свою работу (диалог переноса открыт)');

    // Пункт 4 — любое действие: 🔒, 🗑, ↑↓, «Полосы», клик по самой панели.
    assertEqual(clickControl('.atex-pp-cut-fix'), ['c1'], '🔒 «Зафиксировать» выбирает задание');
    assertEqual(clickControl('.atex-pp-cut-del'), ['c1'], '🗑 «Удалить» выбирает задание');
    assertEqual(clickControl('.atex-pp-strips'), ['c1'], '«Полосы» выбирает задание');
    assertEqual(clickControl('.atex-pp-move'), ['c1'], '↑/↓ выбирает задание');

    picked.length = 0;
    card.dispatch('click', { target: card });
    assertEqual(picked, ['c1'], 'клик по самой панели выбирает задание (как и раньше)');

    // Панель полос — исключение: её внутренние клики карточку не перевыбирают (#3354).
    picked.length = 0;
    var stripPanel = new StubNode('div'); stripPanel.className = 'atex-pp-strip-panel';
    card.appendChild(stripPanel);
    var inner = new StubNode('span'); stripPanel.appendChild(inner);
    inner.dispatch('click', { target: inner });
    assertEqual(picked, [], 'клик внутри панели полос выбор не меняет');
})();

console.log('\n' + passed + '/' + total + ' passed');
