// Tests for ideav/crm#4930 — артикул в РМ упаковщика живёт в строке описания.
//
// Плашка «Артикул» ставится хвостом ПОСЛЕДНЕЙ строки .atex-pk-desc (в той же
// строке, что описание ролика), а не отдельной строкой внизу тела карточки:
//   • span.atex-pk-art — потомок последней .atex-pk-desc, после текста описания;
//   • прямого ребёнка .atex-pk-art у .atex-pk-body больше нет;
//   • на слитой плашке (#4918) — уникальные артикулы через «, » там же;
//   • плашка «Джамбо» (#4910) остаётся отдельной строкой внизу — её не трогаем.
//
// Run with: node experiments/atex-packer-4930-art-in-desc.test.js

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
// В отличие от стаба #4910: текст, заданный ДО appendChild, не теряется (как в
// реальном DOM, где textContent= создаёт текстовый узел перед добавленными детьми).
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
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// Строка отчёта `packer?JSON_KV` (как в atex-packer-4910-jumbo-line.test.js).
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '80.00', cut_length: '450.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '110', qty_fact: '110', packed: '', notes: '', events: '1',
        tipo: '62-83 Х 330/450', tipo_id: '671017',
        art: '0011332'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

var SIZES = packing.sizesFromReport([
    { size_id: '671017', size_name: '62-83 Х 330/450', add_sleeve: '', rows_cnt: '2', per_row: '12', per_box: '24', box: '№165', w_from: '62.00', w_to: '83.00', l_from: '321', l_to: '450', foil: '' }
]);

// Рендер карточки: одна позиция или слитая плашка заказа (#4918) — по числу строк.
function render(overs, jumbos) {
    var self = Object.create(mod.Controller.prototype);
    self.sizes = SIZES;
    self.jumbos = jumbos || {};
    self.items = overs.map(function(over) { return core.itemFromReportRow(row(over)); });
    self.applyJumbos();
    var group = core.groupByOrder(self.items)[0];
    return self.renderCard(group.items.length === 1 ? group.items[0] : group);
}

// ── Артикул — хвостом последней строки описания ──
(function() {
    var card = render([{}]);
    var art = card.querySelectorAll('.atex-pk-art');
    assertEqual(art.length, 1, '#4930: плашка «Артикул» на карточке одна (регрессия #4799)');
    var at = art.length ? art[0].textContent : '';
    assert(at.indexOf('Артикул') !== -1 && at.indexOf('0011332') !== -1,
        '#4930: в плашке подпись «Артикул» и значение (регрессия #4799)');

    var descs = card.querySelectorAll('.atex-pk-desc');
    assert(descs.length > 0, '#4930: строка описания есть');
    var last = descs[descs.length - 1];
    assert(art.length && art[0].parentNode === last,
        '#4930: артикул — потомок ПОСЛЕДНЕЙ .atex-pk-desc (та же строка, что описание)');
    assert(art.length && last.childNodes.indexOf(art[0]) === last.childNodes.length - 1 &&
           String(last.textContent).indexOf('MWR113L') === 0,
        '#4930: плашка стоит ПОСЛЕ текста описания, текст остаётся первым');

    var body = card.querySelector('.atex-pk-body');
    var artLines = body ? body.childNodes.filter(function(n) { return n.classList.contains('atex-pk-art'); }) : [];
    assertEqual(artLines.length, 0, '#4930: отдельной строки «Артикул» в теле карточки больше нет');
})();

// Пустой артикул — плашки нет, описание без хвоста.
(function() {
    var card = render([{ art: '' }]);
    assertEqual(card.querySelectorAll('.atex-pk-art').length, 0, '#4930: без артикула плашки нет');
    var descs = card.querySelectorAll('.atex-pk-desc');
    var last = descs[descs.length - 1];
    assertEqual(last.childNodes.filter(function(n) { return n.tagName !== '#TEXT'; }).length, 0,
        '#4930: описание без артикула — чистый текст, без пустых узлов');
})();

// Слитая плашка заказа (#4918): уникальные артикулы через «, » в последней строке описания.
(function() {
    var card = render([
        { gp_id: 'a', art: 'A-1' },
        { gp_id: 'b', cut_width: '110.00', art: 'B-2' },
        { gp_id: 'c', cut_width: '110.00', art: 'B-2' }
    ]);
    var art = card.querySelectorAll('.atex-pk-art');
    assertEqual(art.length, 1, '#4930/#4918: на слитой плашке плашка артикула одна');
    var value = art.length ? art[0].querySelectorAll('.atex-pk-art-value')[0] : null;
    assertEqual(value ? value.textContent : null, 'A-1, B-2',
        '#4930/#4918: уникальные артикулы через «, »');
    var descs = card.querySelectorAll('.atex-pk-desc');
    assert(art.length && art[0].parentNode === descs[descs.length - 1],
        '#4930/#4918: и на слитой плашке артикул — в последней строке описания');
})();

// Джамбо (#4910) остаётся отдельной плашкой в теле карточки — её #4930 не трогает.
(function() {
    var card = render([{}], { '666355': ['102605081738'] });
    var body = card.querySelector('.atex-pk-body');
    var jumboLines = body ? body.childNodes.filter(function(n) { return n.classList.contains('atex-pk-jumbo'); }) : [];
    assertEqual(jumboLines.length, 1, '#4930: плашка «Джамбо» — по-прежнему прямой ребёнок тела карточки');
    var descs = card.querySelectorAll('.atex-pk-desc');
    assertEqual(descs.some ? descs.filter(function(d) { return d.querySelectorAll('.atex-pk-jumbo').length; }).length : 0, 0,
        '#4930: джамбо в строку описания не переезжает');
})();

console.log('\n' + passed + ' проверок прошло');
