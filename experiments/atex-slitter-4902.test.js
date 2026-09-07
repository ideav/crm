// #4902 — РМ слиттера: запись счётчиков при резке (накопление погонажа).
//
// ТЗ (issue #4902), раздел «Задание в производство»:
//   1. «Счётчик нач.» = «Остаток, м» партии — обновляется ТОЛЬКО 1 раз, если пустое;
//   2. «Погонаж факт, м» = прежний + «Метраж, м»×резок + «Рабочий расход, м» + «К списанию, м»
//      + «Брак, м» — добавляется с каждой резкой («Готовы несколько» умножает метраж);
//   3. «Счётчик кон.» = «Счётчик нач.» − «Погонаж факт, м»;
//   4. расходные поля пишутся как ввёл оператор, а при отметке резки готовой идут в
//      расчёт и очищаются (0); «№ джамбо» остаётся.
// Ограничения РМ: «Брак, м» обязателен при заполненном «Брак, шт»; без «№ джамбо»
// нельзя отметить резку готовой. Партия сырья: «Остаток, м» = «Счётчик кон.».
//
// Run with: node experiments/atex-slitter-4902.test.js

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

// ── Минимальный DOM-стаб (как в atex-slitter-4896.test.js) ────────────────────────────────────
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

// ── Схема 1078 «Задание в производство» (метаданные из issue #4902) ───────────────────────────
var SCHEMA_1078 = { id: '1078', reqs: [
    { id: '1164', val: 'Счётчик нач.' },
    { id: '1166', val: 'Счётчик кон.' },
    { id: '1168', val: 'Погонаж факт, м' },
    { id: '1110', val: 'Расход сырья' },
    { id: '1105', val: 'Кол-во резок факт' },
    { id: '1101', val: 'Начато' },
    { id: '1162', val: 'В работе' },
    { id: '16411', val: 'Закончено' },
    { id: '787042', val: 'Рабочий расход, м' },
    { id: '787043', val: 'К списанию, м' },
    { id: '8458', val: 'Брак, м' },
    { id: '8457', val: 'Брак, м²' },
    { id: '785730', val: 'Брак, шт' },
    { id: '787045', val: '№ джамбо' }
] };
var BATCH_META = { id: '1074', reqs: [
    { id: '1123', val: 'Остаток, м²' }, { id: '8456', val: 'Остаток, м' }, { id: '16427', val: 'В работе' }
] };

// ── 1) накопление погонажа (чистое ядро) ──────────────────────────────────────────────────────
assertEqual(core.meterageAccumulate('', 99, 450, '', '', ''), 44550,
    '#4902 п.2: погонаж = метраж × резок (99 × 450)');
assertEqual(core.meterageAccumulate('44550', 1, 450, '', '', ''), 45000,
    '#4902 п.2: добавляется с каждой резкой — следующий проход поверх накопленного');
assertEqual(core.meterageAccumulate('3600', 1, 450, '30', '60', '12'), 4152,
    '#4902 п.2: рабочий расход, к списанию и брак входят в погонаж');
assertEqual(core.meterageAccumulate('1000', 3, 450.5, '', '', ''), 2351.5,
    '#4902 «Готовы несколько»: метраж умножается на число отмеченных резок');
assertEqual(core.meterageAccumulate('', 2, 450, '0', '', ''), 900,
    '#4902: нулевой расход не искажает сумму');

// ── 2) счётчик кон. = счётчик нач. − погонаж факт ─────────────────────────────────────────────
assertEqual(core.counterEndFromMeterage(60000, 44550), 15450,
    '#4902 п.3: «Счётчик кон.» = «Счётчик нач.» − «Погонаж факт»');
assertEqual(core.counterEndFromMeterage('1000', ''), 1000,
    '#4902 п.3: без погонажа счётчик кон. равен началу');
assertEqual(core.counterEndFromMeterage('300', 450), -150,
    '#4902: план больше рулона — показание уходит в минус (сигнал «сырья не хватило», #4321)');

// ── 3) «Брак, м» обязателен при заполненном «Брак, шт» ────────────────────────────────────────
assertEqual(core.defectMRequired('2', ''), true, '#4902: шт заполнен, м пуст — резку не отметить');
assertEqual(core.defectMRequired('2', '0'), true, '#4902: шт заполнен, м ноль — то же (ноль метража брака не бывает)');
assertEqual(core.defectMRequired('2', '5'), false, '#4902: оба заполнены — отметка проходит');
assertEqual(core.defectMRequired('', ''), false, '#4902: брака нет — ограничения нет');
assertEqual(core.defectMRequired('0', ''), false, '#4902: шт = 0 — брака нет');

