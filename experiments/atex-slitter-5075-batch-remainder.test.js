// #5075 — после загрузки остатков (object/1074?import=1) у партий обновился только «Остаток, м²»,
// а «Остаток, м» остался старым: нули, минусы и устаревшие положительные числа. Пульт слиттера
// пересчитывал метры из м² лишь при метрах ≤ 0, поэтому партия 77212 (м² = 2 330 547, м = 52 355)
// работала от устаревшего остатка.
//
// Решение владельца: источник правды остатка — «Остаток, м²». Метры — производная мера:
//   • м² задан → метры берутся из м² по ширине, если они пусты, ≤ 0 или расходятся с м²
//     больше чем на 2 %; в пределах допуска остаются метры счётчика;
//   • м² пуст → метры как есть (в том числе отрицательные), м² досчитывается из положительных метров.
// В строке партии пульта отрицательный остаток помечается «перерасход партии», дата партии
// (главное значение — unix-штамп) выводится по Москве, а не по часовому поясу планшета.
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

// ── 1) Правило «м² — источник правды» на всех сочетаниях входа ─────────────────────────────────
// [m², м до, ширина, ожидаемые м, ожидаемые м², что проверяем]
var CASES = [
    [350, 0, 500, 700, 350, 'м пусто → из м²'],
    [350, -18632.519, 500, 700, 350, 'м отрицательные, м² задан → из м²'],
    [2330547.12, 52354.915, 910, 2561040.791, 2330547.12, 'партия 77212: м устарели (расхождение > 2 %) → из м²'],
    [350, 690, 500, 690, 350, 'м в пределах 2 % от м² (−1,4 %) → метры счётчика остаются'],
    [350, 714, 500, 714, 350, 'м ровно на +2 % → метры счётчика остаются'],
    [350, 715, 500, 700, 350, 'м на +2,1 % → из м²'],
    [-100, 300, 500, -200, -100, 'м² отрицательный (перерасход по м²) → метры из м², м² не перетирается'],
    [0, 700, 500, 700, 350, 'м² пуст, м положительные → м² досчитывается из метров'],
    [0, -50, 500, -50, 0, 'м² пуст, м отрицательные → метры как есть (перерасход виден)'],
    [350, 52354.915, 0, 52354.915, 350, 'ширина неизвестна → пересчёт невозможен, всё как есть']
];
CASES.forEach(function(c) {
    var b = fill([{ id: 'x', materialId: 'm', remainder: c[0], remainderM: c[1], widthMm: c[2] }])[0];
    assertEqual([b.remainderM, b.remainder], [c[3], c[4]], '#5075 fillBatchRemainderM: ' + c[5]);
});

// Ширина из справочника «Вид сырья», когда отчёт её не отдал.
assertEqual(fill([{ id: 'y', materialId: '2090', remainder: 1000, remainderM: 5, widthMm: 0 }], { '2090': 1000 })[0].remainderM,
    1000, '#5075 fillBatchRemainderM: ширина из справочника видов сырья');

// Идемпотентность: повторный вызов (start() и loadBatches зовут его оба) ничего не меняет.
(function() {
    var list = [{ id: 'z', materialId: 'm', remainder: 2330547.12, remainderM: 52354.915, widthMm: 910 }];
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

// formatEventWhen (время событий смены) продолжает идти по часам планшета — его не трогаем.
assertEqual(core.formatEventWhen('1781038800'), '10.06.2026 04:00',
    '#5075: время событий смены — по-прежнему по часам планшета');

console.log('\n' + passed + '/' + total + ' passed');
