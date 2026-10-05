// #5078 — в шапке пульта слиттера (.navbar-workspace) идут часы сервера:
// «{планшет} · {дата} · {ЧЧ:ММ:СС} · {станок}».
//   1) время — СЕРВЕРНОЕ, московское (#5075): часы устройства + сдвиг по заголовку `Date`;
//      пояс и часы планшета не в счёт;
//   2) часы ИДУТ: обновляется только их надпись, остальная шапка (кнопка станка) не
//      перерисовывается; следующий тик ставится на границу секунды;
//   3) повторная отрисовка шапки не плодит таймеры — прежний снимается.
//
// Run with: node experiments/atex-slitter-5078-nav-clock.test.js

// Устройство в чужом поясе: по Лос-Анджелесу этот момент — ещё 04.10.2026.
process.env.TZ = 'America/Los_Angeles';

var SERVER_MS = 1791176243 * 1000;               // 05.10.2026 07:57:23 МСК = 04:57:23 UTC
var DEVICE_SKEW_MS = -10 * 3600 * 1000;          // часы планшета отстают на 10 ч
var deviceNow = SERVER_MS + DEVICE_SKEW_MS;
Date.now = function() { return deviceNow; };

// ── Минимальный DOM-стаб (как в atex-slitter-4783.test.js) ────────────────────────────────────
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._className = '';
    this._text = '';
    this._listeners = {};
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; }
    };
}
StubNode.prototype._classes = function() { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', {
    get: function() { return this._className; }, set: function(v) { this._className = String(v || ''); }
});
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function() { if (this.childNodes.length) return this.childNodes.map(function(c) { return c.textContent; }).join(''); return this._text; },
    set: function(v) { this._text = String(v == null ? '' : v); this.childNodes = []; }
});
Object.defineProperty(StubNode.prototype, 'innerHTML', {
    get: function() { return ''; }, set: function() { this.childNodes = []; this._text = ''; }
});
StubNode.prototype.appendChild = function(node) { this.childNodes.push(node); node.parentNode = this; return node; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

var navbarSlot = new StubNode('div');
navbarSlot.classList.add('navbar-workspace');
global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function(sel) { return sel === '.navbar-workspace' ? navbarSlot : null; }
};
global.window = { db: 'ateh', atexPad: { id: '5', name: 'Планшет №3' } };

// Таймеры — ручные: тик вызывает сам тест, «прошедшее время» двигает deviceNow.
var timers = [];
global.setTimeout = function(fn, ms) { var t = { fn: fn, ms: ms, cleared: false }; timers.push(t); return t; };
global.clearTimeout = function(t) { if (t) t.cleared = true; };
function liveTimers() { return timers.filter(function(t) { return !t.cleared && !t.fired; }); }
function fire(t) { t.fired = true; t.fn(); }

var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

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
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// Сдвиг часов устройства — как его выставляет getJson/post по заголовку Date ответа.
core.noteServerDate(new Date(SERVER_MS).toUTCString(), deviceNow);

function makeInst() {
    var inst = Object.create(Controller.prototype);
    inst.selectedDate = '2026-10-05';
    inst.selectedSlitterId = '1';
    inst.slitters = [{ id: '1', label: 'Станок 1' }];
    inst.chooseSlitter = function() {};
    return inst;
}

var inst = makeInst();
navbarSlot.childNodes = [];
inst.renderWorkspaceTitle();
var texts = navbarSlot.childNodes.map(function(n) { return n.textContent; });
assertEqual(texts, ['Планшет №3', '·', '05.10.2026', '·', '07:57:23', '·', 'Станок 1'],
    '#5078: в шапке — «планшет · дата · время сервера · станок»');

var clock = navbarSlot.querySelector('.atex-sl-nav-clock');
assert(!!clock && clock.classList.contains('atex-sl-nav-part'),
    '#5078: часы — часть шапки .atex-sl-nav-part (отдельный узел .atex-sl-nav-clock)');
assertEqual(clock && clock.textContent, '07:57:23',
    '#5078: время московское по серверу, а не по часам/поясу планшета (там 14:57 прошлых суток)');

assertEqual(liveTimers().length, 1, '#5078: часы запущены — стоит один таймер');

// Прошло 61,4 с: тик обновляет только надпись часов.
var button = navbarSlot.querySelector('.atex-sl-nav-slitter');
deviceNow += 61400;
fire(liveTimers()[0]);
assertEqual(clock.textContent, '07:58:24', '#5078: часы идут — после тика показано новое время');
assert(navbarSlot.querySelector('.atex-sl-nav-slitter') === button && navbarSlot.querySelector('.atex-sl-nav-clock') === clock,
    '#5078: тик не перерисовывает шапку — кнопка станка та же');
var next = liveTimers();
assertEqual(next.length, 1, '#5078: после тика поставлен следующий — ровно один');
assertEqual(next[0] && next[0].ms, 600, '#5078: следующий тик — на границе серверной секунды (через 600 мс)');

// Сервер ответил новым Date — часы подхватывают уточнённый сдвиг на ближайшем тике.
core.noteServerDate(new Date(SERVER_MS + 3600 * 1000).toUTCString(), deviceNow);
fire(next[0]);
assertEqual(clock.textContent, '08:57:23', '#5078: часы следуют за сдвигом, измеренным по ответам сервера');

// Повторная отрисовка шапки (сменили станок) — таймер прежних часов снимается.
navbarSlot.childNodes = [];
inst.renderWorkspaceTitle();
assertEqual(liveTimers().length, 1, '#5078: перерисовка шапки не плодит таймеры');
assert(navbarSlot.querySelector('.atex-sl-nav-clock') !== clock, '#5078: идут новые часы, а не снятые');

// Формат часов — чистая функция ядра.
assertEqual(core.formatClockSeconds(SERVER_MS), '07:57:23', '#5078: «ЧЧ:ММ:СС» по Москве');
assertEqual(core.formatClockSeconds(Date.UTC(2026, 9, 4, 21, 5, 9)), '00:05:09',
    '#5078: после полуночи по Москве — 00:05:09 (UTC ещё прошлые сутки)');

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
