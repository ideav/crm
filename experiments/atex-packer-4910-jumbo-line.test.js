// Tests for ideav/crm#4910 — номер джамбо в РМ упаковщика, задание и короб в одной строке.
//
// Колонка `jumbo` (787045 «Задание в производство → № джамбо») добавлена в отчёт
// `packer` (673812); заполняется при отметке резки, поэтому бывает пустой и её может
// не быть в старых закэшированных строках — разбор обязан это переживать.
// Поведение карточки:
//   • «№ джамбо» — плашкой рядом с артикулом (та же форма, отдельная плашка);
//   • «задание …» и «короб …» — ОДНА строка меты, а не две (карточка не растёт в высоту).
//
// Run with: node experiments/atex-packer-4910-jumbo-line.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-4394-cut-id-links.test.js) ──
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

// Строка отчёта `packer?JSON_KV` (как в atex-packer.test.js) + джамбо из резки.
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '80.00', cut_length: '450.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '110', qty_fact: '110', packed: '', notes: '', events: '1',
        tipo: '62-83 Х 330/450', tipo_id: '671017',
        art: '0011332', jumbo: '102605081738'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

var SIZES = packing.sizesFromReport([
    { size_id: '671017', size_name: '62-83 Х 330/450', add_sleeve: '', rows_cnt: '2', per_row: '12', per_box: '24', box: '№165', w_from: '62.00', w_to: '83.00', l_from: '321', l_to: '450', foil: '' }
]);

function render(over) {
    var self = Object.create(mod.Controller.prototype);
    self.sizes = SIZES;
    return self.renderCard(core.itemFromReportRow(row(over)));
}

// ── Разбор строки отчёта: колонка jumbo ──
assertEqual(core.itemFromReportRow(row()).jumbo, '102605081738', 'itemFromReportRow: номер джамбо');
assertEqual(core.itemFromReportRow(row({ jumbo: '' })).jumbo, '', 'itemFromReportRow: пустой джамбо → пустая строка');
assertEqual(core.itemFromReportRow(row({ jumbo: undefined })).jumbo, '', 'itemFromReportRow: колонки jumbo нет в строке → пусто');
assertEqual(core.itemFromReportRow(row({ jumbo: { val: '123', id: '666' } })).jumbo, '123', 'itemFromReportRow: {val,id} → val');

// ── Карточка: джамбо — плашка рядом с артикулом ──
(function() {
    var card = render();

    var jumbo = card.querySelectorAll('.atex-pk-jumbo');
    assertEqual(jumbo.length, 1, '#4910: плашка «Джамбо» на карточке одна');
    var jt = jumbo.length ? jumbo[0].textContent : '';
    assert(jt.indexOf('Джамбо') !== -1 && jt.indexOf('102605081738') !== -1,
        '#4910: в плашке подпись «Джамбо» и сам номер');
    assert(jumbo.length && jumbo[0].childNodes.some(function(n) { return n.classList.contains('atex-pk-art-value'); }),
        '#4910: номер в плашке тем же узлом-значением, что у артикула (один вид)');

    var art = card.querySelectorAll('.atex-pk-art');
    assertEqual(art.length, 1, '#4910: плашка «Артикул» на месте (регрессия #4799)');
})();

// Пустой джамбо — плашки нет (и дырки в теле карточки тоже).
assertEqual(render({ jumbo: '' }).querySelectorAll('.atex-pk-jumbo').length, 0,
    '#4910: без джамбо плашки нет');
assertEqual(render({ art: '' }).querySelectorAll('.atex-pk-jumbo').length, 1,
    '#4910: джамбо показывается и без артикула — плашки независимы');

// ── Карточка: «задание» и «короб» — одна строка меты ──
(function() {
    var card = render();
    var body = card.querySelector('.atex-pk-body');
    var meta = card.querySelector('.atex-pk-meta');
    assert(!!meta, '#4910: строка меты есть');

    var metaText = meta ? meta.textContent : '';
    assert(metaText.indexOf('задание') !== -1 && metaText.indexOf('короб №165') !== -1,
        '#4910: «задание …» и «короб …» в ОДНОЙ строке (textContent меты содержит оба)');

    // Короб — внутри строки меты (span), а не отдельной строкой body.
    var packInMeta = meta ? meta.childNodes.filter(function(n) { return n.classList.contains('atex-pk-pack'); }) : [];
    assertEqual(packInMeta.length, 1, '#4910: короб — span внутри строки меты');
    var packLines = body ? body.childNodes.filter(function(n) {
        return n.tagName === 'DIV' && n.classList.contains('atex-pk-pack');
    }) : [];
    assertEqual(packLines.length, 0, '#4910: отдельной строки «короб …» в теле карточки больше нет');

    // Разделитель « · » между обычной метой и коробом сохранён.
    var sep = meta ? meta.childNodes.some(function(n) { return n.textContent === ' · '; }) : false;
    assert(sep, '#4910: между метой и коробом разделитель « · »');
})();

// ── СТОРОЖ СТИЛЕЙ: у плашки джамбо есть правила ──────────────────────────────────────
// TEXT-ASSERT-OK (#4751): проверка утверждает о ТЕКСТЕ CSS-файла, и заменить её
// поведением в Node нечем — стиль исполняет браузер, которого в гейте нет. Ловит
// реальную поломку: класс в js есть, а правила в css нет — плашка рисуется голым
// текстом. Обратную сторону (класс переименован только в css) ловит DOM-тест выше.
(function() {
    var fs = require('fs'), path = require('path');
    var css = fs.readFileSync(path.join(__dirname, '..', 'download/atex/css/packer.css'), 'utf8');
    assert(/\.atex-pk-jumbo/.test(css), '#4910: у .atex-pk-jumbo есть стили в packer.css');
    assert(/\.atex-pk-art,\s*\.atex-pk-jumbo\s*\{/.test(css),
        '#4910: плашки артикула и джамбо оформлены общим правилом (один вид)');
})();

console.log('\n' + passed + ' assertions passed');
