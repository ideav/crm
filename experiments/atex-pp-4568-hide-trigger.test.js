// Tests for ideav/crm#4568 — кнопки, вызвавшие подтверждение, на время подтверждения скрыты.
//
// Симптом (скриншот тикета, форма «Отклонения от плана»): полоска подтверждения встаёт в ТОТ ЖЕ
// ряд, что и кнопки «Урегулировать»/«Закрыть», и делит с ними ширину — кнопки сжимаются в узкие
// высокие столбцы. Плюс на экране оказываются ДВЕ кнопки «Урегулировать»: одна в ряду, вторая в
// полоске, и непонятно, по какой жать.
//
// Правило: пока висит подтверждение, кнопки-инициаторы (прямые дети хоста) скрыты; выбор только
// внутри полоски — «Урегулировать» или «Отмена». Оба выхода возвращают кнопки на место: форма
// остаётся открытой, и без них в ней нечего нажать.
//
// Run with: node experiments/atex-pp-4568-hide-trigger.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-pp-4541-unfreeze-modal.test.js) ──
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
StubNode.prototype.click = function() { var self = this; (this.listeners['click'] || []).forEach(function(fn) { fn({ target: self }); }); };
StubNode.prototype.querySelector = function(sel) {
    var cls = String(sel || '').replace(/^\./, '');
    var hit = walk(this).filter(function(n) { return n !== this && n.classList && n.classList.contains(cls); }, this);
    return hit.length ? hit[0] : null;
};
StubNode.prototype.querySelectorAll = function() { return []; };
function walk(node, out) {
    out = out || [];
    if (!node) return out;
    out.push(node);
    (node.childNodes || []).forEach(function(c) { walk(c, out); });
    return out;
}
function byClass(node, cls) { return walk(node).filter(function(n) { return n.classList && n.classList.contains(cls); }); }
function buttonWithText(node, text) {
    return walk(node).filter(function(n) { return n.tagName === 'BUTTON' && n.textContent === text; })[0] || null;
}
function visible(node) { return !node.style || node.style.display !== 'none'; }

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function makeController() {
    var c = Object.create(Controller.prototype);
    c.root = new StubNode('div');
    c.root.classList.add('atex-pp');
    c.busy = false;
    c.notify = function() {};
    return c;
}

// Ряд кнопок формы «Отклонения»: «Урегулировать» + «Закрыть» (как в openDeviations).
function makeActions(c) {
    var actions = new StubNode('div');
    actions.classList.add('atex-pp-supply-actions');
    var ok = new StubNode('button'); ok.textContent = 'Урегулировать';
    var close = new StubNode('button'); close.textContent = 'Закрыть';
    actions.appendChild(ok); actions.appendChild(close);
    c.root.appendChild(actions);
    return { actions: actions, ok: ok, close: close };
}

// ── 1. Подтверждение показано → кнопки-инициаторы скрыты ─────────────────────────────────────
(function() {
    var c = makeController();
    var f = makeActions(c);
    c.confirmAction('Урегулировать отклонения?', f.actions, [
        { label: 'Урегулировать', warning: true, inline: true, onConfirm: function() {} }
    ]);
    assert(byClass(f.actions, 'atex-pp-confirm-bar').length === 1, '#4568 полоска подтверждения показана');
    assert(!visible(f.ok), '#4568 кнопка «Урегулировать» на время подтверждения СКРЫТА');
    assert(!visible(f.close), '#4568 «Закрыть» тоже скрыта — выбор только внутри полоски');
    var bar = byClass(f.actions, 'atex-pp-confirm-bar')[0];
    var barButtons = walk(bar).filter(function(n) { return n.tagName === 'BUTTON'; });
    assert(barButtons.length === 2, '#4568 в полоске ровно две кнопки: подтвердить и «Отмена»',
        'кнопок=' + barButtons.length);
    assert(barButtons.filter(function(b) { return b.textContent === 'Урегулировать'; }).length === 1,
        '#4568 видимая кнопка «Урегулировать» на экране одна — та, что в полоске');
})();

// ── 2. «Отмена» возвращает кнопки на место ───────────────────────────────────────────────────
(function() {
    var c = makeController();
    var f = makeActions(c);
    var done = 0;
    c.confirmAction('Урегулировать отклонения?', f.actions, [
        { label: 'Урегулировать', warning: true, onConfirm: function() { done++; } }
    ]);
    buttonWithText(byClass(f.actions, 'atex-pp-confirm-bar')[0], 'Отмена').click();
    assert(byClass(f.actions, 'atex-pp-confirm-bar').length === 0, '#4568 «Отмена» убирает полоску');
    assert(visible(f.ok) && visible(f.close),
        '#4568 после «Отмены» кнопки формы снова видны — иначе в открытой форме нечего нажать');
    assert(done === 0, '#4568 «Отмена» действие не выполняет');
})();

// ── 3. Подтверждение тоже возвращает кнопки (форма остаётся открытой) ────────────────────────
(function() {
    var c = makeController();
    var f = makeActions(c);
    var done = 0;
    c.confirmAction('Урегулировать отклонения?', f.actions, [
        { label: 'Урегулировать', warning: true, onConfirm: function() { done++; } }
    ]);
    buttonWithText(byClass(f.actions, 'atex-pp-confirm-bar')[0], 'Урегулировать').click();
    assert(done === 1, '#4568 подтверждение выполняет действие');
    assert(byClass(f.actions, 'atex-pp-confirm-bar').length === 0, '#4568 полоска убрана');
    assert(visible(f.ok) && visible(f.close), '#4568 кнопки формы возвращены и после подтверждения');
})();

// ── 4. Прежний вид кнопки восстанавливается, а не затирается на «пусто» ──────────────────────
(function() {
    var c = makeController();
    var f = makeActions(c);
    f.close.style.display = 'inline-flex';   // у кнопки был СВОЙ display
    c.confirmAction('Урегулировать?', f.actions, [{ label: 'Урегулировать', onConfirm: function() {} }]);
    assert(f.close.style.display === 'none', '#4568 на время подтверждения кнопка скрыта');
    buttonWithText(byClass(f.actions, 'atex-pp-confirm-bar')[0], 'Отмена').click();
    assert(f.close.style.display === 'inline-flex',
        '#4568 возвращаем ПРЕЖНИЙ display, а не пустую строку (иначе кнопка сменила бы вид)');
})();

// ── 5. Хост-карточка задания: вложенные кнопки не трогаем ───────────────────────────────────
(function() {
    var c = makeController();
    var card = new StubNode('div');
    card.classList.add('atex-pp-cut');
    var row = new StubNode('div');            // ряд кнопок карточки — НЕ прямой ребёнок-кнопка
    var del = new StubNode('button'); del.textContent = 'Удалить';
    row.appendChild(del); card.appendChild(row);
    c.root.appendChild(card);
    c.confirmAction('Удалить задание?', card, [{ label: 'Удалить', warning: true, onConfirm: function() {} }]);
    assert(byClass(card, 'atex-pp-confirm-bar').length === 1, '#4568 полоска у карточки показана');
    assert(visible(del), '#4568 кнопки ВНУТРИ карточки не скрываем — прячем только прямых детей хоста');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