// ── 4) markPassDone: накопление, вывод расходных полей, счётчик нач. один раз ──────────────────
function makeInst(cut, opts) {
    var o = opts || {};
    var inst = Object.create(Controller.prototype);
    inst.busy = false;
    inst.meta = { cut: SCHEMA_1078, batch: BATCH_META };
    inst.currentCut = cut;
    inst.currentCutId = String(cut.id);
    inst.cuts = [];
    inst.batches = o.batches || [{ id: '77', remainderM: 60000, remainder: 0, widthMm: 500, active: '1' }];
    inst.materialWidths = {};
    inst.posts = [];
    inst.events = [];
    inst.synced = [];
    inst.notes = [];
    inst.jumboSaved = 0;
    inst.finished = 0;
    inst.post = function(path, params) { this.posts.push({ path: path, params: params }); return Promise.resolve({}); };
    inst.createEvent = function(ev) { this.events.push(ev); return Promise.resolve({}); };
    inst.syncBatchRemainder = function(cut2, counterEnd, finishMode) {
        this.synced.push({ counterEnd: counterEnd, finishMode: finishMode }); return Promise.resolve(null);
    };
    inst.loadEvents = function() { return Promise.resolve(); };
    inst.loadCuts = function() { return Promise.resolve(); };
    inst.loadBatches = function() { return Promise.resolve(); };
    inst.recordActualRolls = function() { return Promise.resolve(); };
    inst.applyEventStatuses = function() {};
    inst.setBusy = function(v) { this.busy = v; };
    inst.notify = function(msg, kind) { this.notes.push({ msg: msg, kind: kind }); };
    inst.render = function() {};
    inst.advanceToNextCut = function() {};
    inst.saveJumbo = function() { this.jumboSaved++; return Promise.resolve(null); };
    inst.isCutLocked = function() { return false; };
    inst.eventDateTime = function() { return '2026-09-07 12:00:00'; };
    return inst;
}
function baseCut(opts) {
    var o = opts || {};
    return {
        id: '90', batchId: '77', status: 'В работе',
        counterStart: o.counterStart !== undefined ? o.counterStart : '60000',
        counterEnd: '', meterage: o.meterage !== undefined ? o.meterage : '',
        actualRuns: o.actualRuns || '', runLength: '450', plannedRuns: '100',
        jumboNo: o.jumboNo !== undefined ? o.jumboNo : 'J-1',
        jumboWorkSpent: o.work !== undefined ? o.work : '',
        jumboWriteOff: o.off !== undefined ? o.off : '',
        defectM: o.defectM !== undefined ? o.defectM : '',
        defectQty: o.defectQty !== undefined ? o.defectQty : ''
    };
}
function flush() { return new Promise(function(resolve) { setTimeout(resolve, 0); }); }

