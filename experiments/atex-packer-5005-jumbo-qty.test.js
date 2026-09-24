// #5005 — РМ упаковщика: «сколько штук с какого джамбо». По записям «Номер джамбо»
// задания (отчёт task_jumbo: cuts_count, defect_qty) плашка считает
//     резки_джамбо × штук_в_резке − брак_шт,
// где штук в резке = факт позиции / Σ резок задания (полос за проход). Брак
// вычитается один раз на джамбо (по размерам он не расписан). Нет резок или факта —
// плашка деградирует к прежнему списку номеров (#4910).
//
// Пример из тикета: 10 резок по 8 шт, 5 резок на qqq (брак 1), 5 на www (брак 3)
// → «39 шт с джамбо qqq, 37 шт с джамбо www».
//
// Run with: node experiments/atex-packer-5005-jumbo-qty.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-packer-4910-jumbo-line.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = '';
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
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function(k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function(sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function() { return null; }, addEventListener: function() {}
};
global.window = { db: 'testdb' };

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Строка отчёта `packer?JSON_KV` (как в atex-packer.test.js).
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '80.00', cut_length: '450.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '80', qty_fact: '80', packed: '', notes: '', events: '1',
        tipo: '62-83 Х 330/450', tipo_id: '671017',
        art: '0011332'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

// Записи джамбо задания (строки отчёта task_jumbo).
var ISSUE_ROWS = [
    { jumbo_id: '1', jumbo_no: 'qqq', task_id: '666355', cuts_count: '5', defect_qty: '1' },
    { jumbo_id: '2', jumbo_no: 'www', task_id: '666355', cuts_count: '5', defect_qty: '3' }
];

// ── 1) разбор отчёта task_jumbo: номер + резки + брак ──
assertEqual(core.jumboStatsByTask(ISSUE_ROWS),
    { '666355': [{ no: 'qqq', cuts: 5, defect: 1 }, { no: 'www', cuts: 5, defect: 3 }] },
    '#5005: task_jumbo → карта «задание → {номер, резки, брак}», порядок отчёта');
assertEqual(core.jumboStatsByTask([
    { task_id: '666355', jumbo_no: 'J-1', cuts_count: { val: '4', id: '82378' }, defect_qty: '' },
    { task_id: '666999', jumbo_no: 'J-9', cuts_count: '', defect_qty: '2' },
    { task_id: '666355', jumbo_no: '', cuts_count: '9', defect_qty: '9' },
    {}
]), { '666355': [{ no: 'J-1', cuts: 4, defect: 0 }], '666999': [{ no: 'J-9', cuts: 0, defect: 2 }] },
    '#5005: {val,id} → val, пустое — 0, строка без номера/задания пропущена');

// ── 2) расчёт «N шт с джамбо X» — пример из тикета ──
(function() {
    var items = [core.itemFromReportRow(row({}))];   // факт 80, резок 10 → 8 шт в резке
    assertEqual(core.jumboQtyLines(items, core.jumboStatsByTask(ISSUE_ROWS)),
        ['qqq — 39 шт', 'www — 37 шт'],
        '#5005: 5×8−1=39 с qqq, 5×8−3=37 с www');
})();

// ── 3) брака нет — полное количество ──
assertEqual(core.jumboQtyLines(
    [core.itemFromReportRow(row({}))],
    { '666355': [{ no: 'qqq', cuts: 5, defect: 0 }, { no: 'www', cuts: 5, defect: 0 }] }),
    ['qqq — 40 шт', 'www — 40 шт'], '#5005: без брака — резки × штук в резке');

// ── 4) деградация: нет резок или нет факта — пустой список (плашка со списком номеров) ──
assertEqual(core.jumboQtyLines([core.itemFromReportRow(row({}))],
    { '666355': [{ no: 'qqq', cuts: 0, defect: 1 }] }), [],
    '#5005: нулевые резки — считать нечего');
assertEqual(core.jumboQtyLines([core.itemFromReportRow(row({ qty_fact: '' }))],
    core.jumboStatsByTask(ISSUE_ROWS)), [],
    '#5005: факта нет — считать нечего');
assertEqual(core.jumboQtyLines([core.itemFromReportRow(row({}))], {}), [],
    '#5005: записей джамбо нет — пусто');

// ── 5) несколько размеров (несколько Партий ГП, #4999): брак вычитается ОДИН раз ──
(function() {
    var items = [
        core.itemFromReportRow(row({ gp_id: 'a', qty_fact: '40' })),
        core.itemFromReportRow(row({ gp_id: 'b', qty_fact: '40' }))
    ];
    assertEqual(core.jumboQtyLines(items, core.jumboStatsByTask(ISSUE_ROWS)),
        ['qqq — 39 шт', 'www — 37 шт'],
        '#5005: два размера по 40 (4+4 полос) — тот же ответ, брак не задваивается');
})();

// ── 6) брак больше нарезанного — не уходим в минус ──
assertEqual(core.jumboQtyLines(
    [core.itemFromReportRow(row({}) )],
    { '666355': [{ no: 'qqq', cuts: 10, defect: 100 }] }),
    ['qqq — 0 шт'], '#5005: брак больше нарезанного (80) — 0, не минус');

// ── 7) слитая плашка двух заданий: линии обоих, по порядку заданий ──
(function() {
    var items = [
        core.itemFromReportRow(row({ task_id: '666355', qty_fact: '80' })),
        core.itemFromReportRow(row({ task_id: '777777', gp_id: 'x', qty_fact: '100' }))
    ];
    var stats = {
        '666355': [{ no: 'qqq', cuts: 5, defect: 1 }, { no: 'www', cuts: 5, defect: 3 }],
        '777777': [{ no: 'J-9', cuts: 10, defect: 4 }]
    };
    assertEqual(core.jumboQtyLines(items, stats),
        ['qqq — 39 шт', 'www — 37 шт', 'J-9 — 96 шт'],
        '#5005: задания идут по порядку позиций, внутри — порядок отчёта');
})();

// ── 8) карточка: плашка «Джамбо» с количествами; без данных — прежний список ──
function render(over, jumbos, stats) {
    var self = Object.create(mod.Controller.prototype);
    self.jumbos = jumbos || {};
    self.jumboStats = stats || {};
    var item = core.itemFromReportRow(row(over));
    self.items = [item];
    self.applyJumbos();
    return self.renderCard(item);
}
(function() {
    var plaque = render({}, { '666355': ['qqq', 'www'] }, core.jumboStatsByTask(ISSUE_ROWS))
        .querySelectorAll('.atex-pk-jumbo')[0];
    var value = plaque ? plaque.querySelectorAll('.atex-pk-art-value')[0] : null;
    assertEqual(value ? value.textContent : null, 'qqq — 39 шт, www — 37 шт',
        '#5005: в плашке «N шт» по каждому джамбо');
    var plain = render({}, { '666355': ['qqq', 'www'] }, {})
        .querySelectorAll('.atex-pk-jumbo')[0];
    var plainValue = plain ? plain.querySelectorAll('.atex-pk-art-value')[0] : null;
    assertEqual(plainValue ? plainValue.textContent : null, 'qqq, www',
        '#4910 (регрессия): без расчёта плашка показывает прежний список номеров');
})();

console.log('\n' + passed + ' assertions passed');
