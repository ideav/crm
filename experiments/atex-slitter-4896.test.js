// #4896 — РМ слиттера: поле «Брак, шт» рядом с «Брак, м».
//
// ТЗ (issue #4896): «Заносить в него количество бракованных рулонов, вместо
// (или вместе с ним) метража с браком». Реквизит заведён в боевой схеме
// «Задание в производство» (1078): 785730 «Брак, шт»; в report/slitter_cuts
// колонка cut_defect_qty. Проверяем поведение:
//   1. cutFields пишет «Брак, шт» по имени реквизита (id не хардкодятся);
//   2. «Брак, м» при этом не теряется, пустое шт полностью перезаписывает старое;
//   3. на сборке без реквизита поле молча пропускается (как остальные req-поля);
//   4. правка шт меняет подпись показаний — автосохранение по выходу из ячейки срабатывает;
//   5. очередь из report/slitter_cuts несёт cut_defect_qty;
//   6. в секции показаний поле стоит сразу после «Брак, м», ввод уходит в _m_set.
//
// Run with: node experiments/atex-slitter-4896.test.js

process.env.TZ = 'Europe/Moscow';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

// ── Минимальный DOM-стаб (как в atex-slitter-4783.test.js) ────────────────────────────────────
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
Object.defineProperty(StubNode.prototype, 'innerHTML', {
    get: function() { return ''; }, set: function() { this.childNodes = []; this._text = ''; }
});
StubNode.prototype.appendChild = function(node) { this.childNodes.push(node); node.parentNode = this; return node; };
StubNode.prototype.removeChild = function(node) {
    this.childNodes = this.childNodes.filter(function(c) { return c !== node; });
    node.parentNode = null; return node;
};
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
    getElementById: function() { return null; }, addEventListener: function() {},
    querySelector: function() { return null; }
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
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// ── Боевая схема 1078 «Задание в производство» (метаданные ateh из issue #4896) ───────────────
var SCHEMA_1078 = {
    id: '1078',
    reqs: [
        { id: '1156', val: 'Слиттер' },
        { id: '95358', val: 'Вид сырья' },
        { id: '1164', val: 'Счётчик нач.' },
        { id: '1170', val: 'Счётчик кон.' },
        { id: '8457', val: 'Брак, м²' },
        { id: '8458', val: 'Брак, м' },
        { id: '8460', val: 'Фото брака' },
        { id: '1171', val: 'Примечания' },
        { id: '785730', val: 'Брак, шт' }
    ]
};
// Та же сборка БЕЗ нового реквизита (старая база — поле не должно ронять сохранение).
var SCHEMA_1078_OLD = {
    id: '1078',
    reqs: SCHEMA_1078.reqs.filter(function(r) { return r.id !== '785730'; })
};

function makeInst(cut, meta) {
    var inst = Object.create(Controller.prototype);
    inst.meta = { cut: meta || SCHEMA_1078 };
    inst.busy = false;
    inst.root = new StubNode('div');
    inst.currentCut = cut;
    inst.posts = [];
    inst.post = function(p, params) { this.posts.push({ path: p, params: params }); return Promise.resolve({}); };
    inst.notify = function() {};
    return inst;
}
function baseCut() {
    return {
        id: '90', counterStart: '1000', counterEnd: '900',
        defectM: '12', defectQty: '3', notes: '', materialWidthMm: 900
    };
}

// ── 1/2/3: cutFields — запись «Брак, шт» по имени реквизита ───────────────────────────────────
(function() {
    var fields = makeInst(baseCut()).cutFields(baseCut());
    assertEqual(fields['t785730'], 3,
        '#4896 п.1: «Брак, шт» пишется в реквизит 785730 (резолв по имени, не хардкод)');
    assertEqual(fields['t8458'], 12,
        '#4896 п.2: «Брак, м» при этом пишется как раньше — метраж не потерян');

    var cleared = baseCut();
    cleared.defectQty = '';
    var clearedFields = makeInst(cleared).cutFields(cleared);
    assertEqual(clearedFields['t785730'], '',
        '#4896 п.2: пустое «Брак, шт» перезаписывает старое значение (оператор передумал)');

    var oldFields = makeInst(baseCut(), SCHEMA_1078_OLD).cutFields(baseCut());
    assert(!('t785730' in oldFields),
        '#4896 п.3: сборка без реквизита «Брак, шт» — поля нет, сохранение не падает');
    assertEqual(oldFields['t8458'], 12,
        '#4896 п.3: на старой сборке «Брак, м» по-прежнему сохраняется');
})();