(async function() {
    // одна резка с расходом джамбо и браком: всё входит в погонаж, поля обнуляются
    var inst = makeInst(baseCut({ work: '30', off: '60', defectM: '12' }));
    inst.markPassDone(false);
    assertEqual(inst.posts.length, 1, '#4902: отметка резки — одна запись в задание');
    var p = inst.posts[0].params;
    assertEqual(p['t1168'], 552, '#4902 п.2: погонаж = 450 (метраж) + 30 + 60 + 12');
    assertEqual(p['t1166'], 60000 - 552, '#4902 п.3: «Счётчик кон.» = 60000 − 552');
    assertEqual(p['t1164'], undefined, '#4902 п.1: заполненный «Счётчик нач.» не перезаписывается');

    await flush();

    // «Счётчик нач.» пуст → пишется из остатка партии ровно один раз
    var fresh = makeInst(baseCut({ counterStart: '' }));
    fresh.markPassDone(false);
    assertEqual(fresh.posts[0].params['t1164'], 60000,
        '#4902 п.1: пустой «Счётчик нач.» = «Остаток, м» партии (обновляется только 1 раз)');
    assertEqual(fresh.posts[0].params['t1168'], 450, '#4902: чистая резка — погонаж = метраж × 1');

    // «Готовы несколько» и накопление поверх уже отмеченного
    var partial = makeInst(baseCut({ actualRuns: '8', meterage: String(8 * 450), work: '30' }));
    partial.markPassDone(false, 99);
    var partialM = 8 * 450 + 91 * 450 + 30;   // 3600 + 40950 + 30 = 44580
    assertEqual(partial.posts[0].params['t1168'], partialM,
        '#4902: 8 отмечено → 99: погонаж = прежний 3600 + 91×450 + расход джамбо 30');
    assertEqual(partial.posts[0].params['t1105'], 99, '#4564: «Кол-во резок факт» = 99');
    assertEqual(partial.posts[0].params['t1166'], 60000 - partialM,
        '#4902 п.3: «Счётчик кон.» = «Счётчик нач.» − накопленный погонаж');

    // расходные поля уходят в расчёт и очищаются (0)
    assertEqual(partial.posts[0].params['t787042'], 0, '#4902 п.4: «Рабочий расход, м» очищен (0)');
    assertEqual(partial.posts[0].params['t787043'], 0, '#4902 п.4: «К списанию, м» очищен (0)');
    assertEqual(partial.posts[0].params['t8458'], 0, '#4902 п.4: «Брак, м» очищен (0)');
    assertEqual(partial.posts[0].params['t785730'], 0, '#4902 п.4: «Брак, шт» очищен (0)');
    assertEqual(partial.currentCut.jumboNo, 'J-1', '#4902 п.4: «№ джамбо» остаётся заполненным');

    // партия: остаток синхронизируется со счётчиком (после промис-цепочки отметки)
    await flush();
    assertEqual(partial.synced.length, 1, '#4902: партия сырья синхронизируется при отметке');
    assertEqual(partial.synced[0].counterEnd, 60000 - partialM,
        '#4902: «Остаток, м» партии = «Счётчик кон.»');

    // ограничения РМ
    var noJumbo = makeInst(baseCut({ jumboNo: '' }));
    noJumbo.markPassDone(false, 100);
    assertEqual(noJumbo.posts.length, 0,
        '#4902: без «№ джамбо» нельзя отметить резку готовой (записи нет)');
    assert(noJumbo.notes.some(function(n) { return n.msg.indexOf('№ джамбо') >= 0; }),
        '#4902: оператору сказано, что нужен «№ джамбо»');

    var noDefectM = makeInst(baseCut({ defectQty: '2', defectM: '' }));
    noDefectM.markPassDone(false);
    assertEqual(noDefectM.posts.length, 0,
        '#4902: «Брак, шт» без «Брак, м» — отметка не проходит');
    assert(noDefectM.notes.some(function(n) { return n.msg.indexOf('Брак, м') >= 0; }),
        '#4902: оператору сказано, что нужен «Брак, м»');

    var defectOk = makeInst(baseCut({ defectQty: '2', defectM: '7' }));
    defectOk.markPassDone(false);
    assertEqual(defectOk.posts.length, 1, '#4902: шт + м заполнены вместе — отметка проходит');

    // партии нет — списывать и подставлять счётчик не из чего (#4580 остаётся)
    var noBatch = makeInst(baseCut({ counterStart: '' }));
    noBatch.batches = [];
    noBatch.markPassDone(false);
    assertEqual(noBatch.posts.length, 0,
        '#4902/#4580: «Счётчик нач.» пуст, а из остатка партии взять нечего — записи нет');
})();

// ── 5) finishCut: «№ джамбо» обязательно, завершение пишет погонаж/счётчик/партию ─────────────
(async function() {
    var bad = makeInst(baseCut({ jumboNo: '' }));
    bad.finishCut();
    await flush();
    assertEqual(bad.posts.length, 0,
        '#4902: finishCut без «№ джамбо» ничего не пишет');

    var good = makeInst(baseCut({ meterage: String(99 * 450), actualRuns: '99' }));
    good.markPassDone(false, 100);
    await flush();
    assertEqual(good.posts.length, 2, '#4902: финальная отметка — запись задания и запись завершения');
    var fin = good.posts[1].params;
    assertEqual(fin['t1168'], 100 * 450, '#4902: погонаж в записи завершения = все 100 резок');
    assertEqual(fin['t16411'], '2026-09-07 12:00:00', '#3557: «Закончено» = момент завершения');
    assertEqual(fin['t1162'], '0', '#3557: «В работе» снят нулём');
    assertEqual(good.jumboSaved, 1, '#4860: запись «Номера джамбо» при завершении ведётся');
})();

