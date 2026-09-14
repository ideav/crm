// #4958 — левый столбец пульта слиттера (очередь заданий станка):
//
//   1. статус задания стоял по центру карточки — на строке спецификации, а не рядом с
//      номером. Оператор читает номер заказа и его состояние в двух разных строках.
//      Должно: бейдж статуса — в одной строке с номером (заказа или позиции в очереди).
//   2. позиция была написана «MB / IN / 122м * 11» — своим порядком, не как в плане
//      диспетчера, и без числа резок словом. Должно: «MB 30 x 122 IN - 11 резок» —
//      «{сырьё} {ширина} x {длина} {намотка}» как в строке позиции плана
//      (formatStripSummaryLine в production-planning), затем сколько проходов резать.
//
// Ширина позиции приходит тем же отчётом cut_planning, что и номер заказа
// (колонка cut_roller_width) — отдельного запроса подпись не стоит.
//
// Run with: node experiments/atex-slitter-4958-queue-card.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-slitter-4365.test.js) ─────────────────────────────────────
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
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// Тест пишется ДО правки: пока ядро не знает новых функций, зовём их через обёртку,
// чтобы красное было читаемым списком ожиданий, а не стеком первого же вызова.
function callCore(name, args) {
    if (typeof core[name] !== 'function') return '(core.' + name + ' нет)';
    return core[name].apply(core, args);
}
function cutSpecLine(cut, material, widths) { return callCore('cutSpecLine', [cut, material, widths]); }
function rowsToCutWidths(rows) { return callCore('rowsToCutWidths', [rows]); }

var DAY = '2026-09-14', D15 = '2026-09-15';
function stamp(dayISO, hhmm) { return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000)); }

// ── п.2: подпись позиции — порядком плана диспетчера, с числом резок ──────────────────────────
// Сцена из тикета: задание 5261 «MB / IN / 122м * 11» → «MB 30 x 122 IN - 11 резок».
assertEqual(cutSpecLine({ runLength: '122', winding: 'IN', plannedRuns: '11' }, 'MB', ['30']),
    'MB 30 x 122 IN - 11 резок',
    '#4958 п.2: «{сырьё} {ширина} x {длина} {намотка} - {N} резок» — как позиция в плане');
assertEqual(cutSpecLine({ runLength: '450', winding: 'OUT', plannedRuns: '1' }, 'MW412', ['85']),
    'MW412 85 x 450 OUT - 1 резка',
    '#4958 п.2: счётная форма слова — «1 резка»');
assertEqual(cutSpecLine({ runLength: '300', winding: 'OUT', plannedRuns: '3' }, 'MR194', ['110']),
    'MR194 110 x 300 OUT - 3 резки',
    '#4958 п.2: «3 резки»');
assertEqual(cutSpecLine({ runLength: '300', winding: 'OUT', plannedRuns: '5' }, 'MR194', ['110']),
    'MR194 110 x 300 OUT - 5 резок',
    '#4958 п.2: «5 резок»');
// Задание обеспечивает позиции разной ширины — в плане это отдельные строки полос,
// в узкой карточке пульта ширины перечисляются через «/».
assertEqual(cutSpecLine({ runLength: '122', winding: 'IN', plannedRuns: '11' }, 'MB', ['30', '50', '30']),
    'MB 30/50 x 122 IN - 11 резок',
    '#4958 п.2: несколько ширин позиции — через «/», повторы схлопываются');
// Ширины нет (задание в запас / отчёт cut_planning недоступен) — подпись просто без неё.
assertEqual(cutSpecLine({ runLength: '122', winding: 'IN', plannedRuns: '11' }, 'MB', []),
    'MB 122 IN - 11 резок',
    '#4958 п.2: ширина неизвестна — карточка остаётся без неё, а не с прочерком');
// #3635 п.5: задание-«настройка» — проходов нет, хвоста про резки тоже.
assertEqual(cutSpecLine({ runLength: '122', winding: 'IN', plannedRuns: '0' }, 'MB', ['30']),
    'MB 30 x 122 IN',
    '#4958 п.2: у задания без проходов хвоста «- N резок» нет');
assertEqual(cutSpecLine({ runLength: '', winding: '', plannedRuns: '' }, '', []),
    '— —',
    '#4958 п.2: пустое задание — прочерки вместо сырья и длины');

// ── ширина позиции — из строк отчёта cut_planning (тот же запрос, что и номер заказа) ─────────
var planningRows = [
    { cut_id: '5261', order_no: '4276', cut_roller_width: '30' },
    { cut_id: '5261', order_no: '4276', cut_roller_width: '30' },   // второе обеспечение той же ширины
    { cut_id: '5266', order_no: '244', cut_roller_width: '85,00' }, // из базы приходит с запятой
    { cut_id: '5309', order_no: '4277', cut_roller_width: '' }      // ширины нет — задания в карте нет
];
assertEqual(rowsToCutWidths(planningRows), { '5261': ['30'], '5266': ['85'] },
    '#4958: cut_roller_width → { задание: [ширины] }, уникальные, пустые отброшены');
assertEqual(rowsToCutWidths([]), {}, '#4958: пустой отчёт → пустая карта ширин');

