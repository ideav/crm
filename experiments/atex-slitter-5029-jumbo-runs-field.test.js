// #5029 — в пульте слиттера панель корешка джамбо уплотнена и показывает число проходов.
//   1) Поле «Проходов» — «Кол-во резок» (82378) АКТИВНОЙ записи «Номера джамбо»: проход
//      пишется выбранному корешку, панель показывает его число, а не задания.
//   2) Поле редактируемое: правка числа проходов записи уходит в базу вместе со счётчиками,
//      «Счётчик кон.» записи смещается на Δпроходов × метраж (погонаж записи = нач. − кон.).
//      Некорректный ввод (отрицательное, дробное) не пишется, в поле возвращается прежнее.
//   3) У черновика (записи ещё нет) поле только для чтения: проходы кладёт отметка резки.
//   4) Поля панели стоят слитно — промежутка между ячейками сетки нет, перенос по ширине
//      (auto-fit) прежний. Проверяется вычисленным стилем по каскаду slitter.css.
//
// Run with: node experiments/atex-slitter-5029-jumbo-runs-field.test.js

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

function fire(input, ev) { (input._listeners[ev] || []).forEach(function(fn) { fn(); }); }

// ── 1) поле «Проходов» показывает резки АКТИВНОЙ записи ──
(function() {
    var c = makeController();
    var rec1 = jumboRecord('920001', 'Z41316', { counterStart: '20000', counterEnd: '18200', cutsCount: '4' });
    var rec2 = jumboRecord('920002', 'Z41321', { counterStart: '18200', counterEnd: '17300', cutsCount: '2' });
    c.currentCut = baseCut({ actualRuns: '6', jumbos: [rec1, rec2], jumboActive: 1 });
    var runs = panelField(c.renderReadings(), 'Проходов');
    assertEqual(!!runs, true, '#5029: на панели корешка есть поле «Проходов»');
    assertEqual(runs && String(runs.value), '2', '#5029: «Проходов» — резки выбранного корешка (2), не задания (6)');
    assertEqual(runs && runs.getAttribute('readonly'), null, '#5029: у записи поле редактируемое');
})();

// ── 2) правка числа проходов: запись, счётчик кон. и запись в базу ──
(function() {
    var c = makeController();
    var rec = jumboRecord('920003', 'Z41316', { counterStart: '20000', counterEnd: '19100', cutsCount: '2' });
    c.currentCut = baseCut({ actualRuns: '2', jumbos: [rec] });
    var wrap = c.renderReadings();
    var runs = panelField(wrap, 'Проходов');
    runs.value = '3';
    fire(runs, 'input');
    fire(runs, 'change');
    assertEqual(String(rec.cutsCount), '3', '#5029: правка пишется в «Кол-во резок» записи');
    assertEqual(Number(rec.counterEnd), 18650, '#5029: кон. записи сдвинут на 1 проход × 450 (19100 → 18650)');
    assertEqual(String(core.jumboMeterage(rec)), '1350', '#5029: погонаж записи = 3 × 450');
    assertEqual(String(panelField(wrap, 'Счётчик кон.').value), '18650', '#5029: панель показывает новый кон. сразу');
    assertEqual(String(panelField(wrap, 'Погонаж факт, м').value), '1350', '#5029: панель показывает новый погонаж сразу');
    var set = jumboPost(c.posts, '920003');
    assertEqual(set && String(set.fields['t82378']), '3', '#5029: «Кол-во резок» (82378) уходит в базу');
    assertEqual(set && Number(set.fields['t791707']), 18650, '#5029: «Счётчик кон.» (791707) уходит в базу');

    // повторные change/blur без правки — второй записи нет
    var n = c.posts.length;
    fire(runs, 'change');
    fire(runs, 'blur');
    assertEqual(c.posts.length, n, '#5029: выход из нетронутого поля базу не трогает');
})();

// ── 2б) пустое начало записи: счётчики не выдумываются, проходы пишутся ──
(function() {
    var c = makeController();
    var rec = jumboRecord('920004', 'Z41316', { cutsCount: '' });
    c.currentCut = baseCut({ jumbos: [rec] });
    var runs = panelField(c.renderReadings(), 'Проходов');
    runs.value = '5';
    fire(runs, 'input');
    fire(runs, 'change');
    assertEqual(String(rec.cutsCount), '5', '#5029: проходы записи без счётчиков записаны');
    assertEqual(rec.counterEnd, '', '#5029: кон. без начала не выдумывается');
    assertEqual(!!jumboPost(c.posts, '920004'), true, '#5029: проходы записи без счётчиков уходят в базу');
})();

