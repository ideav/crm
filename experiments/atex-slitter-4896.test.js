// #4896 — РМ слиттера: поле «Брак, шт» рядом с «Брак, м».
//
// ТЗ (issue #4896): «Заносить в него количество бракованных рулонов, вместо
// (или вместе с ним) метража с браком». С #4914 (решение заказчика) браки —
// реквизиты записи «Номер джамбо» (82374): 82386 «Брак, м», 791708 «Брак, шт»
// (реквизиты резки 8458/785730/8460 выведены из эксплуатации). Поведение то же,
// носитель другой:
//   1. автосохранение/отметка пишут «Брак, шт» по имени реквизита (id не хардкод);
//   2. «Брак, м» при этом не теряется, пустое шт полностью перезаписывает старое;
//   3. на сборке без реквизита поле молча пропускается (missing докладывается, #4564);
//   4. правка шт меняет подпись записи джамбо — след правки для сохранения;
//   5. в дескриптор резки браки больше не попадают (носитель — запись);
//   6. в сетке показаний «Брак, шт» стоит сразу после «Брак, м», ввод копит
//      черновик активной записи.
//
// RATCHET-OK: запись браков реквизитами резки (785730/8458 в _m_set/{резка})
// заменена записью в «Номер джамбо» решением заказчика (#4914).
//
// Run with: node experiments/atex-slitter-4896.test.js

process.env.TZ = 'Europe/Moscow';

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

// ── Боевая схема 82374 «Номер джамбо» (метаданные ateh на 03.09.2026) ─────────────────────────
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
// Та же сборка БЕЗ реквизита «Брак, шт» (старая база — поле не должно ронять сохранение).
var JUMBO_OLD = {
    id: '82374',
    reqs: JUMBO_82374.reqs.filter(function(r) { return r.id !== '791708'; })
};

// ── 1/2/3: поля записи — «Брак, шт» по имени реквизита, метраж рядом ──────────────────────────
(function() {
    var fields = core.jumboInputFields(JUMBO_82374, {
        jumboNo: 'J-1', spent: '2', writeoff: '', defectM: '12', defectQty: '3'
    }).fields;
    assertEqual(fields['t791708'], '3',
        '#4896 п.1: «Брак, шт» пишется в реквизит 791708 (резолв по имени, не хардкод)');
    assertEqual(fields['t8458'] === undefined ? fields['t82386'] : fields['t8458'], '12',
        '#4896 п.2: «Брак, м» при этом пишется как раньше — метраж не потерян');

    var cleared = core.jumboInputFields(JUMBO_82374, {
        jumboNo: 'J-1', defectM: '12', defectQty: ''
    }).fields;
    assertEqual(cleared['t791708'], '',
        '#4896 п.2: пустое «Брак, шт» перезаписывает старое значение (оператор передумал)');

    var oldParsed = core.jumboInputFields(JUMBO_OLD, {
        jumboNo: 'J-1', defectM: '12', defectQty: '3'
    });
    assert(!('t791708' in oldParsed.fields),
        '#4896 п.3: сборка без реквизита «Брак, шт» — поля нет, сохранение не падает');
    assertEqual(oldParsed.fields['t82386'], '12',
        '#4896 п.3: на старой сборке «Брак, м» по-прежнему сохраняется');
    assert(oldParsed.missing.indexOf('Брак, шт') !== -1,
        '#4896 п.3/#4564: отсутствующий реквизит назван поимённо (молча терять нельзя)');
})();

// ── 4: правка шт меняет подпись записи джамбо → след правки для сохранения ────────────────────
(function() {
    var a = { jumboNo: 'J-1', spent: '', writeoff: '', defectM: '12', defectQty: '3',
              spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: '' };
    var b = JSON.parse(JSON.stringify(a));
    b.defectQtyDraft = '7';
    assert(core.jumboSignature(a) !== core.jumboSignature(b),
        '#4896 п.4: правка «Брак, шт» меняет подпись записи джамбо — черновик не потеряется');
    b.defectQtyDraft = '';
    assertEqual(core.jumboSignature(a), core.jumboSignature(b),
        '#4896 п.4: совпадающие значения — одинаковая подпись (лишней записи нет)');
})();

