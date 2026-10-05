// #5075 — остаток партии сырья ведётся двумя НЕЗАВИСИМЫМИ мерами (параллельный прогон):
// «Остаток, м²» обновляется из 1С загрузкой, «Остаток, м» ведёт слиттер своим счётчиком.
// Решение владельца: расхождение м и м² — данные, а не ошибка. Пульт НЕ пересчитывает
// заполненные метры из м² — ни устаревшие, ни 0, ни отрицательные. Метры выводятся из м² по
// ширине только когда «Остаток, м» не заполнен. Прежний код подменял метры ≤ 0 метрами из м²
// и тем самым стирал перерасход, который насчитал слиттер.
// В строке партии отрицательный остаток помечен «перерасход партии», дата партии (главное
// значение — unix-штамп) выводится по Москве, а не по поясу планшета.
//
// Run with: node experiments/atex-slitter-5075-batch-remainder.test.js

// Планшет нарочно не в московском поясе: дата партии обязана выводиться по Москве.
process.env.TZ = 'Asia/Novosibirsk';

function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._className = '';
    this._text = '';
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
StubNode.prototype.addEventListener = function() {};
StubNode.prototype._all = function(acc) { this.childNodes.forEach(function(c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function(sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function(n) { return n.classList.contains(cls); }); };

global.document = {
    createElement: function(tag) { return new StubNode(tag); },
    createTextNode: function(text) { var n = new StubNode('#text'); n._text = String(text == null ? '' : text); return n; },
    body: new StubNode('body'), readyState: 'loading',
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function() { return null; }
};
global.window = { db: 'ateh' };

var api = require('../download/atex/js/slitter.js');
var core = api.core, Controller = api.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

function fill(batches, widths) {
    var inst = Object.create(Controller.prototype);
    inst.materialWidths = widths || {};
    inst.batches = batches;
    inst.fillBatchRemainderM();
    return inst.batches;
}

// ── 1) Правило «заполненные метры не трогаем» на всех сочетаниях входа ─────────────────────────
// [m², м до (null = не заполнен), ширина, ожидаемые м, ожидаемые м², что проверяем]
var CASES = [
    [350, null, 500, 700, 350, 'м не заполнены → из м² по ширине'],
    [350, 0, 500, 0, 350, 'м = 0 (заполнены) → остаются 0'],
    [350, -18632.519, 500, -18632.519, 350, 'м отрицательные → остаются (перерасход слиттера не стирается)'],
    [2330547.12, 52354.915, 910, 52354.915, 2330547.12, 'партия 77212: м расходятся с м² → остаются (расхождение — данные)'],
    [350, 715, 500, 715, 350, 'м чуть больше м²-метров → остаются'],
    [-100, 300, 500, 300, -100, 'м² отрицательный → м² из 1С не перетирается метрами'],
    [0, 700, 500, 700, 350, 'м² пуст, м положительные → м² досчитывается из метров'],
    [0, -50, 500, -50, 0, 'м² пуст, м отрицательные → метры как есть'],
    [350, null, 0, null, 350, 'ширина неизвестна → пересчёт невозможен, всё как есть']
];
CASES.forEach(function(c) {
    var b = { id: 'x', materialId: 'm', remainder: c[0], widthMm: c[2] };
    if (c[1] === null) { b.remainderM = 0; b.remainderMEmpty = true; } else b.remainderM = c[1];
    fill([b]);
    var m = (c[1] === null && c[3] === null) ? (b.remainderMEmpty ? null : b.remainderM) : b.remainderM;
    assertEqual([m, b.remainder], [c[3], c[4]], '#5075 fillBatchRemainderM: ' + c[5]);
});

// Ширина из справочника «Вид сырья», когда отчёт её не отдал.
assertEqual(fill([{ id: 'y', materialId: '2090', remainder: 1000, remainderM: 0, remainderMEmpty: true, widthMm: 0 }], { '2090': 1000 })[0].remainderM,
    1000, '#5075 fillBatchRemainderM: ширина из справочника видов сырья');

// Разбор отчёта material_batches: пустой «Остаток, м» и «0» различаются.
(function() {
    var rows = core.rowsToActiveBatches([
        { batch_id: '77335', batch_no: '1781038800', batch_material_id: '2086', batch_remainder_m2: '910', batch_remainder_m: '0', width_mm: '910.00' },
        { batch_id: '77336', batch_no: '1781038800', batch_material_id: '2086', batch_remainder_m2: '910', batch_remainder_m: '', width_mm: '910.00' }
    ]);
    fill(rows);
    assertEqual(rows.map(function(b) { return b.remainderM; }), [0, 1000],
        '#5075: из отчёта «0» метров остаётся нулём, пустой «Остаток, м» выводится из м²');
})();

// Идемпотентность: повторный вызов (start() и loadBatches зовут его оба) ничего не меняет.
(function() {
    var list = [{ id: 'z', materialId: 'm', remainder: 2330547.12, remainderM: 0, remainderMEmpty: true, widthMm: 910 },
                { id: 'w', materialId: 'm', remainder: 2330547.12, remainderM: 52354.915, widthMm: 910 }];
    fill(list);
    var once = JSON.stringify(list);
    fill(list);
    assertEqual(JSON.stringify(list), once, '#5075 fillBatchRemainderM: повторный вызов идемпотентен');
})();

// ── 2) Строка партии: перерасход и дата по Москве ──────────────────────────────────────────────
function lineCells(batch) {
    var inst = Object.create(Controller.prototype);
    inst.selectedBatchIds = [batch.id];
    inst.currentCut = { id: '90', batchId: batch.id, runLength: '400', plannedRuns: '4' };
    inst.findBatch = function(id) { return String(id) === batch.id ? batch : null; };
    var line = inst.renderBatchLine();
    return line.querySelectorAll('.atex-sl-batch-cell').map(function(n) { return n.textContent; });
}

(function() {
    var cells = lineCells({ id: '74929', label: '1781038800', date: '', remainderM: -18632.519, barcode: '' });
    assertEqual(cells.filter(function(t) { return t.indexOf('перерасход партии') >= 0; }).length, 1,
        '#5075: отрицательный остаток → в строке партии явное «перерасход партии»');
    assertEqual(cells[0], 'Партия: 10.06.2026 00:00',
        '#5075: дата партии (штамп 1781038800) — по Москве, а не по поясу планшета (Новосибирск дал бы 10.06.2026 04:00)');

    var ok = lineCells({ id: '77', label: '1781038800', date: '', remainderM: 900, barcode: '' });
    assertEqual(ok.filter(function(t) { return t.indexOf('перерасход') >= 0; }).length, 0,
        '#5075: положительный остаток — предупреждения нет');
    assertEqual(ok.length, 5, '#5075: обычная партия — те же пять ячеек строки');
})();

// ── 3) Партия с перерасходом (м ≤ 0) остаётся доступной для резки ─────────────────────────────
// Решение владельца: «мы не можем запретить оператору резать». Остаток в метрах — счётчик
// параллельного прогона, по его знаку и величине партию не прячем. Прочие фильтры (в работе,
// вид сырья) остаются. Порядок: сначала партии, которых хватает хотя бы на проход (FIFO),
// затем остальные (FIFO) — автоподбор по-прежнему берёт партию с остатком, если она есть.
(function() {
    var cut = { materialId: 'm1', runLength: 400, plannedRuns: 4 };
    var batches = [
        { id: 'zero', date: '2026-05-01', remainderM: 0, materialId: 'm1', active: '1' },
        { id: 'neg', date: '2026-05-02', remainderM: -18632.519, materialId: 'm1', active: '1' },
        { id: 'short', date: '2026-05-03', remainderM: 399, materialId: 'm1', active: '1' },
        { id: 'ok', date: '2026-06-01', remainderM: 900, materialId: 'm1', active: '1' },
        { id: 'inactive', date: '2026-04-01', remainderM: 1200, materialId: 'm1', active: '0' },
        { id: 'other', date: '2026-04-01', remainderM: 2000, materialId: 'm2', active: '1' }
    ];
    assertEqual(core.availableBatchesForCut(batches, cut).map(function(b) { return b.id; }),
        ['ok', 'zero', 'neg', 'short'],
        '#5075: партии с остатком 0, отрицательным и меньше прохода доступны (после партий с остатком); не в работе и чужое сырьё — нет');
    assertEqual(core.availableBatchesForCut(batches, { materialId: 'm1' }).map(function(b) { return b.id; }),
        ['zero', 'neg', 'short', 'ok'],
        '#5075: без длины прохода — все партии в работе нужного сырья по FIFO, без фильтра по остатку');
    var cov = core.batchCoverage(batches, ['neg', 'ok'], cut);
    assertEqual([cov.coveredRuns, cov.batches.map(function(d) { return d.passes; })], [2, [2, 0]],
        '#5075: перерасход не уменьшает покрытие проходов (проходов у такой партии 0, а не минус)');

    // Пульт: у задания единственная партия — с перерасходом. Она подбирается, строка её показывает.
    var inst = Object.create(Controller.prototype);
    inst.batches = [{ id: '74929', label: '1781038800', date: '', remainderM: -18632.519, materialId: 'm1', active: '1', barcode: '' }];
    inst.selectedBatchIds = [];
    inst.currentCut = { id: '90', batchId: '', materialId: 'm1', runLength: '400', plannedRuns: '4', counterStart: '' };
    inst.findBatch = function(id) { return inst.batches.filter(function(b) { return String(b.id) === String(id); })[0] || null; };
    inst.syncInitialBatchSelection();
    assertEqual([inst.selectedBatchIds, inst.currentCut.batchId, inst.currentCut.counterStart], [['74929'], '74929', ''],
        '#5075: партия с перерасходом подбирается заданию; «Счётчик нач.» из минуса не заполняется');
    var lineEl = inst.renderBatchLine();
    var cells = lineEl.querySelectorAll('.atex-sl-batch-cell').map(function(n) { return n.textContent; });
    assertEqual([cells.indexOf('Проходов: 0') >= 0, cells.filter(function(t) { return t.indexOf('перерасход партии') >= 0; }).length,
        lineEl.textContent.indexOf('не подобрана') >= 0], [true, 1, false],
        '#5075: строка партии — партия видна, «перерасход партии», проходов 0 (не минус)');
})();

// formatEventWhen (время событий смены) продолжает идти по часам планшета — его не трогаем.
assertEqual(core.formatEventWhen('1781038800'), '10.06.2026 04:00',
    '#5075: время событий смены — по-прежнему по часам планшета');

console.log('\n' + passed + '/' + total + ' passed');
