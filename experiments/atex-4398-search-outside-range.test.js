// Tests for ideav/crm#4398 — заказ «пропал» из планирования: задание стоит раньше даты
// фильтра, поиск по номеру заказа его не находит, а позиции нет в форме ручного добавления.
// Покрываем:
//   1) чистые searchMatchesOutsideRange / expandRangeToInclude / planDateIso;
//   2) очередь (renderQueue на DOM-стабе, как atex-4394-cut-id-links.test.js):
//      • плашка .atex-pp-outside-note с числом совпадений и датами;
//      • клик «Расширить диапазон» → диапазон включает найденные дни, карточка появилась;
//      • без запроса / при совпадении внутри диапазона плашки нет;
//   3) форма «Новое производственное задание»: подсказка, сколько согласованных позиций
//      скрыто как уже покрытые заданием (иначе «позиции нет в списке» = потерянный заказ).
//
// Run with: node experiments/atex-4398-search-outside-range.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-4394-cut-id-links.test.js) ──
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

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
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

// Данные боевого случая: задание 642289 под позицию 633507 заказа 4366 стоит на 16.07.2026,
// а очередь открыта на 25.07.2026 (сегодня).
var STUCK_TS = tsAt(2026, 7, 16, 8, 0);
var TODAY_TS = tsAt(2026, 7, 25, 8, 0);
var LABELS = { '642289': ['4366 · 60мм * 450м'], '642300': ['4370 · 60мм * 450м'] };
function stuckCut() {
    return { id: '642289', number: String(STUCK_TS), slitter: { id: '101', label: 'Станок 2' },
        materialName: 'MW411', materialId: '2158', winding: 'OUT', knifeWidths: [60], knifeCount: 1,
        plannedRuns: 4, length: 450, planDate: STUCK_TS, startDate: '', endDate: '', status: '' };
}
function todayCut() {
    return { id: '642300', number: String(TODAY_TS), slitter: { id: '101', label: 'Станок 2' },
        materialName: 'MW411', materialId: '2158', winding: 'OUT', knifeWidths: [60], knifeCount: 1,
        plannedRuns: 2, length: 450, planDate: TODAY_TS, startDate: '', endDate: '', status: '' };
}

// ── 1) Чистые функции ────────────────────────────────────────────────────────
(function () {
    assertEqual(planning.planDateIso(STUCK_TS), '2026-07-16', 'planDateIso: unix-штамп → «ГГГГ-ММ-ДД»');
    assertEqual(planning.planDateIso('16.07.2026'), '2026-07-16', 'planDateIso: «ДД.ММ.ГГГГ» → «ГГГГ-ММ-ДД»');
    assertEqual(planning.planDateIso(''), '', 'planDateIso: пустая дата → пусто');

    var cuts = [stuckCut(), todayCut()];
    var out = planning.searchMatchesOutsideRange(cuts, '4366', LABELS, '2026-07-25', '2026-07-25');
    assertEqual(out.count, 1, 'задание заказа 4366 найдено ВНЕ диапазона (одно)');
    assertEqual([out.fromIso, out.toIso], ['2026-07-16', '2026-07-16'],
        'границы найденного = его «Дата план» 16.07.2026');

    assertEqual(planning.searchMatchesOutsideRange(cuts, '4370', LABELS, '2026-07-25', '2026-07-25').count, 0,
        'совпадение ВНУТРИ диапазона плашку не поднимает');
    assertEqual(planning.searchMatchesOutsideRange(cuts, '', LABELS, '2026-07-25', '2026-07-25').count, 0,
        'пустой запрос — совпадений вне диапазона нет (плашки нет)');
    assertEqual(planning.searchMatchesOutsideRange(cuts, '4366', LABELS, '2026-07-10', '2026-07-25').count, 0,
        'широкий диапазон уже включает задание — плашки нет');
    assertEqual(planning.searchMatchesOutsideRange(cuts, '4366', LABELS, '', '').count, 0,
        'пустой фильтр дат ничего не скрывает');

    var done = [Object.assign(stuckCut(), { status: 'Завершён' })];
    assertEqual(planning.searchMatchesOutsideRange(done, '4366', LABELS, '2026-07-25', '2026-07-25').count, 0,
        'завершённое задание в очередь не зовём');
    var noDate = [Object.assign(stuckCut(), { planDate: '' })];
    assertEqual(planning.searchMatchesOutsideRange(noDate, '4366', LABELS, '2026-07-25', '2026-07-25').count, 0,
        'задание без «Даты план» видно при любом диапазоне — не считаем скрытым');

    // Поиск идёт и по собственным полям задания (сырьё), не только по подписям позиций.
    assertEqual(planning.searchMatchesOutsideRange([stuckCut()], 'MW411', {}, '2026-07-25', '2026-07-25').count, 1,
        'совпадение по сырью задания тоже ловится вне диапазона');

    assertEqual(planning.expandRangeToInclude('2026-07-25', '2026-07-25', '2026-07-16', '2026-07-16'),
        { date: '2026-07-16', dateTo: '2026-07-25' }, 'расширение вниз: «С» = дата найденного, «По» прежняя');
    assertEqual(planning.expandRangeToInclude('2026-07-25', '2026-07-25', '2026-08-03', '2026-08-03'),
        { date: '2026-07-25', dateTo: '2026-08-03' }, 'расширение вверх: «По» = дата найденного');
    assertEqual(planning.expandRangeToInclude('2026-07-25', '2026-07-25', '2026-07-16', '2026-08-03'),
        { date: '2026-07-16', dateTo: '2026-08-03' }, 'расширение в обе стороны');
    assertEqual(planning.expandRangeToInclude('', '', '2026-07-16', '2026-07-16'),
        { date: '', dateTo: '' }, 'пустой край — «без границы», не заполняем');
})();

