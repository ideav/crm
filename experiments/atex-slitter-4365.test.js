// #4365 — пульт слиттера: задания следующих дней (секция .atex-sl-future-head) пропадали
// после выполнения. Оператор доделал задание завтрашнего дня — оно исчезло из сайдбара, а
// когда следующего ожидающего не было, исчезала и вся секция: сделанного не видно.
//
// Корень: секция знала только `core.nextFutureCut` — ближайшее НЕзавершённое задание будущих
// дней (буквально #4332 п.4 «отображать одно следующее задание»). Завершённое под фильтр
// `isDone` не проходило и из списка выпадало.
//
// Фикс: `core.futureCutsVisible` — ВСЕ выполненные задания будущих дней (не пропадают) плюс
// ОДНО ближайшее ожидающее (#4332 п.4 сохранён). Ожидающее предлагаем только когда в выбранном
// дне не осталось открытых заданий; выполненные видны всегда, в т.ч. при закрытой смене
// (#4332 п.1). Задания сгруппированы по дню, у каждой группы — заголовок с датой.
//
// Run with: node experiments/atex-slitter-4365.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (без jsdom, как atex-slitter-4362.test.js) ────────────────────────────
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
StubNode.prototype.appendChild = function(node) { this.childNodes.push(node); node.parentNode = this; return node; };
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
global.window = { db: 'ateh' };

var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var DAY = '2026-07-23', D24 = '2026-07-24', D25 = '2026-07-25';
function stamp(dayISO, hhmm) { return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000)); }
function cut(id, dayISO, hhmm, status) {
    return { id: id, slitterId: 'm2', planDate: stamp(dayISO, hhmm), status: status,
             material: 'MR194', winding: 'OUT', runLength: 450, plannedRuns: 3 };
}

// ── core.futureCutsVisible — чистая функция ────────────────────────────────────────────────────
var pool = [
    cut('1', DAY, '08:00', 'Завершена'),          // выбранный день — не «будущий»
    cut('9', D24, '08:00', 'Завершена'),          // сделано оператором → ОСТАЁТСЯ в списке
    cut('10', D24, '10:00', 'Ожидает'),           // ближайшее ожидающее → «следующее»
    cut('11', D24, '12:00', 'Ожидает'),           // остальные ожидающие не показываем (#4332 п.4)
    cut('12', D25, '08:00', 'Пропущена'),         // терминальный статус — тоже «сделано»
    { id: '13', slitterId: 'other', planDate: stamp(D24, '09:00'), status: 'Ожидает' }  // чужой станок
];
var res = core.futureCutsVisible(pool, { slitterId: 'm2', afterDateKey: core.dateKey(DAY) });
assert(res.cuts.map(function(c) { return c.id; }).join(',') === '9,10,12',
    '#4365: в секции — выполненные будущих дней + ОДНО ближайшее ожидающее, по хронологии');
assert(res.nextId === '10', '#4365: «следующее задание» — ближайшее ожидающее (10)');
assert(res.nextDayKey === core.dateKey(D24), '#4365: день «следующего задания» — 24.07');

var noNext = core.futureCutsVisible(pool, { slitterId: 'm2', afterDateKey: core.dateKey(DAY), withNext: false });
assert(noNext.cuts.map(function(c) { return c.id; }).join(',') === '9,12',
    '#4332 п.4: пока в дне есть открытое задание, ожидающее не предлагаем — но выполненные видны');
assert(noNext.nextId === null, '#4332 п.4: без предложения следующего nextId пуст');

var allDone = core.futureCutsVisible([cut('9', D24, '08:00', 'Завершена')],
    { slitterId: 'm2', afterDateKey: core.dateKey(DAY) });
assert(allDone.cuts.length === 1 && allDone.nextId === null,
    '#4365: следующего нет, а выполненное задание будущего дня в списке ОСТАЁТСЯ');

assert(core.futureCutsVisible([], { slitterId: 'm2', afterDateKey: core.dateKey(DAY) }).cuts.length === 0,
    '#4365: будущих заданий нет → секции нет');

// ── сайдбар: сцена тикета ──────────────────────────────────────────────────────────────────────
function makeInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.selectedSlitterId = 'm2';
    inst.selectedDate = DAY;
    inst.shiftEvents = [];
    inst.batches = [];
    inst.cuts = o.cuts || [
        cut('1', DAY, '08:00', 'Завершена'),
        cut('2', DAY, '10:00', 'Завершена'),
        cut('9', D24, '08:00', 'Завершена'),   // оператор доделал завтрашнее
        cut('10', D24, '10:00', 'Ожидает')     // и получил следующее
    ];
    inst.isShiftOpen = function() { return o.shiftOpen === false ? false : true; };
    inst.findBatch = function() { return null; };
    inst.currentCutId = o.currentCutId || null;
    inst.cutsEl = new StubNode('div');
    inst.sidebarTitleEl = new StubNode('div');
    return inst;
}
function render(inst) {
    inst.renderCuts();
    return {
        heads: inst.cutsEl.querySelectorAll('.atex-sl-future-head').map(function(n) { return n.textContent; }),
        cards: inst.cutsEl.querySelectorAll('.atex-sl-cut-future'),
        dayCards: inst.cutsEl.querySelectorAll('.atex-sl-cut-item').length
    };
}

