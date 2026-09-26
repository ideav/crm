// #5010 — «Для каждой записи о джамбо выводить её значения». Панель показаний
// показывает и ведёт счётчики («Счётчик нач.», «Счётчик кон.», «Погонаж факт»)
// АКТИВНОЙ записи джамбо, а не задания: отметка резки пишёт счётчики в запись
// (пустое начало наследует счётчик резки, кон. — по погонажу записи), правка
// «Счётчика нач.» смещает кон. на ту же дельту, завершение записи счётчики
// не перетирает, остаток партии сводится с концом активной записи.
//
// Run with: node experiments/atex-slitter-5010-jumbo-values.test.js

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

var slitter = require('../download/atex/js/slitter.js');
var core = slitter.core;
var Controller = slitter.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

// ── Боевая схема 82374 «Номер джамбо» (как в atex-slitter-4914) ──
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

function cutMeta() {
    return {
        id: '1078',
        reqs: [
            { id: '1164', val: 'Счётчик нач.' }, { id: '1166', val: 'Счётчик кон.' },
            { id: '1168', val: 'Погонаж факт, м' }, { id: '24305', val: 'Метраж, м' },
            { id: '657315', val: 'Кол-во резок факт' }, { id: '1161', val: 'Начато' },
            { id: '1162', val: 'В работе' }, { id: '1171', val: 'Примечания' },
            { id: '3861x', val: 'Расход сырья' },
            { id: '787042', val: 'Рабочий расход, м' }, { id: '787043', val: 'К списанию, м' },
            { id: '8458', val: 'Брак, м' }, { id: '785730', val: 'Брак, шт' },
            { id: '82', val: 'Брак, м²' }
        ]
    };
}

function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.db = 'testdb';
    c.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
    c.notify = function() {};
    c.render = function() {};
    c.post = function(path, fields) { c.posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.posts = [];
    c.createEvent = function() { return Promise.resolve({}); };
    c.syncBatchRemainder = function(cut, counterEnd, finishMode) {
        c.syncs.push({ counterEnd: counterEnd, finishMode: finishMode });
        return Promise.resolve(null);
    };
    c.syncs = [];
    c.loadEvents = function() { return Promise.resolve(); };
    c.loadCuts = function() { return Promise.resolve(); };
    c.loadBatches = function() { return Promise.resolve(); };
    c.recordActualRolls = function() { return Promise.resolve(); };
    c.applyEventStatuses = function() {};
    c.advanceToNextCut = function() {};
    c.isCutLocked = function() { return false; };
    c.eventDateTime = function() { return '2026-09-26T10:00:00'; };
    c.findBatch = function() { return { id: '700', remainderM: 20000, materialId: '2086', widthMm: 300 }; };
    c.loadJumboRecords = function() {};
    return c;
}

function baseCut(over) {
    var cut = {
        id: '501001', batchId: '700', status: 'В работе',
        counterStart: '20000', meterage: '0', actualRuns: '0', plannedRuns: '10', runLength: '450',
        notes: '', materialId: '2086', material: 'MWR118',
        jumbos: [], jumboActive: 0
    };
    Object.keys(over || {}).forEach(function(k) { cut[k] = over[k]; });
    return cut;
}

function jumboRecord(id, no, over) {
    var rec = { id: id, jumboNo: no, counterStart: '', counterEnd: '',
                cutsCount: '', spent: '', writeoff: '', defectM: '', defectQty: '',
                spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: '' };
    Object.keys(over || {}).forEach(function(k) { rec[k] = over[k]; });
    return rec;
}

function jumboPost(posts, id) {
    var found = null;
    posts.forEach(function(p) { if (p.path === '_m_set/' + id + '?JSON') found = p; });
    return found;
}

// Поле панели по подписи: label.atex-sl-field > span.atex-sl-label + control.
function panelField(wrap, label) {
    var fields = wrap.querySelectorAll('.atex-sl-field');
    for (var i = 0; i < fields.length; i++) {
        var span = fields[i].querySelector('.atex-sl-label');
        if (span && span.textContent === label) return fields[i].childNodes[1];
    }
    return null;
}

var steps = [];
function step(fn) { steps.push(fn); run(); }
function run() {
    if (!steps.length) { console.log('\n' + passed + ' assertions passed'); return; }
    steps.shift()();
}

// ── 1) отметка пишет счётчики в АКТИВНУЮ запись: начало наследует резку,
//      кон. = начало − резки×метраж ──
step(function() {
    var c = makeController();
    var rec = jumboRecord('910001', 'Z41316');
    c.currentCut = baseCut({ jumbos: [rec] });
    c.markPassDone(false);
    setImmediate(function() {
        assertEqual(rec.counterStart, '20000', '#5010: пустое начало записи наследует счётчик резки');
        assertEqual(rec.counterEnd, 19550, '#5010: кон. записи = начало − 1 резка × 450');
        var set = jumboPost(c.posts, '910001');
        assertEqual(set && set.fields['t791706'], '20000', '#5010: «Счётчик нач.» записи уходит в базу (791706)');
        assertEqual(set && set.fields['t791707'], 19550, '#5010: «Счётчик кон.» записи уходит в базу (791707)');
        step2();
    });
});