// ── 6) syncBatchRemainder: «Остаток, м» партии = «Счётчик кон.» ───────────────────────────────
(function() {
    var inst = Object.create(Controller.prototype);
    var batch = { id: '77', materialId: 'm', remainderM: 1000, remainder: 500, widthMm: 500, active: '1' };
    inst.findBatch = function(id) { return String(id) === '77' ? batch : null; };
    inst.materialWidths = {};
    inst.meta = { batch: BATCH_META };
    var captured = null;
    inst.post = function(path, params) { captured = { path: path, params: params }; return Promise.resolve({}); };

    inst.syncBatchRemainder({ batchId: '77' }, 15450, false);
    assertEqual(captured.params['t8456'], 15450, '#4902: «Остаток, м» = «Счётчик кон.» (15450)');
    assertEqual(captured.params['t1123'], 7725, '#4902: «Остаток, м²» пересчитан по ширине (500 мм)');
    assertEqual('t16427' in captured.params, false, '#4902: без finishMode «В работе» не трогаем');

    inst.syncBatchRemainder({ batchId: '77' }, 0, true);
    assertEqual(captured.params['t8456'], 0, '#4902: счётчик в нуле — остаток 0');
    assertEqual(captured.params['t16427'], '0', '#3861/#4374: партия исчерпана → «В работе» снят нулём');

    inst.syncBatchRemainder({ batchId: '77' }, 200, true);
    assertEqual('t16427' in captured.params, false,
        '#4374: finishMode с остатком «В работе» не снимает (рулон нужен дальше)');

    inst.syncBatchRemainder({ batchId: '77' }, -150, false);
    assertEqual(captured.params['t8456'], -150,
        '#4902: план больше рулона — остаток уходит в минус вместе со счётчиком (сигнал, #4321)');
})();

// ── 7) cutFields: расход джамбо и «№ джамбо» — реквизиты резки, пишутся по именам ─────────────
(function() {
    var cut = baseCut({ work: '30', off: '7' });
    var fields = makeInst(cut).cutFields(cut);
    assertEqual(fields['t787042'], 30, '#4902: «Рабочий расход, м» пишется в реквизит резки');
    assertEqual(fields['t787043'], 7, '#4902: «К списанию, м» пишется в реквизит резки');
    assertEqual(fields['t787045'], 'J-1', '#4902: «№ джамбо» пишется как ввёл оператор');
    assertEqual(fields['t8458'], '', '#4902: пустой «Брак, м» перезаписывает старое (пустота = очистка)');
    assertEqual('t1166' in fields, false,
        '#4902 п.3: «Счётчик кон.» вычисляемый — автосохранением по ячейке не пишется');

    var oldMeta = { id: '1078', reqs: SCHEMA_1078.reqs.filter(function(r) {
        return ['787042', '787043', '787045'].indexOf(r.id) < 0; }) };
    var oldInst = Object.create(Controller.prototype);
    oldInst.meta = { cut: oldMeta };
    var oldFields = oldInst.cutFields(cut);
    assert(!('t787042' in oldFields) && !('t787045' in oldFields),
        '#4902: сборка без новых реквизитов — поля молча пропускаются, сохранение не падает');
})();

// ── 8) подпись показаний: правка расхода джамбо и «№ джамбо» — тоже правка ────────────────────
(function() {
    var inst = Object.create(Controller.prototype);
    var a = baseCut();
    var b = baseCut();
    b.jumboWorkSpent = '30';
    assert(inst.readingsSignature(a) !== inst.readingsSignature(b),
        '#4902: правка «Рабочего расхода» меняет подпись — автосохранение по выходу из ячейки');
    var c = baseCut();
    c.jumboNo = 'J-2';
    assert(inst.readingsSignature(a) !== inst.readingsSignature(c),
        '#4902: правка «№ джамбо» меняет подпись показаний');
    b.jumboWorkSpent = '';
    assertEqual(inst.readingsSignature(a), inst.readingsSignature(b),
        '#4902: совпадающие показания — одинаковая подпись (лишней записи нет)');
})();

// ── 9) в карточке «Счётчик кон.» вычисляемый — ввода нет ──────────────────────────────────────
(function() {
    var inst = makeInst(baseCut());
    inst.setBusy = function() {};
    inst.setReadingsStatus = function() {};
    inst.markReadingsSaved = function() {};
    inst.loadJumboRecord = function() { return Promise.resolve(null); };
    var section = inst.renderReadings();
    var fields = section.querySelectorAll('.atex-sl-field').filter(function(f) {
        var l = f.querySelector('.atex-sl-label');
        return l && (l.textContent === 'Счётчик кон.' || l.textContent === 'Погонаж факт, м');
    });
    assertEqual(fields.length, 2, '#4902: поля «Счётчик кон.» и «Погонаж факт» на месте');
    fields.forEach(function(f) {
        var label = f.querySelector('.atex-sl-label').textContent;
        var input = f.querySelectorAll('.atex-sl-input')[0];
        assertEqual(input.getAttribute('readonly'), 'readonly',
            '#4902 п.3: «' + label + '» — вычисляемое поле (readonly)');
    });
    var cStartField = section.querySelectorAll('.atex-sl-field').filter(function(f) {
        var l = f.querySelector('.atex-sl-label'); return l && l.textContent === 'Счётчик нач.';
    })[0];
    assertEqual(cStartField.querySelectorAll('.atex-sl-input')[0].getAttribute('readonly'), null,
        '#4902 п.1: «Счётчик нач.» остаётся вводимым');
})();

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
