// #4916 — строка «Номера джамбо» НАД панелью показаний: корешки-закладки.
// Активный корешок — редактируемое поле номера активной записи; остальные записи
// открываются кликом по своему корешку; правее — кнопка «+ Джамбо». Панель показаний
// (счётчики, расход, браки, фото, примечания) — вкладка активного корешка; поля
// «Номер джамбо» в самой сетке больше нет — номер живёт в строке сверху.
//
// Run with: node experiments/atex-slitter-4916-jumbo-tab-row.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-slitter-4914-jumbo-tabs.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, force) {
            var has = self.classList.contains(c);
            var want = force === undefined ? !has : !!force;
            if (want && !has) self.classList.add(c);
            if (!want && has) self.classList.remove(c);
        }
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
StubNode.prototype.setAttribute = function(k, v) {
    this.attributes[k] = String(v);
    if (k === 'value') this.value = String(v);
};
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

var slitter = require('../download/atex/js/slitter.js');
var Controller = slitter.Controller;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// ── Схема 82374 «Номер джамбо» (метаданные ateh, 08.09.2026) ──
var JUMBO_82374 = {
    id: '82374',
    reqs: [
        { id: '82376', val: 'Начальная длина, м' },
        { id: '791706', val: 'Счётчик нач.' },
        { id: '82378', val: 'Кол-во резок' },
        { id: '791707', val: 'Счётчик кон.' },
        { id: '82380', val: 'Конечная длина, м' },
        { id: '82382', val: 'Рабочий расход, м' },
        { id: '82384', val: 'К списанию, м' },
        { id: '82386', val: 'Брак, м' },
        { id: '791708', val: 'Брак, шт' },
        { id: '791712', val: 'Фото брака' }
    ]
};

function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.notify = function() {};
    return c;
}

// ── 1) корешки — отдельная строка над панелью показаний ──
(function() {
    var c = makeController();
    var cut = {
        id: '779317', counterStart: '12510', meterage: '620', notes: '',
        jumbos: [
            { id: '791461', jumboNo: 'C200cp383941', spent: '20', writeoff: '', defectM: '0', defectQty: '' },
            { id: '791431', jumboNo: '123', spent: '', writeoff: '', defectM: '', defectQty: '' }
        ],
        jumboActive: 0
    };
    c.currentCut = cut;
    c.loadJumboRecords = function() { return Promise.resolve(); };
    var rendered = 0;
    c.render = function() { rendered++; };
    var wrap = c.renderReadings();

    assert(wrap.classList.contains('atex-sl-readings'), '#4916: показания — обёртка .atex-sl-readings');
    assertEqual(wrap.childNodes.length, 2, '#4916: в обёртке два узла — строка корешков и панель');
    var tabs = wrap.childNodes[0], panel = wrap.childNodes[1];
    assert(tabs.classList.contains('atex-sl-jumbo-tabs'), '#4916: первая строка обёртки — корешки джамбо');
    assert(panel.classList.contains('atex-sl-section'), '#4916: под корешками — панель показаний (.atex-sl-section)');

    // Активный корешок — редактируемый номер; остальные — кнопки-переключатели.
    var inputs = tabs.childNodes.filter(function(n) { return n.tagName === 'INPUT'; });
    var buttons = tabs.childNodes.filter(function(n) { return n.tagName === 'BUTTON' && n.classList.contains('atex-sl-jumbo-tab'); });
    assertEqual(inputs.length, 1, '#4916: активный номер — один корешок-поле');
    assertEqual(inputs[0] ? inputs[0].value : null, 'C200cp383941', '#4916: в корешке-поле номер АКТИВНОЙ записи');
    assert(!!inputs[0] && inputs[0].classList.contains('is-active'), '#4916: корешок-поле активен');
    assertEqual(buttons.length, 1, '#4916: прочие записи — кнопки-корешки');
    assertEqual(buttons[0] ? buttons[0].textContent : null, '123', '#4916: кнопка подписана номером записи');
    assertEqual(inputs[0] ? tabs.childNodes.indexOf(inputs[0]) : -1, 0, '#4916: активный корешок — на позиции своей записи');

    // В сетке показаний поля «Номер джамбо» больше нет — номер в строке сверху.
    var grid = panel ? panel.querySelector('.atex-sl-grid') : null;
    var labels = grid ? grid.querySelectorAll('.atex-sl-label').map(function(n) { return n.textContent; }) : [];
    assert(labels.length > 0, '#4916: панель показаний с полями отрисована');
    assert(labels.indexOf('Номер джамбо') === -1, '#4916: поля «Номер джамбо» в сетке нет — номер в корешке');
    assert(labels.indexOf('Рабочий расход, м') !== -1, '#4916: расход активной записи — в панели');

    // Клик по чужому корешку переключает запись (и перерисовывает).
    if (buttons[0]) buttons[0].click();
    assertEqual(cut.jumboActive, 1, '#4916: клик по корешку переключает активную запись');
    assert(rendered > 0, '#4916: после переключения пульт перерисовывается');

    // «+ Джамбо» — правее корешков; последним в строке живёт статус сохранения
    // (#4933 п.1: своей строки .atex-sl-section-head у него больше нет).
    var add = tabs.querySelector('.atex-sl-jumbo-add');
    assert(!!add && add.textContent === '+ Джамбо',
        '#4916: «+ Джамбо» — правее корешков');
    var last = tabs.childNodes[tabs.childNodes.length - 1];
    assert(!!last && last.classList.contains('atex-sl-save-status'),
        '#4933 п.1: статус сохранения — последним в строке корешков');
})();

