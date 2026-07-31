// Tests for ideav/crm#4541 — «Разморозить день» спрашивает МОДАЛКОЙ, а не полоской в конце страницы.
//
// Симптом: оператор жмёт замок дня, чтобы снять заморозку, — и ничего не происходит. На деле
// подтверждение появлялось: полоска `.atex-pp-confirm-bar` приклеивалась к КОРНЮ рабочего места,
// то есть ниже всей очереди заданий, за пределами экрана.
//
// Корень: `confirmAction` умел показывать модалку только через `window.mainAppController
// .showDeleteConfirmModal`, а глобала с таким именем в приложении нет — `js/main-app.js` держит
// контроллер локальной переменной (`const mainApp = new MainAppController()`). Ветка была мёртвой,
// и любое подтверждение БЕЗ якоря (места рядом с действием) уезжало вниз страницы.
//
// Правило: полоска — когда есть куда встать рядом с действием (карточка задания, панель кнопок);
// нет такого места — модальное окно. «Заморозить день» модалкой спрашивал и раньше — пара
// действий над замком дня теперь выглядит одинаково.
//
// Run with: node experiments/atex-pp-4541-unfreeze-modal.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4428-fill-task.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this.value = ''; this.disabled = false; this.options = [];
    this.parentNode = null; this.listeners = {};
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
StubNode.prototype.appendChild = function(n) { n.parentNode = this; this.childNodes.push(n); return n; };
StubNode.prototype.removeChild = function(n) { n.parentNode = null; this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
StubNode.prototype.click = function() { (this.listeners['click'] || []).forEach(function(fn) { fn({ target: this }); }); };
StubNode.prototype.querySelector = function(sel) {
    var cls = String(sel || '').replace(/^\./, '');
    var hit = walk(this).filter(function(n) { return n !== this && n.classList && n.classList.contains(cls); }, this);
    return hit.length ? hit[0] : null;
};
StubNode.prototype.querySelectorAll = function() { return []; };
function walk(node, out) {
    out = out || [];
    if (!node) return out;   // узла нет (регресс) — проверка должна ПАДАТЬ, а не бросать (#4531)
    out.push(node);
    (node.childNodes || []).forEach(function(c) { walk(c, out); });
    return out;
}
function byClass(node, cls) { return walk(node).filter(function(n) { return n.classList && n.classList.contains(cls); }); }
function buttonWithText(node, text) {
    return walk(node).filter(function(n) { return n.tagName === 'BUTTON' && n.textContent === text; })[0] || null;
}

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/production-planning.js');
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// Контроллер без инициализации: берём только методы подтверждения (DOM у них весь свой).
function makeController(over) {
    var c = Object.create(Controller.prototype);
    c.root = new StubNode('div');
    c.root.classList.add('atex-pp');
    c.busy = false;
    c.notify = function() {};
    Object.keys(over || {}).forEach(function(k) { c[k] = over[k]; });
    return c;
}

// ── 1. Подтверждения без якоря показываются модалкой, а не полоской в конце страницы ─────────
(function() {
    var c = makeController();
    var done = 0;
    c.confirmAction('Точно?', c.root, [{ label: 'Разморозить', onConfirm: function() { done++; } }]);
    var modals = byClass(c.root, 'atex-pp-confirm-modal');
    var bars = byClass(c.root, 'atex-pp-confirm-bar');
    assert(modals.length === 1, '#4541 якорь = весь экран → показываем модалку', 'модалок=' + modals.length);
    assert(bars.length === 0, '#4541 полоски в конце рабочего места больше нет', 'полосок=' + bars.length);
    assert(!!modals[0] && modals[0].classList.contains('is-open'), '#4541 модалка открыта (класс is-open)');
    assert(done === 0, '#4541 без нажатия кнопки действие не выполняется');
})();

(function() {
    var c = makeController();
    var done = 0;
    c.confirmAction('Точно?', null, [{ label: 'Удалить', onConfirm: function() { done++; } }]);
    assert(byClass(c.root, 'atex-pp-confirm-modal').length === 1,
        '#4541 якоря нет вовсе (и панели кнопок нет) → модалка, а не молчаливое выполнение');
    assert(done === 0, '#4541 действие без подтверждения НЕ выполняется (прежняя ветка «места нет → делаем» убрана)');
})();

// ── 2. Якорь есть — поведение прежнее: полоска рядом с действием ─────────────────────────────
(function() {
    var c = makeController();
    var card = new StubNode('div');
    card.classList.add('atex-pp-cut');
    c.root.appendChild(card);
    c.confirmAction('Удалить задание?', card, [{ label: 'Удалить', warning: true, onConfirm: function() {} }]);
    assert(byClass(card, 'atex-pp-confirm-bar').length === 1,
        '#4541 у карточки задания подтверждение остаётся полоской НА МЕСТЕ');
    assert(byClass(c.root, 'atex-pp-confirm-modal').length === 0, '#4541 модалку при этом не открываем');
})();

(function() {
    var c = makeController();
    var panel = new StubNode('div');
    panel.classList.add('atex-pp-panel-actions');
    c.root.appendChild(panel);
    c.confirmAction('Сгенерировать?', null, [{ label: 'Сгенерировать', onConfirm: function() {} }]);
    assert(byClass(panel, 'atex-pp-confirm-bar').length === 1,
        '#4541 панель кнопок — законный якорь: полоска встаёт в неё');
})();

// ── 3. Кнопки модалки: действие выполняется, окно закрывается, «Отмена» ничего не делает ─────
(function() {
    var c = makeController();
    var done = 0;
    // Метода нет — говорим об этом проверкой, а не исключением: упавший исключением тест прячет
    // за собой все следующие (#4531).
    assert(typeof c.confirmModal === 'function', '#4541 у контроллера есть confirmModal');
    if (typeof c.confirmModal !== 'function') return;
    c.confirmModal('Планирование снова сможет менять задания этого дня.',
        [{ label: 'Разморозить', onConfirm: function() { done++; } }], null,
        { title: 'Разморозить день 30.07.2026?' });
    var modal = byClass(c.root, 'atex-pp-confirm-modal')[0];
    assert(!!modal, '#4541 confirmModal открыл окно');
    var title = byClass(modal, 'atex-pp-form-title')[0];
    assert(title && title.textContent === 'Разморозить день 30.07.2026?',
        '#4541 заголовок окна называет день', title && title.textContent);
    var ok = modal ? buttonWithText(modal, 'Разморозить') : null;
    var cancel = modal ? buttonWithText(modal, 'Отмена') : null;
    assert(!!ok && !!cancel, '#4541 в окне есть кнопка действия и «Отмена»');
    assert(!!ok && ok.classList.contains('atex-pp-btn-primary'),
        '#4541 кнопка действия — главная (её же жмёт Ctrl+Enter по правилам UI)');
    if (cancel) cancel.click();
    assert(byClass(c.root, 'atex-pp-confirm-modal').length === 0, '#4541 «Отмена» закрывает окно');
    assert(done === 0, '#4541 «Отмена» действие не выполняет');
})();

(function() {
    var c = makeController();
    var done = 0;
    if (typeof c.confirmModal !== 'function') return;
    c.confirmModal('Точно?', [{ label: 'Разморозить', onConfirm: function() { done++; } }]);
    var modal = byClass(c.root, 'atex-pp-confirm-modal')[0];
    var okBtn = modal ? buttonWithText(modal, 'Разморозить') : null;
    if (okBtn) okBtn.click();
    assert(done === 1, '#4541 нажатие кнопки выполняет действие');
    assert(byClass(c.root, 'atex-pp-confirm-modal').length === 0, '#4541 после действия окно закрывается');
})();

// ── 4. «Разморозить день» проходит именно этим путём ─────────────────────────────────────────
(function() {
    var deleted = [];
    var c = makeController({
        meta: { freeze: { id: '9001', val: 'Заморозка', reqs: [{ id: '9002', val: 'Примечание' }] } },
        post: function(url) { deleted.push(url); return Promise.resolve({}); },
        loadFreeze: function() { return Promise.resolve(); },
        setBusy: function() {},
        render: function() {}
    });
    var dayMs = new Date(2026, 6, 30, 0, 0, 0).getTime();
    c.openFreezeDay(dayMs, { id: '777', notes: 'инвентаризация' });
    var modal = byClass(c.root, 'atex-pp-confirm-modal')[0];
    assert(!!modal, '#4541 «Разморозить день» спрашивает модалкой');
    assert(byClass(c.root, 'atex-pp-confirm-bar').length === 0,
        '#4541 полоска подтверждения при разморозке не создаётся');
    var title = byClass(modal, 'atex-pp-form-title')[0];
    assert(!!title && /30\.07\.2026/.test(title.textContent), '#4541 в заголовке — дата дня', title && title.textContent);
    var unfreezeBtn = modal ? buttonWithText(modal, 'Разморозить') : null;
    if (unfreezeBtn) unfreezeBtn.click();
    assert(deleted.length === 1 && /_m_del\/777/.test(deleted[0]),
        '#4541 по кнопке удаляется запись заморозки этого дня', JSON.stringify(deleted));
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
