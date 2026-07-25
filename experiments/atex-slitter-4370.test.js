// #4370 — пульт слиттера:
//   1) при смене станка (и даты) не очищалась подсказка «бесшовное продолжение смены»
//      (.atex-sl-seamless): под списком другого станка висело неактуальное «не трогайте ножи».
//      Корень: computeSeamless считается ТОЛЬКО в openCut, а обработчики тулбара сбрасывали
//      currentCut/currentCutId/selectedBatchIds — но не seamlessNotice (и не currentStrips).
//   2) проверка точки отсчёта: при выполнении заданий СЛЕДУЮЩИХ дней (#4332 п.4) «следующий
//      день» считается от ОТКРЫТОГО задания, а не от выбранного в тулбаре дня и не от
//      последнего задания прошедшего дня.
//
// Run with: node experiments/atex-slitter-4370.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (без jsdom, как atex-slitter-4365.test.js) ────────────────────────────
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
    this.selected = false;
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, on) { if (on) this.add(c); else this.remove(c); }
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
    get: function() { return ''; }, set: function() { this.childNodes = []; }
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

var D23 = '2026-07-23', D24 = '2026-07-24', D25 = '2026-07-25';
function stamp(dayISO, hhmm) { return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000)); }
function cut(id, dayISO, hhmm, opts) {
    var o = opts || {};
    return { id: id, slitterId: o.m || 'm1', planDate: stamp(dayISO, hhmm), status: o.status || 'Ожидает',
             materialId: o.mat || '5', material: 'ПЭТ', winding: 'OUT', runLength: 450, plannedRuns: 2 };
}

function makeInst() {
    var inst = Object.create(Controller.prototype);
    inst.db = 'ateh';
    inst.selectedSlitterId = 'm1';
    inst.selectedDate = D23;
    inst.slitters = [{ id: 'm1', label: 'Станок 1' }, { id: 'm2', label: 'Станок 2' }];
    inst.cuts = [
        cut('1', D23, '08:00', { status: 'Завершена' }),
        cut('2', D23, '14:00', { status: 'Завершена' }),   // последняя резка выбранного дня
        cut('10', D24, '08:00'),                            // задания следующего дня (#4332 п.4)
        cut('11', D24, '14:00'),
        cut('20', D25, '08:00')
    ];
    inst.batches = [];
    inst.shiftEvents = [];
    inst.materialWidths = {};
    inst.currentStrips = [{ width: 145 }, { width: 145 }, { width: 145 }];
    inst.toolbarEl = new StubNode('div');
    inst.cutsEl = new StubNode('div');
    inst.sidebarTitleEl = new StubNode('div');
    inst.seamlessEl = new StubNode('div');
    inst.isShiftOpen = function() { return true; };
    inst.findBatch = function() { return null; };
    inst.storeSelectedSlitter = function() {};
    inst.loadCuts = function() { return Promise.resolve([]); };
    inst.loadShiftEvents = function() { return Promise.resolve([]); };
    inst.render = function() { this.renderSeamless(); };
    inst.currentCutId = '2';
    inst.currentCut = inst.cuts[1];
    inst.seamlessNotice = { cutId: '2', slitterId: 'm1',
        nextCut: { id: '10', label: '24.07.2026 08:00' }, sameKnives: true, sameMaterial: true };
    return inst;
}
function seamlessTexts(inst) {
    inst.renderSeamless();
    return inst.seamlessEl.childNodes.map(function(n) { return n.textContent; });
}

// ── симптом тикета: смена станка гасит подсказку прежней резки ─────────────────────────────────
(function() {
    var inst = makeInst();
    assert(seamlessTexts(inst).length === 2,
        '#3609: у последней резки смены подсказка показана (сырьё + ножи)');
    inst.renderToolbar();
    var select = inst.toolbarEl.querySelectorAll('atex-sl-select')[0];
    select.value = 'm2';
    select.dispatch('change');
    assert(inst.seamlessNotice === null, '#4370: смена станка ОЧИЩАЕТ подсказку о бесшовной смене');
    assert(inst.currentStrips.length === 0, '#4370: полосы прежней резки тоже сброшены');
    assert(seamlessTexts(inst).length === 0, '#4370: под списком нового станка предупреждений нет');
})();

// ── смена даты — то же самое ───────────────────────────────────────────────────────────────────
(function() {
    var inst = makeInst();
    inst.renderToolbar();
    var dateInp = inst.toolbarEl.querySelectorAll('atex-sl-input')[0];
    dateInp.value = D24;
    dateInp.dispatch('change');
    assert(inst.seamlessNotice === null && inst.currentCut === null,
        '#4370: смена даты очищает и выбранную резку, и её подсказку');
    assert(seamlessTexts(inst).length === 0, '#4370: после смены даты подсказки нет');
})();