// ── 2в) некорректный ввод не пишется ──
(function() {
    var c = makeController();
    var rec = jumboRecord('920005', 'Z41316', { counterStart: '20000', counterEnd: '19100', cutsCount: '2' });
    c.currentCut = baseCut({ jumbos: [rec] });
    var runs = panelField(c.renderReadings(), 'Проходов');
    ['-1', '1.5', 'abc'].forEach(function(bad) {
        runs.value = bad;
        fire(runs, 'input');
        fire(runs, 'change');
        assertEqual([String(rec.cutsCount), String(rec.counterEnd), String(runs.value)], ['2', '19100', '2'],
            '#5029: ввод «' + bad + '» отвергнут, в поле прежнее число');
    });
    assertEqual(jumboPost(c.posts, '920005'), null, '#5029: некорректный ввод в базу не уходит');
})();

// ── 3) черновик — поле только для чтения ──
(function() {
    var c = makeController();
    c.currentCut = baseCut({ jumbos: [] });
    var runs = panelField(c.renderReadings(), 'Проходов');
    assertEqual(!!runs, true, '#5029: у черновика поле «Проходов» тоже есть');
    assertEqual(runs && runs.getAttribute('readonly'), 'readonly', '#5029: у черновика поле только для чтения');
})();

// ── 4) поля панели слитно: вычисленный стиль по каскаду slitter.css ──
(function() {
    var fs = require('fs');
    var path = require('path');
    var sheet = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css', 'slitter.css'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // правила верхнего уровня: содержимое @media (узкие экраны) не берём
    var flat = sheet.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    var rules = [];
    var re = /([^{}]+)\{([^{}]*)\}/g, m, order = 0;
    while ((m = re.exec(flat))) {
        var decls = {};
        m[2].split(';').forEach(function(p) {
            var k = p.indexOf(':');
            if (k > 0) decls[p.slice(0, k).trim()] = p.slice(k + 1).trim();
        });
        m[1].split(',').forEach(function(sel) { rules.push({ sel: sel.trim(), decls: decls, order: order++ }); });
    }
    // DOM панели: .atex-sl-readings > .atex-sl-section > .atex-sl-grid > .atex-sl-field > .atex-sl-input
    var chain = [['atex-sl-readings'], ['atex-sl-section'], ['atex-sl-grid'], ['atex-sl-field'], ['atex-sl-input']];
    function has(d, part) {
        return part.split('.').filter(Boolean).every(function(cl) { return chain[d].indexOf(cl) !== -1; });
    }
    function matches(sel, depth) {
        var parts = sel.split(/\s+/);
        if (parts.some(function(p) { return /[:\[>+~*]/.test(p) || p.charAt(0) !== '.'; })) return false;
        if (!has(depth, parts[parts.length - 1])) return false;
        var d = depth - 1;
        for (var i = parts.length - 2; i >= 0; i--) {
            while (d >= 0 && !has(d, parts[i])) d--;
            if (d < 0) return false;
            d--;
        }
        return true;
    }
    function computed(depth, prop) {
        var best = null;
        rules.forEach(function(r) {
            if (!(prop in r.decls) || !matches(r.sel, depth)) return;
            var spec = (r.sel.match(/\./g) || []).length;
            if (!best || spec > best.spec || (spec === best.spec && r.order > best.order)) {
                best = { spec: spec, order: r.order, v: r.decls[prop] };
            }
        });
        return best ? best.v : null;
    }
    var gap = computed(2, 'gap');
    var gapPx = String(gap || '').split(/\s+/).map(function(s) { return parseFloat(s) || 0; });
    assertEqual(gapPx.every(function(x) { return x === 0; }), true,
        '#5029: между полями панели промежутка нет (gap: ' + gap + ')');
    assertEqual(/auto-fit/.test(String(computed(2, 'grid-template-columns'))), true,
        '#5029: перенос полей по ширине прежний (auto-fit)');
    var radius = computed(4, 'border-radius');
    assertEqual(parseFloat(radius) || 0, 0, '#5029: у сомкнутых полей нет скругления (border-radius: ' + radius + ')');
})();

console.log('\n' + passed + ' assertions passed');