// ── 2) Очередь: плашка и расширение диапазона ────────────────────────────────
function makeController(cuts, supplies, positions) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-25', dateTo: '2026-07-25', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 2' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = positions || []; c.genPositions = [];
    c.supplies = supplies || [];
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
    var supplies = [
        { id: 's1', cutId: '642289', positionId: '633507', orderNo: '4366', rolls: 60, dueKey: 20260727 },
        { id: 's2', cutId: '642300', positionId: '633600', orderNo: '4370', rolls: 20, dueKey: 20260731 }
    ];
    var positions = [
        { id: '633507', label: '4366 · 60мм * 450м', width: 60, length: 450, qty: 60 },
        { id: '633600', label: '4370 · 60мм * 450м', width: 60, length: 450, qty: 20 }
    ];
    var c = makeController([stuckCut(), todayCut()], supplies, positions);

    // Без поиска плашки нет.
    c.renderQueue();
    assert(!c.queueEl.querySelector('.atex-pp-outside-note'), 'без запроса плашки «вне диапазона» нет');

    // Поиск «4366»: в диапазоне 25.07 совпадений нет, задание стоит на 16.07.
    c.filter.query = '4366';
    c.renderQueue();
    assert(!cardOf(c.queueEl, '642289'), 'карточка задания 16.07 в очереди 25.07 не показана');
    var note = c.queueEl.querySelector('.atex-pp-outside-note');
    assert(!!note, 'плашка «вне диапазона дат» показана');
    var text = note ? note.textContent : '';
    assert(text.indexOf('найдено заданий: 1') !== -1, 'плашка называет число найденных заданий');
    assert(text.indexOf('16.07.2026') !== -1, 'плашка называет дату найденного задания');

    // Кнопка расширяет диапазон и задание появляется в очереди.
    var btn = c.queueEl.querySelector('.atex-pp-outside-btn');
    assert(!!btn, 'в плашке есть кнопка «Расширить диапазон»');
    btn.click();
    assertEqual([c.filter.date, c.filter.dateTo], ['2026-07-16', '2026-07-25'],
        'клик расширил диапазон до даты найденного задания');
    assert(!!cardOf(c.queueEl, '642289'), 'после расширения карточка задания заказа 4366 в очереди');
    assert(!c.queueEl.querySelector('.atex-pp-outside-note'), 'плашка ушла — скрытых совпадений больше нет');

    // Поиск по заданию, которое и так видно, плашку не поднимает.
    c.filter = { slitter: '', status: '', date: '2026-07-25', dateTo: '2026-07-25', query: '4370' };
    c.renderQueue();
    assert(!c.queueEl.querySelector('.atex-pp-outside-note'),
        'совпадение внутри диапазона плашку не показывает');

    // Фильтр «Статус» отсеивает задание и после расширения дат — плашку не показываем,
    // иначе кнопка обещает то, чего в очереди не появится.
    c.filter = { slitter: '', status: 'В работе', date: '2026-07-25', dateTo: '2026-07-25', query: '4366' };
    c.renderQueue();
    assert(!c.queueEl.querySelector('.atex-pp-outside-note'),
        'задание, отсеянное фильтром статуса, в плашку не попадает');
})();

