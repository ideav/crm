// Tests for ideav/crm#5022 — артикул в РМ упаковщика стоит напротив СВОЕЙ позиции.
//
// На слитой плашке заказа (#4918) каждая строка описания — своя позиция со своим
// количеством (#4999). Артикул у позиций разный, поэтому плашка «Артикул» ставится
// хвостом КАЖДОЙ строки .atex-pk-desc со значением её позиций, а не одним списком
// «A-1, B-2» у последней строки. То же на карточке «Следующие задания» (#4929).
//   • у каждой строки описания — своя плашка со своим артикулом;
//   • у строки без артикула плашки нет, соседние строки её не теряют;
//   • одиночная позиция — как прежде, одна плашка хвостом строки (#4930).
//
// Run with: node experiments/atex-packer-5022-art-per-line.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-packer-4930-art-in-desc.test.js) ──
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
    get: function() { return this._text + this.childNodes.map(function(c) { return c.textContent; }).join(''); },
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
var packing = require('../download/atex/js/packaging-size.js').core;

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

// Строка отчёта `packer?JSON_KV` — по мотивам заказа 5554 со скриншота #5022.
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '5554', order: '',
        material: 'MR194', cut_width: '110.00', cut_length: '74.00',
        wind_direction: 'OUT', sleeve: 'Втулка картонная', add_sleeve: '',
        qty: '2', qty_fact: '2', packed: '', notes: '', events: '1',
        tipo: '62-83 Х 330/450', tipo_id: '671017',
        art: '00012215'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

var SIZES = packing.sizesFromReport([
    { size_id: '671017', size_name: '62-83 Х 330/450', add_sleeve: '', rows_cnt: '2', per_row: '12', per_box: '24', box: '№165', w_from: '50.00', w_to: '120.00', l_from: '50', l_to: '450', foil: '' }
]);

function controller() {
    var self = Object.create(mod.Controller.prototype);
    self.sizes = SIZES;
    self.jumbos = {};
    return self;
}
function render(overs) {
    var self = controller();
    self.items = overs.map(function(over) { return core.itemFromReportRow(row(over)); });
    self.applyJumbos();
    var group = core.groupByOrder(self.items)[0];
    return self.renderCard(group.items.length === 1 ? group.items[0] : group);
}
function renderNext(overs) {
    var items = overs.map(function(over) { return core.itemFromReportRow(row(over)); });
    return controller().renderNextCard({ items: items, slitter: 'Станок 3', taskUnix: 1786078800 });
}

// Для каждой строки описания — значения её плашек «Артикул» (пустой массив — плашки нет).
function artsPerLine(card) {
    return card.querySelectorAll('.atex-pk-desc').map(function(d) {
        return d.querySelectorAll('.atex-pk-art-value').map(function(v) { return v.textContent; });
    });
}

// ── Слитая плашка: артикул напротив своей позиции ──
(function() {
    var card = render([
        { gp_id: 'a', art: '00012215', qty: '2' },
        { gp_id: 'b', art: '00013805', cut_width: '55.00', qty: '12' }
    ]);
    assertEqual(artsPerLine(card), [['00012215'], ['00013805']],
        '#5022: у каждой строки слитой плашки — свой артикул, без списка через «, »');
})();

// Строка без артикула — без плашки; соседняя свою не теряет.
(function() {
    var card = render([
        { gp_id: 'a', art: '' },
        { gp_id: 'b', art: '00013805', cut_width: '55.00', qty: '12' }
    ]);
    assertEqual(artsPerLine(card), [[], ['00013805']],
        '#5022: у позиции без артикула плашки нет, у соседней — её собственный');
    var card2 = render([
        { gp_id: 'a', art: '00012215' },
        { gp_id: 'b', art: '', cut_width: '55.00', qty: '12' }
    ]);
    assertEqual(artsPerLine(card2), [['00012215'], []],
        '#5022: артикул первой позиции не уезжает к последней строке');
})();

// Схлопнутые повторы одной строки — артикул один раз.
(function() {
    var card = render([
        { gp_id: 'a', art: '00012215' },
        { gp_id: 'b', art: '00012215' },
        { gp_id: 'c', art: '00013805', cut_width: '55.00', qty: '12' }
    ]);
    assertEqual(artsPerLine(card), [['00012215'], ['00013805']],
        '#5022: повтор строки не дублирует артикул');
})();

// Одиночная позиция — одна плашка хвостом строки описания (#4930).
(function() {
    var card = render([{}]);
    assertEqual(artsPerLine(card), [['00012215']], '#5022: одиночная позиция — как прежде');
})();

// «Следующие задания» (#4929): тоже по строкам.
(function() {
    var card = renderNext([
        { gp_id: 'a', art: '00012215' },
        { gp_id: 'b', art: '00013805', cut_width: '55.00' }
    ]);
    assertEqual(artsPerLine(card), [['00012215'], ['00013805']],
        '#5022: на карточке следующего задания артикул — у своей строки');
})();

console.log('\n' + passed + ' проверок прошло');