var scene = render(makeInst());
assert(scene.cards.length === 2,
    '#4365: после выполнения завтрашнего задания в секции ДВЕ карточки — сделанное и следующее');
assert(scene.cards[0].classList.contains('is-past') && scene.cards[0].textContent.indexOf('✓') !== -1,
    '#4365: выполненное помечено «✓» и приглушено (is-past)');
assert(!scene.cards[1].classList.contains('is-past') && scene.cards[1].textContent.indexOf('→') !== -1,
    '#4365: следующее помечено «→» (его можно начать)');
assert(scene.heads.length === 1 && scene.heads[0] === 'Следующее задание · 24.07.2026',
    '#4332 п.4: у дня со следующим заданием заголовок «Следующее задание · дата»');

// два разных дня: у дня без «следующего» — нейтральный заголовок «Задания · дата»
var twoDays = render(makeInst({ cuts: [
    cut('1', DAY, '08:00', 'Завершена'),
    cut('9', D24, '08:00', 'Завершена'),
    cut('20', D25, '08:00', 'Ожидает')
] }));
assert(twoDays.heads.join(' | ') === 'Задания · 24.07.2026 | Следующее задание · 25.07.2026',
    '#4365: каждый будущий день — своя секция с датой; «Следующее задание» только у дня со следующим');

// в дне ещё есть открытое задание: ожидающее будущего дня не предлагаем, сделанное видно
var dayBusy = render(makeInst({ cuts: [
    cut('1', DAY, '08:00', 'Завершена'),
    cut('2', DAY, '10:00', 'Ожидает'),     // день не закрыт
    cut('9', D24, '08:00', 'Завершена'),
    cut('10', D24, '10:00', 'Ожидает')
] }));
assert(dayBusy.cards.length === 1 && dayBusy.cards[0].classList.contains('is-past'),
    '#4332 п.4 + #4365: день не закрыт → ожидающего не предлагаем, выполненное будущего дня видно');
assert(dayBusy.heads.join('') === 'Задания · 24.07.2026',
    '#4365: заголовок дня без «следующего» — нейтральный');

// смена закрыта — задания всё равно видно (#4332 п.1)
var closed = render(makeInst({ shiftOpen: false }));
assert(closed.cards.length === 2,
    '#4332 п.1: при закрытой смене задания будущих дней видно (просмотр)');

// клик по выполненному заданию открывает его
(function() {
    var inst = makeInst();
    var opened = [];
    inst.openCut = function(id) { opened.push(String(id)); };
    inst.renderCuts();
    inst.cutsEl.querySelectorAll('.atex-sl-cut-future')[0].click();
    assert(opened.join(',') === '9', '#4365: клик по выполненному заданию открывает его детали');
})();

// в дне заданий нет вовсе — секция всё равно рисуется
(function() {
    var inst = makeInst({ cuts: [cut('9', D24, '08:00', 'Завершена'), cut('10', D24, '10:00', 'Ожидает')] });
    var r = render(inst);
    assert(r.cards.length === 2, '#4365: в выбранном дне заданий нет — секция будущих дней на месте');
})();

// ── #4362 не сломан: кнопки проходов у следующего задания ──────────────────────────────────────
(function() {
    var inst = makeInst();
    inst.currentCut = inst.cuts[3];       // «следующее» (Ожидает)
    inst.currentCutId = '10';
    assert(inst.allCutsDone() === false,
        '#4362: ждёт задание будущего дня → работа смены не окончена');
    var slot = inst.renderPassButtons(inst.currentCut);
    assert(slot.childNodes.filter(function(n) { return n.classList.contains('atex-sl-btn-pass'); }).length === 2,
        '#4362: у следующего задания кнопки «✓ Готово» / «✓✓ Готовы все» на месте');
    var doneInst = makeInst({ cuts: [cut('1', DAY, '08:00', 'Завершена'), cut('9', D24, '08:00', 'Завершена')] });
    doneInst.currentCut = doneInst.cuts[1];
    doneInst.currentCutId = '9';
    assert(doneInst.allCutsDone() === true,
        '#3861: всё выполнено (в т.ч. будущее) → работа смены окончена');
    assert(doneInst.renderPassButtons(doneInst.currentCut).childNodes.length === 0,
        '#3861: кнопок проходов нет, а карточка выполненного задания в списке осталась');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
