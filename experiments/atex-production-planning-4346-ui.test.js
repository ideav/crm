// UI smoke test for #4346 — кнопка «Отклонения N/M» и её форма. Поверх лёгкого DOM-стаба
// (как atex-cut-gantt-3875-ui.test.js): проверяем подпись/видимость кнопки и что форма
// собирается из двух групп со списком всех отклонившихся заданий и кнопками
// «Урегулировать» / «Закрыть». Саму запись в БД здесь не трогаем — её вход (что и куда
// переносим) покрыт чистыми функциями в atex-production-planning-4346.test.js.
//
// Run with: node experiments/atex-production-planning-4346-ui.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб ──
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
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = { createElement: function(tag) { return new StubNode(tag); } };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    assert(JSON.stringify(actual) === JSON.stringify(expected),
        name + (JSON.stringify(actual) === JSON.stringify(expected) ? '' :
            ' (ожидали ' + JSON.stringify(expected) + ', получили ' + JSON.stringify(actual) + ')'));
}

var DAY = 86400;
var now = Math.floor(Date.UTC(2026, 6, 24, 11, 0) / 1000);   // 24.07.2026 11:00 — «сейчас»

// 2 просроченных (план в прошлом, не выполнены) + 1 выполненное досрочно + фон.
var cuts = [
    { id: '11', slitter: { id: '1', label: 'Станок 1' }, materialName: 'БОПП 30', number: String(now - 2 * DAY), planDate: String(now - 2 * DAY), endDate: '' },
    { id: '12', slitter: { id: '1', label: 'Станок 1' }, materialName: 'БОПП 30', number: String(now - 1 * DAY), planDate: String(now - 1 * DAY), endDate: '' },
    { id: '13', slitter: { id: '2', label: 'Станок 2' }, materialName: 'ПЭТ 12', number: String(now + 3 * DAY), planDate: String(now + 3 * DAY), endDate: String(now - 1 * DAY) },
    { id: '14', slitter: { id: '2', label: 'Станок 2' }, materialName: 'ПЭТ 12', number: String(now + 1 * DAY), planDate: String(now + 1 * DAY), endDate: '' }
];

function makeController(cutList) {
    var inst = Object.create(Controller.prototype);
    inst.meta = {};
    inst.root = new StubNode('div');
    inst.cuts = cutList;
    inst.devBtn = new StubNode('button');
    inst.nowMs = function() { return now * 1000; };
    inst.notified = [];
    inst.notify = function(msg, kind) { inst.notified.push([kind, msg]); };
    return inst;
}

// ── Кнопка ────────────────────────────────────────────────────────────────────
var c = makeController(cuts);
c.updateDeviationsButton();
assertEqual(c.devBtn.textContent, 'Отклонения 2/1', 'подпись кнопки — N просроченных / M досрочных');
assertEqual(c.devBtn.style.display, '', 'есть отклонения — кнопка видна');
assert(/Просрочено — 2/.test(c.devBtn.title) && /досрочно — 1/.test(c.devBtn.title), 'подсказка расшифровывает N и M');

var clean = makeController([cuts[3]]);   // только будущее незавершённое задание
clean.updateDeviationsButton();
assertEqual(clean.devBtn.style.display, 'none', 'нет отклонений — кнопки нет');

// ── Форма ─────────────────────────────────────────────────────────────────────
c.openDeviations();
var modal = c.root.querySelector('.atex-pp-dev-modal');
assert(!!modal, 'форма отклонений добавлена в корень РМ');
assertEqual(c.root.querySelectorAll('.atex-pp-dev-group').length, 2, 'две группы: просрочено и выполнено досрочно');
assert(!!c.root.querySelector('.atex-pp-dev-overdue') && !!c.root.querySelector('.atex-pp-dev-early'),
    'группы различимы по классу (просроченная подсвечивается красным)');
assertEqual(c.root.querySelectorAll('.atex-pp-dev-item').length, 3, 'в списке все отклонившиеся задания (2 + 1)');

var titles = c.root.querySelectorAll('.atex-pp-dev-group-title').map(function(n) { return n.textContent; });
assertEqual(titles, ['Просрочено — 2', 'Выполнено досрочно — 1'], 'заголовки групп несут количество');

var items = c.root.querySelectorAll('.atex-pp-dev-item').map(function(n) { return n.textContent; });
assert(items[0].indexOf('Станок 1') >= 0 && items[0].indexOf('БОПП 30') >= 0, 'строка задания несёт станок и сырьё');
assert(items.filter(function(t) { return /не выполнено/.test(t); }).length === 2, 'просроченные помечены «не выполнено»');
assert(items.filter(function(t) { return /выполнено 23\.07\.2026/.test(t); }).length === 1, 'у досрочного показан день фактического выполнения');

var btnLabels = c.root.querySelectorAll('.atex-pp-btn').map(function(n) { return n.textContent; });
assert(btnLabels.indexOf('Урегулировать') >= 0 && btnLabels.indexOf('Закрыть') >= 0, 'в форме есть «Урегулировать» и «Закрыть»');

// Без отклонений форму не открываем — сообщаем и выходим.
clean.openDeviations();
assert(!clean.root.querySelector('.atex-pp-dev-modal'), 'нет отклонений — форма не открывается');
assertEqual(clean.notified, [['info', 'Отклонений нет']], 'вместо пустой формы — сообщение');

console.log('\n' + passed + '/' + total + ' passed');