// ── 4: правка шт меняет подпись показаний → автосохранение по выходу из ячейки ────────────────
(function() {
    var a = baseCut();
    var b = baseCut();
    b.defectQty = '7';
    var inst = Object.create(Controller.prototype);
    assert(inst.readingsSignature(a) !== inst.readingsSignature(b),
        '#4896 п.4: правка «Брак, шт» меняет подпись показаний — выход из ячейки запишет её');
    b.defectQty = '3';
    assertEqual(inst.readingsSignature(a), inst.readingsSignature(b),
        '#4896 п.4: совпадающие показания — одинаковая подпись (лишней записи нет)');
})();

// ── 5: очередь из report/slitter_cuts несёт cut_defect_qty ────────────────────────────────────
(function() {
    var cuts = core.rowsToCuts([
        { cut_id: '90', cut_plan_date: '2026-09-07 10:00:00', cut_defect_qty: '3' },
        { cut_id: '91', cut_plan_date: '2026-09-07 12:00:00' }
    ]);
    assertEqual(cuts[0].defectQty, '3', '#4896 п.5: cut_defect_qty из отчёта попадает в дескриптор резки');
    assertEqual(cuts[1].defectQty, '', '#4896 п.5: колонки нет в строке — пусто, не undefined');
})();

// ── 6: в секции показаний поле стоит после «Брак, м», ввод уходит в _m_set ────────────────────
var pending = [];
(function() {
    var inst = makeInst(baseCut());
    inst.setBusy = function() {};
    inst.setReadingsStatus = function() {};
    inst.markReadingsSaved = function() { inst.savedReadings = inst.readingsSignature(inst.currentCut); };
    inst.saveReadingsIfChanged = function() {
        if (inst.readingsSignature(inst.currentCut) === inst.savedReadings) return;
        inst.saveReadings(true);
    };
    inst.saveReadings = function() {
        var sent = inst.readingsSignature(inst.currentCut);
        inst.post('_m_set/' + inst.currentCut.id + '?JSON', inst.cutFields(inst.currentCut));
        inst.savedReadings = sent;
    };

    var section = inst.renderReadings();
    var grid = section.querySelectorAll('.atex-sl-grid')[0];
    var labels = grid.querySelectorAll('.atex-sl-field')
        .map(function(f) { var l = f.querySelector('.atex-sl-label'); return l ? l.textContent : ''; });
    assertEqual(labels, ['Счётчик нач.', 'Счётчик кон.', 'Номер джамбо', 'Рабочий расход, м', 'К списанию, м',
        'Погонаж факт, м', 'Брак, м', 'Брак, шт', 'Фото брака'],
        '#4896 п.6: «Брак, шт» стоит в сетке сразу после «Брак, м»');

    // ввод в поле «Брак, шт» (последнее поле сетки) + выход из ячейки → одна запись с обоими браками
    var qtyField = grid.querySelectorAll('.atex-sl-field').filter(function(f) {
        var l = f.querySelector('.atex-sl-label'); return l && l.textContent === 'Брак, шт';
    })[0];
    if (!qtyField) {
        assert(false, '#4896 п.6: поля «Брак, шт» нет в сетке — сценарий ввода не выполнен');
        return;
    }
    var qty = qtyField.querySelector('.atex-sl-input');
    qty.value = '5';
    qty.dispatch('input');
    qty.dispatch('blur');
    assert(inst.posts.length === 1 && inst.posts[0].path.indexOf('_m_set/90') === 0,
        '#4896 п.6: правка «Брак, шт» уходит в _m_set/{резка}');
    assertEqual(inst.posts[0] && inst.posts[0].params['t785730'], 5,
        '#4896 п.6: в записи — новое количество рулонов (5)');
    assertEqual(inst.posts[0] && inst.posts[0].params['t8458'], 12,
        '#4896 п.6: метраж «Брак, м» уезжает той же записью');
    // повторный выход из нетронутой ячейки записи не делает
    qty.dispatch('blur');
    assert(inst.posts.length === 1, '#4896 п.6: повторный выход без правки — записи нет');
    pending.push(function(cb) { cb(); });
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
