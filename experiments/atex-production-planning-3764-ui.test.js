// UI smoke test for #3764 — модалка «Отпуск» (окна простоя станка) поверх лёгкого DOM-стаба
// (без jsdom, как issue-3411-search.test.js). Прогоняет НАСТОЯЩИЕ renderDowntimeTable /
// persistDowntimeRow / deleteDowntimeRow и проверяет:
//   • таблица рисует строки окон простоя + кнопку «+ Отпуск»;
//   • «+ Отпуск» добавляет пустую строку;
//   • правка НОВОЙ строки создаёт запись (_m_new …&up=slitter, главное значение = начало);
//   • правка существующей строки пишет начало через _m_save (t{tableId}), реквизиты — _m_set;
//   • «Окончание ≤ начала» — не пишем, уведомляем;
//   • удаление строки шлёт _m_del.
//
// Run with: node experiments/atex-production-planning-3764-ui.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб ──
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
Object.defineProperty(StubNode.prototype, 'firstChild', { get: function() { return this.childNodes[0] || null; } });
StubNode.prototype.appendChild = function(node) { this.childNodes.push(node); node.parentNode = this; return node; };
StubNode.prototype.removeChild = function(node) { this.childNodes = this.childNodes.filter(function(c) { return c !== node; }); return node; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype.dispatch = function(ev, e) { (this._listeners[ev] || []).forEach(function(fn) { fn(e || {}); }); };
StubNode.prototype.click = function() { this.dispatch('click', { target: this }); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;
var planning = api.planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Контроллер с метаданными «Отпуска» и стабом post ──
var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
var c = new Controller(root);
c.meta.downtime = { id: '700', val: 'Отпуск', reqs: [
    { id: '701', val: 'Окончание' }, { id: '702', val: 'Примечания' }
] };
c.downtimeActiveSlitter = { id: '101', label: 'Слиттер №1' };
c.downtimeModalBodyEl = new StubNode('div');
c.downtimeModalTitleEl = new StubNode('h2');

var START = Date.UTC(2026, 5, 27, 9, 0, 0) / 1000;
var END = Date.UTC(2026, 5, 27, 12, 0, 0) / 1000;
c.downtimesBySlitter = { '101': [{ id: '9', start: START, end: END, notes: 'ТО' }] };

var posts = [];
c.post = function(path, params) { posts.push({ path: path, params: params }); return Promise.resolve({ obj: '42' }); };
var notices = [];
c.notify = function(msg, kind) { notices.push({ msg: msg, kind: kind }); };

(async function run() {
    // ── 1) openDowntime — заголовок + таблица ──
    c.openDowntime();
    assert(/Слиттер №1/.test(c.downtimeModalTitleEl.textContent), '#3764-ui: заголовок модалки содержит имя станка');
    var table = c.downtimeModalBodyEl.querySelector('.atex-pp-dt-table');
    assert(!!table, '#3764-ui: таблица отпусков отрисована');
    function dtRows() {
        return c.downtimeModalBodyEl.querySelectorAll('.atex-pp-dt-row').filter(function(r) { return !r.classList.contains('atex-pp-dt-head'); });
    }
    var dataRows = dtRows();
    assert(dataRows.length === 1, '#3764-ui: одна строка существующего окна простоя');
    var startInput = dataRows[0].childNodes[0];
    assert(startInput.value === planning.unixToDatetimeLocal(START), '#3764-ui: поле «Начало» предзаполнено из unix-сек');
    var addBtn = c.downtimeModalBodyEl.querySelector('.atex-pp-dt-add');
    assert(!!addBtn, '#3764-ui: кнопка «+ Отпуск» присутствует');

    // ── 2) «+ Отпуск» добавляет пустую строку (в конец) ──
    addBtn.click();
    var rowsNow = dtRows();
    assert(rowsNow.length === 2, '#3764-ui: после «+ Отпуск» — две строки');

    // ── 3) Быстрая правка трёх полей НОВОЙ строки → РОВНО ОДИН _m_new (без дублей) ──
    var newRowModel = c.downtimesBySlitter['101'][c.downtimesBySlitter['101'].length - 1];
    var newRow = rowsNow[1];
    var nStart = newRow.childNodes[0], nEnd = newRow.childNodes[1], nNotes = newRow.childNodes[2];
    nStart.value = '2026-06-28T08:00'; nStart.dispatch('change');
    nEnd.value = '2026-06-28T10:00'; nEnd.dispatch('change');
    nNotes.value = 'профилактика'; nNotes.dispatch('change');
    await newRowModel._save;   // дождаться сериализованной цепочки записей
    var creates = posts.filter(function(p) { return /^_m_new\/700\?/.test(p.path); });
    assert(creates.length === 1, '#3764-ui: быстрая правка нескольких полей новой строки → РОВНО один _m_new (нет дублей)');
    assert(/up=101/.test(creates[0].path), '#3764-ui: _m_new c up=101 (подчинение станку)');
    assert(creates[0].params.t700 === String(planning.datetimeLocalToUnix('2026-06-28T08:00')), '#3764-ui: главное значение t700 = начало (unix-сек)');
    assert(creates[0].params.t701 === String(planning.datetimeLocalToUnix('2026-06-28T10:00')), '#3764-ui: реквизит t701 = «Окончание»');
    assert(newRowModel.id === '42', '#3764-ui: id новой строки проставлен из ответа сервера');

    // ── 4) Правка существующей строки → _m_save (главное значение) + _m_set (реквизиты) ──
    posts.length = 0;
    var existing = c.downtimesBySlitter['101'].filter(function(r) { return r.id === '9'; })[0];
    startInput.value = '2026-06-27T07:30'; startInput.dispatch('change');
    await existing._save;
    var saves = posts.filter(function(p) { return p.path === '_m_save/9?JSON'; });
    assert(saves.length === 1 && saves[0].params.t700 === String(planning.datetimeLocalToUnix('2026-06-27T07:30')),
        '#3764-ui: правка начала существующей строки → _m_save/9 с t700');

    // ── 5) «Окончание ≤ начала» — не пишем, уведомляем ──
    posts.length = 0; notices.length = 0;
    existing.end = existing.start - 3600;   // конец раньше начала
    await c.persistDowntimeRow('101', existing);
    assert(posts.length === 0 && notices.length === 1, '#3764-ui: окончание ≤ начала — запись отклонена с уведомлением');

    // ── 6) Удаление строки → _m_del ──
    posts.length = 0;
    await c.deleteDowntimeRow('101', { id: '9' });
    assert(posts.some(function(p) { return /^_m_del\/9\?/.test(p.path); }), '#3764-ui: удаление шлёт _m_del/9');

    // id=null (не сохранённая) — без обращения к серверу
    posts.length = 0;
    await c.deleteDowntimeRow('101', { id: null });
    assert(posts.length === 0, '#3764-ui: удаление не сохранённой строки не дёргает сервер');

    console.log('\n' + passed + ' assertions passed');
})();