// ── страховка рендера: подсказка живёт только вместе со «своей» резкой ─────────────────────────
(function() {
    var inst = makeInst();
    inst.currentCut = inst.cuts[2];   // открыли другую резку (id 10)
    inst.currentCutId = '10';
    assert(seamlessTexts(inst).length === 0,
        '#4370: подсказка от ДРУГОЙ резки не рисуется (даже если её забыли сбросить)');
    var other = makeInst();
    other.selectedSlitterId = 'm2';   // станок сменили, подсказка осталась от m1
    assert(seamlessTexts(other).length === 0,
        '#4370: подсказка чужого станка не рисуется');
})();

// ── точка отсчёта: задание СЛЕДУЮЩЕГО дня считается от себя, а не от прошедшего дня ────────────
// Сцена: в тулбаре 23.07, оператор под той же сменой выполняет задания 24.07 (#4332 п.4).
// Открыта резка 11 — ПОСЛЕДНЯЯ 24.07. Сравнивать её надо с первой резкой 25.07.
function reportRows() {
    return [
        // 24.07, первая — совпадает с последней 23.07 (ловушка: если отсчёт от 23.07,
        // «следующей» окажется она, и подсказка будет про 24.07)
        { task_id: '10', task_start: stamp(D24, '08:00'), width: '145', material_id: '5', batch_ord: '1' },
        { task_id: '10', task_start: stamp(D24, '08:00'), width: '145', material_id: '5', batch_ord: '2' },
        { task_id: '10', task_start: stamp(D24, '08:00'), width: '145', material_id: '5', batch_ord: '3' },
        // 24.07, последняя — её и выполняет оператор
        { task_id: '11', task_start: stamp(D24, '14:00'), width: '145', material_id: '5', batch_ord: '1' },
        // 25.07, первая — вот с ней сравниваем (те же ножи, другое сырьё)
        { task_id: '20', task_start: stamp(D25, '08:00'), width: '145', material_id: '7', batch_ord: '1' },
        { task_id: '20', task_start: stamp(D25, '08:00'), width: '145', material_id: '7', batch_ord: '2' },
        { task_id: '20', task_start: stamp(D25, '08:00'), width: '145', material_id: '7', batch_ord: '3' }
    ];
}
(function() {
    var inst = makeInst();
    inst.currentCut = inst.cuts[3];    // резка 11 — последняя 24.07
    inst.currentCutId = '11';
    inst.seamlessNotice = null;
    inst.currentStrips = [{ width: 145 }, { width: 145 }, { width: 145 }];
    var urls = [];
    inst.getJson = function(path) { urls.push(path); return Promise.resolve(reportRows()); };
    inst.computeSeamless().then(function() {
        var n = inst.seamlessNotice;
        assert(!!n && n.nextCut.id === '20',
            '#4370: у задания 24.07 «следующая резка» — первая 25.07 (отсчёт от текущего задания)');
        assert(!!n && n.nextCut.id !== '10',
            '#4370: НЕ первая резка 24.07 (это был бы отсчёт от последнего задания прошедшего дня)');
        assert(!!n && n.sameKnives === true && n.sameMaterial === false,
            '#3609/#3737: ножи совпадают (145×3), сырьё разное → предупреждение только про ножи');
        assert(!!n && n.cutId === '11' && n.slitterId === 'm1',
            '#4370: подсказка помечена своей резкой и своим станком');
        assert(urls[0].indexOf('FR_task_start=' + encodeURIComponent('>' + core.dayStartTimestamp(stamp(D24, '00:00')))) !== -1,
            '#4370: отчёт next_cut_setup запрашивается с полуночи ДНЯ ТЕКУЩЕГО задания (24.07)');
        assert(seamlessTexts(inst).length === 1 && seamlessTexts(inst)[0].indexOf('ножи') !== -1,
            '#4370: подсказка нарисована у своей резки');

        // не последняя резка своего дня → подсказки нет вовсе
        var mid = makeInst();
        mid.currentCut = mid.cuts[2];   // резка 10 — первая 24.07
        mid.currentCutId = '10';
        mid.seamlessNotice = null;
        mid.getJson = function() { return Promise.resolve(reportRows()); };
        return mid.computeSeamless().then(function() {
            assert(mid.seamlessNotice === null,
                '#3609: у НЕпоследней резки дня подсказки нет (день продолжится на том же станке)');
        });
    }).then(function() {
        console.log('\n' + passed + '/' + total + ' assertions passed');
        if (passed !== total) process.exitCode = 1;
    });
})();