function step2() {
    // ── 2) вторая отметка той же записи: кон. уменьшается накопительно ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('910002', 'Z41316', { counterStart: '20000', counterEnd: '19550', cutsCount: '1' });
        c.currentCut = baseCut({ actualRuns: '1', jumbos: [rec] });
        c.markPassDone(false);
        setImmediate(function() {
            assertEqual(rec.counterEnd, 19100, '#5010: вторая отметка доводит кон. записи до 19100 (20000−2×450)');
            assertEqual(core.jumboMeterage(rec), 900, '#5010: погонаж записи = нач. − кон. = 900');
            step3();
        });
    })();
}

function step3() {
    // ── 3) отметка на второй записи не трогает счётчики первой ──
    (function() {
        var c = makeController();
        var rec1 = jumboRecord('910003', 'Z41316', { counterStart: '20000', counterEnd: '19550', cutsCount: '1' });
        var rec2 = jumboRecord('910004', 'Z41321', { counterStart: '19550' });
        c.currentCut = baseCut({ actualRuns: '1', jumbos: [rec1, rec2], jumboActive: 1 });
        c.markPassDone(false);
        setImmediate(function() {
            assertEqual(rec1.counterEnd, '19550', '#5010: неактивная запись счётчики не меняет');
            assertEqual(rec2.counterEnd, 19100, '#5010: активная запись ведёт свою цепочку с её начала');
            step4();
        });
    })();
}

function step4() {
    // ── 4) завершение: свой кон. сохраняется, пустое начало наследует резку ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('910005', 'Z41316', { counterStart: '20000', counterEnd: '15800', cutsCount: '10' });
        c.currentCut = baseCut({ meterage: String(10 * 450), actualRuns: '10', jumbos: [rec] });
        c.finishCut();
        setImmediate(function() {
            assertEqual(rec.counterEnd, '15800', '#5010: завершение не перетирает кон. записи заданиевым (20000−10×450=15500 был бы перетерт)');
            var c2 = makeController();
            var rec2 = jumboRecord('910006', 'Z41316');
            c2.currentCut = baseCut({ meterage: String(10 * 450), actualRuns: '10', jumbos: [rec2] });
            c2.finishCut();
            setImmediate(function() {
                assertEqual(rec2.counterStart, '20000', '#5010: финал — пустое начало записи наследует счётчик резки');
                assertEqual(rec2.counterEnd, '15500', '#5010: финал — кон. доведён по резкам записи');
                step5();
            });
        });
    })();
}

function step5() {
    // ── 5) правка «Счётчика нач.» на панели: кон. записи смещается на дельту ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('910007', 'Z41316', { counterStart: '20000', counterEnd: '19550' });
        c.currentCut = baseCut({ jumbos: [rec] });
        var wrap = c.renderReadings();
        var startInput = panelField(wrap, 'Счётчик нач.');
        assertEqual(startInput && startInput.value, '20000', '#5010: панель показывает начало АКТИВНОЙ записи');
        startInput.value = '20500';
        (startInput._listeners.input || []).forEach(function(fn) { fn(); });
        (startInput._listeners.change || []).forEach(function(fn) { fn(); });
        assertEqual(rec.counterStart, '20500', '#5010: правка начала пишется в запись');
        assertEqual(rec.counterEnd, 20050, '#5010: кон. смещён на ту же дельту (+500) — погонаж записи не менялся');
        assertEqual(String(core.jumboMeterage(rec)), '450', '#5010: погонаж записи при правке начала неизменен');
        step6();
    })();
}

function step6() {
    // ── 6) панель показывает значения активной записи, а не задания ──
    (function() {
        var c = makeController();
        var rec1 = jumboRecord('910008', 'Z41316', { counterStart: '20000', counterEnd: '500' });
        var rec2 = jumboRecord('910009', 'Z41321', { counterStart: '500', counterEnd: '50' });
        c.currentCut = baseCut({ counterStart: '3294.638', meterage: '19800', jumbos: [rec1, rec2], jumboActive: 1 });
        var wrap = c.renderReadings();
        assertEqual(panelField(wrap, 'Счётчик нач.') && panelField(wrap, 'Счётчик нач.').value, '500',
            '#5010: панель на второй закладке показывает её начало, а не счётчик резки');
        assertEqual(String(panelField(wrap, 'Погонаж факт, м').value), '450',
            '#5010: «Погонаж факт» — погонаж записи (нач. − кон.), не задания');
        assertEqual(String(panelField(wrap, 'Счётчик кон.').value), '50',
            '#5010: «Счётчик кон.» — кон. записи, не нач.резки − погонаж задания (отрицательный)');
        step7();
    })();
}

function step7() {
    // ── 7) остаток партии сводится с концом АКТИВНОЙ записи ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('910010', 'Z41316');
        c.currentCut = baseCut({ jumbos: [rec] });
        c.markPassDone(false);
        setImmediate(function() {
            assertEqual(c.syncs.length >= 1, true, '#5010: отметка сводит остаток партии');
            assertEqual(c.syncs[c.syncs.length - 1].counterEnd, 19550,
                '#5010: остаток партии сводится с кон. записи, а не с заданиевым нач.−погонаж задания');
            run();
        });
    })();
}
