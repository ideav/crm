// #4362 — пульт слиттера: у задания СЛЕДУЮЩЕГО дня (#4332 п.4) не было кнопок отметки
// проходов «✓ Готово» / «✓✓ Готовы все», хотя «Наладка / Перерыв / Прекратить / Пропуск»
// показывались (скриншот тикета: 23.07, Станок 2, 4 задания дня «Завершена», выбрано
// «Следующее задание · 24.07.2026» в статусе «Ожидает»).
//
// Корень: renderPassButtons прячет кнопки по allCutsDone (#3861 — работа смены окончена),
// а allCutsDone смотрел ТОЛЬКО очередь выбранного дня: «нет открытой резки дня» = true.
// Ровно это же условие — предпосылка показа задания будущего дня (renderFutureCut), поэтому
// у такого задания кнопки проходов были скрыты ВСЕГДА.
//
// Фикс: allCutsDone учитывает следующее задание будущих дней (futureCut) — пока оно есть,
// работа смены не окончена.
//
// Run with: node experiments/atex-slitter-4362.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (без jsdom, как atex-production-planning-3764-ui.test.js) ─────────────
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

var DAY = '2026-07-23', NEXT = '2026-07-24';
function stamp(dayISO, hhmm) {
    return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000));
}
function cut(id, dayISO, hhmm, status) {
    return { id: id, slitterId: 'm2', planDate: stamp(dayISO, hhmm), status: status,
             material: 'MR194', winding: 'OUT', runLength: 450, plannedRuns: 60 };
}

// Сцена со скриншота: смена Станка 2 открыта, 4 задания 23.07 завершены, на 24.07 ждёт одно.
function makeInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.selectedSlitterId = 'm2';
    inst.selectedDate = DAY;
    inst.shiftEvents = [];
    inst.batches = [];
    inst.cuts = [
        cut('1', DAY, '08:00', 'Завершена'),
        cut('2', DAY, '10:00', 'Завершена'),
        cut('3', DAY, '12:30', 'Завершена'),
        cut('4', DAY, '14:00', 'Завершена')
    ];
    if (!o.noFuture) inst.cuts.push(cut('9', NEXT, '08:00', o.futureStatus || 'Ожидает'));
    inst.isShiftOpen = function() { return o.shiftOpen === false ? false : true; };
    inst.findBatch = function() { return null; };
    inst.currentCut = o.currentCut || inst.cuts[inst.cuts.length - 1];
    inst.currentCutId = inst.currentCut.id;
    return inst;
}

function passButtons(inst) {
    var slot = inst.renderPassButtons(inst.currentCut);
    return slot.childNodes.filter(function(n) { return n.classList.contains('atex-sl-btn-pass'); });
}

// ── симптом тикета: у задания будущего дня кнопки проходов есть и активны ──────────────────────
var inst = makeInst();
assert(inst.allCutsDone() === false,
    '#4362: задания дня выполнены, но ждёт задание 24.07 → работа смены НЕ окончена');
var btns = passButtons(inst);
assert(btns.length === 2, '#4362: у задания следующего дня — обе кнопки проходов («✓ Готово», «✓✓ Готовы все»)');
assert(btns.length === 2 && btns[0].textContent === '✓ Готово' && btns[1].textContent === '✓✓ Готовы все',
    '#4362: подписи кнопок — «✓ Готово» / «✓✓ Готовы все»');
assert(btns.every(function(b) { return b.disabled === false; }),
    '#4362: кнопки активны (задание «Ожидает», не завершено)');

// клик по «✓ Готово» доходит до markPassDone (кнопка не декоративная)
var marked = [];
inst.markPassDone = function(all) { marked.push(all); };
passButtons(inst).forEach(function(b) { b.click(); });
assert(JSON.stringify(marked) === '[false,true]',
    '#4362: клики вызывают markPassDone(false) и markPassDone(true)');

// начатое задание будущего дня («Наладка» → «В работе») кнопки сохраняет
['Наладка', 'В работе', 'Перерыв'].forEach(function(st) {
    var i = makeInst({ futureStatus: st });
    assert(passButtons(i).length === 2, '#4362: задание следующего дня в статусе «' + st + '» — кнопки проходов на месте');
});

// ── #3861 сохранён: заданий больше нет → кнопки убраны вовсе ───────────────────────────────────
var doneAll = makeInst({ noFuture: true });
doneAll.currentCut = doneAll.cuts[3];
assert(doneAll.allCutsDone() === true, '#3861: все задания дня выполнены и будущих нет → работа смены окончена');
assert(passButtons(doneAll).length === 0, '#3861: кнопок проходов нет (резка открыта только для просмотра)');

var futureDone = makeInst({ futureStatus: 'Завершена' });
futureDone.currentCut = futureDone.cuts[4];
assert(futureDone.allCutsDone() === true, '#4362: задание следующего дня ЗАВЕРШЕНО → работа смены окончена');
assert(passButtons(futureDone).length === 0, '#4362: у завершённого задания следующего дня кнопок проходов нет');

// ── прочие гейты не сломаны ────────────────────────────────────────────────────────────────────
var closed = makeInst({ shiftOpen: false });
assert(closed.allCutsDone() === false, '#4332 п.3: смена закрыта → allCutsDone false');
assert(passButtons(closed).length === 0, '#4332 п.3: при закрытой смене кнопок проходов нет');

// завершённое задание ДНЯ при ждущем задании будущего дня: кнопки видны, но нажать нельзя
var doneDayCut = makeInst({ currentCut: null });
doneDayCut.currentCut = doneDayCut.cuts[0];
doneDayCut.currentCutId = '1';
var doneBtns = passButtons(doneDayCut);
assert(doneBtns.length === 2 && doneBtns.every(function(b) { return b.disabled === true; }),
    '#4362: у ЗАВЕРШЁННОГО задания дня кнопки проходов неактивны');

// задание дня, заблокированное очередью, кнопок не получает (#3670/#4353)
var queued = makeInst();
queued.cuts[2].status = 'Ожидает';
queued.cuts[3].status = 'Ожидает';
queued.currentCut = queued.cuts[3];
queued.currentCutId = '4';
assert(queued.isCutLocked(queued.cuts[3]) === true, '#4353: третье задание дня открыто → четвёртое ждёт очередь');
assert(passButtons(queued).length === 0, '#3670: у заблокированного очередью задания кнопок проходов нет');

// ── список слева: секция «Следующее задание · 24.07.2026» (#4332 п.4) не изменилась ────────────
var listInst = makeInst();
listInst.cutsEl = new StubNode('div');
listInst.sidebarTitleEl = new StubNode('div');
listInst.renderCuts();
var heads = listInst.cutsEl.querySelectorAll('.atex-sl-future-head');
assert(heads.length === 1 && heads[0].textContent === 'Следующее задание · ' + core.formatDate(stamp(NEXT, '08:00')),
    '#4332 п.4: под очередью дня — секция «Следующее задание» с датой задания');
assert(listInst.cutsEl.querySelectorAll('.atex-sl-cut-future').length === 1,
    '#4332 п.4: карточка задания будущего дня одна');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