// ── 2б) Найденное задание на другом станке — закладка переключается ──────────
(function () {
    var otherStation = Object.assign(stuckCut(), { slitter: { id: '202', label: 'Станок 4' } });
    var c = makeController([otherStation, todayCut()],
        [{ id: 's1', cutId: '642289', positionId: '633507', orderNo: '4366', rolls: 60, dueKey: 20260727 }],
        [{ id: '633507', label: '4366 · 60мм * 450м', width: 60, length: 450, qty: 60 }]);
    c.slitters = [{ id: '101', label: 'Станок 2' }, { id: '202', label: 'Станок 4' }];
    c.activeSlitter = '101';
    c.filter.query = '4366';
    c.renderQueue();
    var btn = c.queueEl.querySelector('.atex-pp-outside-btn');
    assert(!!btn, 'плашка показана и для задания другого станка');
    btn.click();
    assertEqual(c.activeSlitter, '202', 'закладка переключилась на станок найденного задания');
    assert(!!cardOf(c.queueEl, '642289'), 'карточка видна сразу, без ручного выбора станка');
})();

// ── 3) Форма: сколько позиций скрыто как уже покрытые ────────────────────────
(function () {
    var c = makeController([], [], []);
    c.formEl = new StubNode('div');
    c.draft = c.blankDraft();
    c.genPositions = [
        // покрыта заданием — из списка выпадает
        { id: '633507', materialId: '2158', width: 60, qty: 60, length: 450, approved: true },
        // покрыта складской партией ГП — тоже выпадает
        { id: '633600', materialId: '2158', width: 60, qty: 20, length: 450, approved: true },
        // свободна — остаётся в списке
        { id: '633700', materialId: '2158', width: 60, qty: 10, length: 450, approved: true }
    ];
    c.positions = [
        { id: '633507', label: '4366 · 60мм * 450м', width: 60, length: 450, qty: 60 },
        { id: '633600', label: '4370 · 60мм * 450м', width: 60, length: 450, qty: 20 },
        { id: '633700', label: '4371 · 60мм * 450м', width: 60, length: 450, qty: 10 }
    ];
    c.supplies = [
        { id: 's1', cutId: '642289', positionId: '633507', rolls: 60 },
        { id: 's2', cutId: '', finishedBatchId: '642324', positionId: '633600', rolls: 20 }
    ];
    c.slitters = [{ id: '101', label: 'Станок 2' }];
    c.renderForm();

    var hints = c.formEl.querySelectorAll('.atex-pp-hint').map(function(n) { return n.textContent; });
    var covered = hints.filter(function(t) { return t.indexOf('скрыто: 2') !== -1; })[0] || '';
    assert(covered !== '', 'форма говорит, сколько согласованных позиций скрыто как уже покрытые');
    assert(covered.indexOf('номеру заказа') !== -1, 'подсказка отправляет искать задание по номеру заказа');

    var select = c.formEl.querySelectorAll('.atex-pp-input').filter(function(n) { return n.tagName === 'SELECT'; })[0];
    var optionLabels = select ? select.options.map(function(o) { return o.textContent; }) : [];
    assertEqual(optionLabels.length, 2, 'в списке — только свободная позиция (плюс «— выберите позицию —»)');
    assert(optionLabels.join(' ').indexOf('4371') !== -1, 'свободная позиция 4371 в списке осталась');
    assert(optionLabels.join(' ').indexOf('4366') === -1, 'покрытая заданием позиция 4366 в список не вернулась');
})();

console.log('\n' + passed + '/' + total + ' passed');
