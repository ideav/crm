// #4808 — пульт слиттера понимает нужный день из адреса: `slitter?date=20260823`.
// ВРЕМЕННЫЙ тестовый вход: с #4783 п.4 выбора дня в пульте нет, день всегда текущий
// календарный, а на стенде надо открыть тот день, на который разложены тестовые задания.
//
// Что проверяем:
//   1. разбор параметра — YYYYMMDD (формат из тикета) и ISO; мусор и несуществующая
//      дата (20260231) день не подменяют — пульт остаётся на сегодня;
//   2. контроллер берёт день из адреса, а без параметра — сегодняшний;
//   3. подмена ВИДНА в шапке страницы: тестовый день нельзя перепутать с настоящим;
//   4. ГЛАВНОЕ: в базу по-прежнему пишется РЕАЛЬНОЕ время (#4348), а не выбранный день.
//      Иначе тестовый параметр в адресе испортил бы боевые «Начато»/«Закончено».
//
// Run with: node experiments/atex-slitter-4808-date-query.test.js

process.env.TZ = 'Europe/Moscow';

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
    this.value = '';
    this.disabled = false;
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
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
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
global.window = { db: 'ateh', atexPad: { id: '5', name: 'Планшет №3' }, location: { search: '' } };

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

// ── п.1: разбор параметра ─────────────────────────────────────────────────────────────────────
assertEqual(core.dateFromQuery('?date=20260823'), '2026-08-23',
    '#4808: YYYYMMDD из тикета — «slitter?date=20260823»');
assertEqual(core.dateFromQuery('date=20260823'), '2026-08-23',
    '#4808: строка запроса без «?» разбирается так же');
assertEqual(core.dateFromQuery('/ateh/slitter?date=20260823'), '2026-08-23',
    '#4808: полный адрес тоже принимается');
assertEqual(core.dateFromQuery('?date=2026-08-23'), '2026-08-23',
    '#4808: ISO YYYY-MM-DD — тот же день, записанный иначе');
assertEqual(core.dateFromQuery('?slitter=1277&date=20260823&x=1'), '2026-08-23',
    '#4808: соседние параметры разбору не мешают');

assertEqual(core.dateFromQuery(''), '', '#4808: параметра нет — подмены нет');
assertEqual(core.dateFromQuery('?date='), '', '#4808: пустое значение — подмены нет');
assertEqual(core.dateFromQuery('?date=завтра'), '', '#4808: мусор день не подменяет');
assertEqual(core.dateFromQuery('?date=2026082'), '', '#4808: недобор цифр день не подменяет');
assertEqual(core.dateFromQuery('?dates=20260823'), '', '#4808: похожий по имени параметр не считается');
assertEqual(core.dateFromQuery(null), '', '#4808: пустой вход не роняет разбор');

// Несуществующие даты молча не «переезжают» в соседний месяц.
assertEqual(core.dateFromQuery('?date=20260231'), '', '#4808: 31 февраля — не дата, подмены нет');
assertEqual(core.dateFromQuery('?date=20261345'), '', '#4808: 13-й месяц — не дата, подмены нет');
assertEqual(core.dateFromQuery('?date=20260000'), '', '#4808: нулевые месяц и день — не дата');
// Високосный год — настоящая дата, её пропускаем.
assertEqual(core.dateFromQuery('?date=20240229'), '2024-02-29', '#4808: 29 февраля високосного года — дата');

// ── п.3: подмена видна в шапке ────────────────────────────────────────────────────────────────
assertEqual(core.workspaceTitleParts('Планшет №3', '2026-08-23', 'Станок 1'),
    ['Планшет №3', '23.08.2026', 'Станок 1'],
    '#4808: обычный день в шапке подписан как прежде (#4783 не тронут)');
var marked = core.workspaceTitleParts('Планшет №3', '2026-08-23', 'Станок 1', true);
assertEqual(marked.length, 3, '#4808: подмена не добавляет в шапку лишних частей');
assert(marked[1].indexOf('23.08.2026') === 0 && marked[1].length > '23.08.2026'.length,
    '#4808: у подменённого дня в шапке есть пометка — с настоящим не перепутать');

// ── п.2/п.4: контроллер ───────────────────────────────────────────────────────────────────────
function makeController(search) {
    global.window.location = { search: search };
    var root = new StubNode('div');
    root.setAttribute('data-db', 'ateh');
    root.setAttribute('data-user-id', '462');
    return new Controller(root);
}
var todayISO = core.todayISO();

(function() {
    var inst = makeController('?date=20260823');
    assertEqual(inst.selectedDate, '2026-08-23', '#4808: пульт открылся на дне из адреса');
    assert(inst.dateFromQuery === true, '#4808: пульт знает, что день задан адресом');
})();

(function() {
    var inst = makeController('');
    assertEqual(inst.selectedDate, todayISO, '#4808: без параметра — текущий календарный день');
    assert(inst.dateFromQuery === false, '#4808: без параметра признак подмены снят');
})();

(function() {
    var inst = makeController('?date=20261345');
    assertEqual(inst.selectedDate, todayISO, '#4808: негодная дата — остаёмся на сегодня');
    assert(inst.dateFromQuery === false, '#4808: негодная дата подменой не считается');
})();

// ГЛАВНОЕ (#4348): в базу пишется РЕАЛЬНЫЙ момент, а не выбранный день. Иначе тестовый
// параметр в адресе испортил бы боевые «Начато»/«Закончено» и хронологию событий смены.
(function() {
    var inst = makeController('?date=20260823');
    var stamp = inst.eventDateTime();
    assertEqual(String(stamp).slice(0, 10), todayISO,
        '#4808: отметка времени для записи — СЕГОДНЯШНЯЯ, день из адреса на неё не влияет');
    assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp),
        '#4808: формат отметки времени не изменился');
})();

// Шапка пульта с подменой действительно помечена.
(function() {
    var inst = makeController('?date=20260823');
    inst.slitters = [{ id: '1277', label: 'Станок 1' }];
    inst.selectedSlitterId = '1277';
    navbarSlot.childNodes = [];
    inst.renderWorkspaceTitle();
    // Отрисованная шапка (не исходник): что реально увидит оператор.
    var rendered = navbarSlot.textContent;
    assert(rendered.indexOf('23.08.2026') !== -1, '#4808: шапка показывает день из адреса');
    assert(rendered.indexOf('Станок 1') !== -1, '#4808: станок в шапке остался на месте');
    assert(rendered.indexOf('Планшет №3') !== -1, '#4808: имя планшета в шапке осталось');
    assert(rendered.indexOf('из адреса') !== -1, '#4808: в шапке есть пометка о подменённом дне');
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
