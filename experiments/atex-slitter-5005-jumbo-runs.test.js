// #5005 — распределение резок по джамбо: «Кол-во резок» записи «Номер джамбо»
// копится ОТМЕТКАМИ проходов (каждая отметка кладёт свои проходы в АКТИВНУЮ
// запись), завершение задания сумму по записям СВЕРЯЕТ с фактом резки: недостача
// (отметки до ввода накопления) доносится в активную запись, накопленное общим
// числом задания НЕ перезаписывается. Тогда по записям джамбо видно, сколько
// резок с какого джамбо — на этом считает РМ упаковщика (#5005).
//
// Run with: node experiments/atex-slitter-5005-jumbo-runs.test.js

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
        toggle: function(c, force) {   // setBusy переключает is-busy
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
var Controller = slitter.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
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
    c.syncBatchRemainder = function() { return Promise.resolve(null); };
    c.loadEvents = function() { return Promise.resolve(); };
    c.loadCuts = function() { return Promise.resolve(); };
    c.loadBatches = function() { return Promise.resolve(); };
    c.recordActualRolls = function() { return Promise.resolve(); };
    c.applyEventStatuses = function() {};
    c.advanceToNextCut = function() {};
    c.isCutLocked = function() { return false; };
    c.eventDateTime = function() { return '2026-09-24T10:00:00'; };
    c.findBatch = function() { return { id: '700', remainderM: 20000, materialId: '2086', widthMm: 300 }; };
    return c;
}

function baseCut(over) {
    var cut = {
        id: '500501', batchId: '700', status: 'В работе',
        counterStart: '20000', meterage: '0', actualRuns: '0', plannedRuns: '10', runLength: '450',
        notes: '', materialId: '2086', material: 'MR194',
        jumbos: [], jumboActive: 0
    };
    Object.keys(over || {}).forEach(function(k) { cut[k] = over[k]; });
    return cut;
}

function jumboRecord(id, no, over) {
    var rec = { id: id, jumboNo: no, counterStart: '20000', counterEnd: '',
                cutsCount: '', spent: '', writeoff: '', defectM: '', defectQty: '',
                spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: '' };
    Object.keys(over || {}).forEach(function(k) { rec[k] = over[k]; });
    return rec;
}

function setOf(posts, path) {
    var found = null;
    posts.forEach(function(p) { if (p.path === path) found = p; });
    return found;
}

// ── 1) одна отметка кладёт свои резки в АКТИВНУЮ запись джамбо ──
(function() {
    var c = makeController();
    var rec = jumboRecord('900001', 'qqq');
    c.currentCut = baseCut({ jumbos: [rec] });
    c.markPassDone(false);
    setImmediate(function() {
        var jumboSet = setOf(c.posts, '_m_set/900001?JSON');
        assert(!!jumboSet, 'отметка пишет активную запись джамбо');
        assertEqual(jumboSet && jumboSet.fields['t82378'], 1,
            '#5005: отметка одного прохода кладёт 1 резку в активную запись (82378)');
        assertEqual(rec.cutsCount, 1, '#5005: в модели записи — накопленное 1');
        next();
    });
})();

function next() {
    // ── 2) «✓N Готовы несколько» — одна отметка кладёт N резок ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('900002', 'qqq');
        c.currentCut = baseCut({ actualRuns: '2', jumbos: [rec] });
        c.markPassDone(false, 7);   // target 7 → новых проходов 5
        setImmediate(function() {
            var jumboSet = setOf(c.posts, '_m_set/900002?JSON');
            assertEqual(jumboSet && jumboSet.fields['t82378'], 5,
                '#5005: «✓7» с двумя готовыми кладёт 5 резок (7−2)');
            assertEqual(rec.cutsCount, 5, '#5005: в модели записи — 5');
            next2();
        });
    })();
}

function next2() {
    // ── 3) распределение: 5 резок на qqq, 5 на www — завершение НЕ перезаписывает ──
    (function() {
        var c = makeController();
        var rec1 = jumboRecord('900003', 'qqq');
        var rec2 = jumboRecord('900004', 'www');
        var cut = baseCut({ jumbos: [rec1, rec2] });
        c.currentCut = cut;
        c.markPassDone(false, 5);            // 5 проходов на активном qqq
        setImmediate(function() {
            cut.jumboActive = 1;             // оператор переключил джамбо
            c.markPassDone(false, 10);       // ещё 5 на www — отметка доводит до плана и завершает
            setImmediate(function() {
                assertEqual(cut.jumbos[0].cutsCount, 5, '#5005: на qqq — 5 резок');
                assertEqual(cut.jumbos[1].cutsCount, 5, '#5005: на www — 5 резок');
                var finalSet = setOf(c.posts, '_m_set/900004?JSON');
                // Финальная запись www — ПОСЛЕДНИЙ _m_set этой записи (после завершения).
                var finals = c.posts.filter(function(p) { return p.path === '_m_set/900004?JSON'; });
                finalSet = finals[finals.length - 1];
                assertEqual(finalSet && finalSet.fields['t82378'], 5,
                    '#5005: завершение не перезаписывает накопленное общим числом задания (было бы 10)');
                next3();
            });
        });
    })();
}

function next3() {
    // ── 4) завершение доводит недостачу в активную запись (старые отметки) ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('900005', 'qqq');   // резок не копил — отметки до ввода накопления
        var cut = baseCut({ meterage: String(10 * 450), actualRuns: '10', jumbos: [rec] });
        c.currentCut = cut;
        c.finishCut();
        setImmediate(function() {
            var finals = c.posts.filter(function(p) { return p.path === '_m_set/900005?JSON'; });
            var finalSet = finals[finals.length - 1];
            assertEqual(finalSet && finalSet.fields['t82378'], 10,
                '#5005: завершение доводит недостачу (0 → факт 10) в активную запись');
            next4();
        });
    })();
}

function next4() {
    // ── 5) частично накоплено: доводится только разница ──
    (function() {
        var c = makeController();
        var rec1 = jumboRecord('900006', 'qqq', { cutsCount: '4' });
        var rec2 = jumboRecord('900007', 'www');  // активный, пусто
        var cut = baseCut({ meterage: String(10 * 450), actualRuns: '10', jumbos: [rec1, rec2], jumboActive: 1 });
        c.currentCut = cut;
        c.finishCut();
        setImmediate(function() {
            var finals = c.posts.filter(function(p) { return p.path === '_m_set/900007?JSON'; });
            var finalSet = finals[finals.length - 1];
            assertEqual(finalSet && finalSet.fields['t82378'], 6,
                '#5005: недостача 10−4 доносится в активную запись, накопленное qqq не тронуто');
            assertEqual(cut.jumbos[0].cutsCount, '4', '#5005: qqq остаётся с 4 (не тронут, строкой из отчёта)');
            next5();
        });
    })();
}

function next5() {
    // ── 6) ни факта, ни плана — поле не загрязняется ──
    (function() {
        var c = makeController();
        var rec = jumboRecord('900008', 'qqq');
        var cut = baseCut({ meterage: '900', actualRuns: '', plannedRuns: '', jumbos: [rec] });
        c.currentCut = cut;
        c.finishCut();
        setImmediate(function() {
            var finals = c.posts.filter(function(p) { return p.path === '_m_set/900008?JSON'; });
            var finalSet = finals[finals.length - 1];
            assertEqual(finalSet && finalSet.fields['t82378'], 1,
                '#5005: без факта берётся план (как раньше; plannedRunsForCut отдаёт минимум 1)');
            done();
        });
    })();
}

function done() {
    console.log('\n' + passed + ' assertions passed');
}