// ── карточка очереди: сцена скриншота из тикета ───────────────────────────────────────────────
function makeInst(opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.selectedSlitterId = 'm1';
    inst.selectedDate = DAY;
    inst.shiftEvents = [];
    inst.batches = [];
    inst.cuts = o.cuts || [
        { id: '5266', slitterId: 'm1', planDate: stamp(DAY, '14:08'), status: 'Завершена',
          material: 'MW412', winding: 'OUT', runLength: '450', plannedRuns: '2',
          startedAt: stamp(DAY, '14:08'), finishedAt: stamp(DAY, '14:08') },
        { id: '5261', slitterId: 'm1', planDate: stamp(DAY, '10:39'), status: 'Ожидает',
          material: 'MB', winding: 'IN', runLength: '122', plannedRuns: '11' }
    ];
    inst.cutOrders = o.cutOrders === undefined ? { '5266': ['5266'], '5261': ['5261'] } : o.cutOrders;
    inst.cutWidths = o.cutWidths === undefined ? { '5266': ['85'], '5261': ['30'] } : o.cutWidths;
    inst.currentCutId = null;
    inst.cutsEl = new StubNode('div');
    inst.isShiftOpen = function() { return true; };
    inst.findBatch = function() { return null; };
    return inst;
}
function cards(inst) {
    inst.renderCuts();
    return inst.cutsEl.querySelectorAll('.atex-sl-cut-item');
}

(function() {
    var list = cards(makeInst());
    assert(list.length === 2, '#4958: в очереди дня две карточки (сцена тикета)');
    var waiting = list[0];   // 5261, «Ожидает» (очередь — по «Дате план»: 10:39, затем 14:08)
    assertEqual(waiting.querySelector('.atex-sl-cut-spec').textContent, 'MB 30 x 122 IN - 11 резок',
        '#4958 п.2: карточка пишет позицию как план диспетчера');
    assertEqual(list[1].querySelector('.atex-sl-cut-spec').textContent, 'MW412 85 x 450 OUT - 2 резки',
        '#4958 п.2: то же у завершённого задания');

    // п.1: бейдж статуса — внутри строки с номером, а не отдельным столбцом карточки.
    var head = waiting.querySelector('.atex-sl-cut-order');
    assert(!!head && !!head.querySelector('.atex-sl-badge'),
        '#4958 п.1: бейдж статуса стоит в строке с номером');
    assert(!!head.querySelector('.atex-sl-cut-num') && !!head.querySelector('.atex-sl-cut-order-no'),
        '#4958 п.1: там же — № по порядку и номер заказа');
    assert(waiting.childNodes.filter(function(n) { return n.classList.contains('atex-sl-badge'); }).length === 0,
        '#4958 п.1: прямым ребёнком карточки (по центру) бейджа больше нет');
    var specRow = waiting.querySelector('.atex-sl-cut-line1');
    assert(!!specRow && !specRow.querySelector('.atex-sl-badge'),
        '#4958 п.1: на строке спецификации статуса нет');
    assert(waiting.querySelectorAll('.atex-sl-badge').length === 1
        && waiting.querySelector('.atex-sl-badge').textContent === 'Ожидает',
        '#4958 п.1: статус в карточке по-прежнему один и читается');
})();

// Номера заказа нет (задание в запас / отчёт недоступен) — статус всё равно рядом с №.
(function() {
    var list = cards(makeInst({ cutOrders: {} }));
    var head = list[0].querySelector('.atex-sl-cut-order');
    assert(!!head && !!head.querySelector('.atex-sl-cut-num') && !!head.querySelector('.atex-sl-badge'),
        '#4958 п.1: без номера заказа статус стоит в строке с № по порядку');
    assert(!!head && !head.querySelector('.atex-sl-cut-order-no'),
        '#4606: номера заказа нет — и подписи нет');
    assertEqual(list[0].querySelector('.atex-sl-cut-spec').textContent, 'MB 30 x 122 IN - 11 резок',
        '#4958 п.2: подпись позиции от наличия заказа не зависит');
})();

// Ширины не пришли вовсе (cut_planning не ответил) — очередь рисуется без ширин.
(function() {
    var list = cards(makeInst({ cutWidths: undefined, cutOrders: { '5261': ['5261'] } }));
    assert(list.length === 2, '#4958: отчёт ширин недоступен — очередь на месте');
})();

// ── карточка задания будущего дня (#4365) — та же подпись и то же место статуса ───────────────
(function() {
    var inst = makeInst({ cuts: [
        { id: '5266', slitterId: 'm1', planDate: stamp(DAY, '14:08'), status: 'Завершена',
          material: 'MW412', winding: 'OUT', runLength: '450', plannedRuns: '2',
          finishedAt: stamp(DAY, '14:08') },
        { id: '5310', slitterId: 'm1', planDate: stamp(D15, '08:00'), status: 'Ожидает',
          material: 'MR194', winding: 'OUT', runLength: '300', plannedRuns: '5' }
    ] });
    inst.cutWidths = { '5310': ['110'] };
    inst.cutOrders = { '5310': ['5310'] };
    inst.renderCuts();
    var future = inst.cutsEl.querySelectorAll('.atex-sl-cut-future');
    assert(future.length === 1, '#4365: секция будущего дня на месте');
    assertEqual(future[0].querySelector('.atex-sl-cut-spec').textContent, 'MR194 110 x 300 OUT - 5 резок',
        '#4958 п.2: у задания будущего дня подпись та же');
    var head = future[0].querySelector('.atex-sl-cut-order');
    assert(!!head && !!head.querySelector('.atex-sl-badge'),
        '#4958 п.1: и статус там же — в строке с маркером «→»/«✓»');
    assert(future[0].childNodes.filter(function(n) { return n.classList.contains('atex-sl-badge'); }).length === 0,
        '#4958 п.1: отдельного столбца со статусом у карточки будущего дня тоже нет');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