// ── 5: в дескриптор резки браки больше не попадают (носитель — запись) ────────────────────────
(function() {
    var cuts = core.rowsToCuts([
        { cut_id: '90', cut_plan_date: '2026-09-07 10:00:00', cut_defect_qty: '3' },
        { cut_id: '91', cut_plan_date: '2026-09-07 12:00:00' }
    ]);
    assert(!('defectQty' in cuts[0]) && !('defectQty' in cuts[1]),
        '#4914: брак, шт — не свойство резки; живёт записью «Номера джамбо»');
    // Запись из отчёта task_jumbo браки несёт.
    var jumbos = core.rowsToJumbos([{ jumbo_id: '5', task_id: '90', jumbo_no: 'J-1', defect_m: '12', defect_qty: '3' }]);
    assertEqual([jumbos[0].defectM, jumbos[0].defectQty], ['12', '3'],
        '#4914: запись джамбо несёт «Брак, м» и «Брак, шт»');
})();

// ── 6: в сетке показаний «Брак, шт» после «Брак, м», ввод копит черновик записи ────────────────
// Минимальный DOM-стаб (как в atex-slitter-4783.test.js).
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

(function() {
    var root = new StubNode('div');
    var inst = Object.create(Controller.prototype);
    Controller.call(inst, root);
    inst.meta = { jumboTable: JUMBO_82374 };
    inst.notify = function() {};
    inst.render = function() {};
    inst.currentCut = {
        id: '90', counterStart: '1000', counterEnd: '900', notes: '', materialId: 'm1',
        jumbos: [{ id: 'J-REC', jumboNo: 'J-1', spent: '2', writeoff: '', defectM: '12', defectQty: '3', photo: '',
                   spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: '' }],
        jumboActive: 0
    };
    inst.markJumboSaved();

    var section = inst.renderReadings();
    var grid = section.querySelectorAll('.atex-sl-grid')[0];
    var labels = grid.querySelectorAll('.atex-sl-field')
        .map(function(f) { var l = f.querySelector('.atex-sl-label'); return l ? l.textContent : ''; });
    var qtyIdx = labels.indexOf('Брак, шт'), meterIdx = labels.indexOf('Брак, м');
    assert(meterIdx !== -1 && qtyIdx === meterIdx + 1,
        '#4896 п.6: «Брак, шт» стоит в сетке сразу после «Брак, м»');

    // ввод в поле «Брак, шт» копит ЧЕРНОВИК активной записи (накопит отметка резки, #4914)
    var qtyField = grid.querySelectorAll('.atex-sl-field').filter(function(f) {
        var l = f.querySelector('.atex-sl-label'); return l && l.textContent === 'Брак, шт';
    })[0];
    var qty = qtyField.querySelector('.atex-sl-input');
    qty.value = '5';
    qty.dispatch('input');
    assertEqual(inst.currentCut.jumbos[0].defectQtyDraft, '5',
        '#4914 п.6: ввод «Брак, шт» копит черновик активной записи джамбо');
    // черновик не трогает накопленное и меняет подпись — запись уйдёт при отметке
    assertEqual(inst.currentCut.jumbos[0].defectQty, '3',
        '#4914 п.6: накопленное в поле не трогается — увидит оператор после отметки');
    assert(core.jumboDeltaFrom(inst.currentCut.jumbos[0]).defectQty === 5,
        '#4914 п.6: дельта отметки — введённое количество (5)');

    // выход из ячейки «Брак, шт» сам не пишет: черновики везёт отметка резки.
    var posts = [];
    inst.post = function(p, params) { posts.push({ path: p, params: params }); return Promise.resolve({}); };
    qty.dispatch('blur');
    assert(posts.length === 0,
        '#4914 п.6: выход из ячейки брака не пишет — накопит отметка резки');
})();

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