// ── 2) записей нет: корешок-черновик, ввод номера заводит запись автосохранением ──
(function() {
    var c = makeController();
    c.meta = { jumboTable: JUMBO_82374 };
    var cut = { id: '700005', counterStart: '100', meterage: '', notes: '', jumbos: [], jumboActive: 0 };
    c.currentCut = cut;
    c.loadJumboRecords = function() { return Promise.resolve(); };
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '9002' }); };
    var wrap = c.renderReadings();
    var tabs = wrap.childNodes[0];
    var inputs = tabs.childNodes.filter(function(n) { return n.tagName === 'INPUT'; });
    assertEqual(inputs.length, 1, '#4916: без записей корешок-поле один');
    assert(!!inputs[0] && inputs[0].classList.contains('is-active'), '#4916: корешок-черновик активен');
    // #4933 п.1: последним в строке — статус сохранения, «+ Джамбо» перед ним.
    var add = tabs.querySelector('.atex-sl-jumbo-add');
    assert(!!add, '#4916: «+ Джамбо» на месте и без записей');

    // Ввод номера копит черновик; выход из поля сам заводит запись (автосохранение номера).
    if (!inputs[0]) { styleGuard(); return; }
    inputs[0].value = 'C200new';
    inputs[0].dispatch('input');
    assertEqual(cut.pendingJumbo && cut.pendingJumbo.jumboNo, 'C200new', '#4916: ввод в корешке копит черновик');
    inputs[0].dispatch('change');
    setImmediate(function() {
        var created = posts.filter(function(p) { return p.path.indexOf('_m_new/82374?JSON&up=700005') === 0; })[0];
        assert(!!created, '#4916: автосохранение номера заводит запись «Номера джамбо»');
        assertEqual(created && created.fields['t82374'], 'C200new', '#4916: в записи — введённый номер');
        styleGuard();
    });
})();

// ── СТОРОЖ СТИЛЕЙ: корешки должны «приклеиваться» к панели показаний ─────────────
// TEXT-ASSERT-OK (#4751): проверка утверждает о ТЕКСТЕ CSS-файла, и заменить её
// поведением в Node нечем — стиль исполняет браузер, которого в гейте нет. Ловит
// реальную поломку: класс в js есть, правила в css нет — корешки рисуются без формы.
function styleGuard() {
    var fs = require('fs'), path = require('path');
    var css = fs.readFileSync(path.join(__dirname, '..', 'download/atex/css/slitter.css'), 'utf8');
    assert(/\.atex-sl-jumbo-tab\s*\{[^}]*border-radius:\s*8px 8px 0 0/.test(css),
        '#4916: корешки прямоугольные сверху (radius 8px 8px 0 0) — форма закладки');
    assert(/\.atex-sl-jumbo-tab\.is-active\s*\{[^}]*margin-bottom:\s*-1px/.test(css),
        '#4916: активный корешок перекрывает верхнюю грань панели (открыт во вкладку)');
    assert(/\.atex-sl-readings \.atex-sl-section\s*\{/.test(css),
        '#4916: у панели показаний есть правило присоединения корешков (.atex-sl-readings .atex-sl-section)');
    done();
}

function done() {
    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (process.exitCode) process.exit(process.exitCode);
}
