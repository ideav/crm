// #4914 — РМ слиттера: данные джамбо живут в записях «Номер джамбо» (82374, up =
// задание), по записи на джамбо; на задании их несколько — UI показывает строку
// корешков над панелью показаний, активный корешок — редактируемый номер (#4916).
// Отметка резки ПРИБАВЛЯЕТ введённое к накопленному значению активной записи (поля
// не очищаются). Счётчики и реквизиты джамбо на самой резке
// (787042/787043/787045/8458/785730/8460) выведены из эксплуатации — пульт больше не
// пишет их и не чистит. «Фото брака» и «Примечания» — соседние ячейки сетки.
//
// Run with: node experiments/atex-slitter-4914-jumbo-tabs.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-4394-cut-id-links.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, force) {   // setBusy (#4914) переключает is-busy
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
    // value-атрибут отражается в свойстве (как в живом DOM до правки пользователем)
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
var core = slitter.core;
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

// ── Боевая схема 82374 «Номер джамбо» (метаданные ateh, 08.09.2026) ──
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

// ── 1) разбор строк отчёта task_jumbo (живой формат JSON_KV, 08.09.2026) ──
(function() {
    var rows = [{
        jumbo_id: '791461', jumbo_no: 'C200cp383941', task_id: '779317',
        length_start: '12510', counter_start: '12510', cuts_count: '2', counter_end: '11890',
        length_end: '11890', spent: '20', writeoff: '', defect_m: '0', defect_qty: '', photo: ''
    }, {
        jumbo_id: '791930', jumbo_no: '12', task_id: '783990',
        length_start: '', counter_start: '847', cuts_count: '', counter_end: '-17753',
        length_end: '', spent: '', writeoff: '', defect_m: '', defect_qty: '', photo: ''
    }];
    var jumbos = core.rowsToJumbos(rows);
    assertEqual(jumbos.length, 2, 'rowsToJumbos: две записи');
    assertEqual(jumbos[0].id, '791461', 'rowsToJumbos: id записи');
    assertEqual(jumbos[0].jumboNo, 'C200cp383941', 'rowsToJumbos: номер');
    assertEqual(jumbos[0].taskId, '779317', 'rowsToJumbos: задание');
    assertEqual(jumbos[0].spent, '20', 'rowsToJumbos: накопленный расход');
    assertEqual(jumbos[0].counterStart, '12510', 'rowsToJumbos: счётчик нач.');
    assertEqual(jumbos[0].counterEnd, '11890', 'rowsToJumbos: счётчик кон.');
    assertEqual(jumbos[1].counterEnd, '-17753', 'rowsToJumbos: минус не прячем');
    assertEqual(jumbos[1].spent, '', 'rowsToJumbos: пусто остаётся пустым');
    // Чего-то из колонок нет (старая сборка отчёта) — поля пустые, разбора не роняем.
    assertEqual(core.rowsToJumbos([{}])[0].jumboNo, '', 'rowsToJumbos: строка без колонок не падает');
    assertEqual(core.rowsToJumbos(null), [], 'rowsToJumbos: нет строк — пустой список');

    // Фолбэк: прямое чтение подчинённых (JSON_OBJ) разбирается тем же контрактом.
    // r[0] — главное значение, r[i] — реквизит i-1 в порядке metadata reqs.
    var fromObjects = core.jumbosFromObjects(JUMBO_82374, [
        { i: '791431', u: '779561', r: ['123', '', '990541', '4', '989341', '', '', '', '', '', ''] }
    ]);
    assertEqual(fromObjects[0].id, '791431', 'jumbosFromObjects: id');
    assertEqual(fromObjects[0].jumboNo, '123', 'jumbosFromObjects: номер — главное значение');
    assertEqual(fromObjects[0].counterStart, '990541', 'jumbosFromObjects: счётчик нач. по имени реквизита');
    assertEqual(fromObjects[0].counterEnd, '989341', 'jumbosFromObjects: счётчик кон. по имени реквизита');
})();

// ── 2) отметка копит в запись: дельта прибавляется к накопленному ──
(function() {
    var rec = { spent: '20', writeoff: '', defectM: '0', defectQty: '' };
    assertEqual(core.jumboAccumulate(rec, { spent: 5, writeoff: 2, defectM: 1, defectQty: 1 }),
        { spent: 25, writeoff: 2, defectM: 1, defectQty: 1 },
        'jumboAccumulate: введённое прибавляется к накопленному');
    assertEqual(core.jumboAccumulate({ spent: '', writeoff: '', defectM: '', defectQty: '' },
        { spent: 0, writeoff: 0, defectM: 0, defectQty: 0 }),
        { spent: 0, writeoff: 0, defectM: 0, defectQty: 0 },
        'jumboAccumulate: пустая запись и нулевая отметка — нули, не NaN');
    // Дельта = черновики ввода активной записи (что оператор ввёл К ЭТОЙ отметке).
    assertEqual(core.jumboDeltaFrom({ spentDraft: '5', writeoffDraft: '', defectMDraft: '1', defectQtyDraft: '2' }),
        { spent: 5, writeoff: 0, defectM: 1, defectQty: 2 },
        'jumboDeltaFrom: дельта из черновиков ввода');
    assertEqual(core.jumboDeltaFrom(null), { spent: 0, writeoff: 0, defectM: 0, defectQty: 0 },
        'jumboDeltaFrom: записи нет — нулевая дельта');
})();

// ── 3) цепочка джамбо: «Счётчик кон.» предыдущего — в «Счётчик нач.» следующего ──
assertEqual(core.jumboNextCounterStart({ counterEnd: '11890' }), '11890',
    'jumboNextCounterStart: кон. предыдущего');
assertEqual(core.jumboNextCounterStart({ counterEnd: '' }), '',
    'jumboNextCounterStart: у предыдущего пусто — начинаем с пустого');
assertEqual(core.jumboNextCounterStart(null), '', 'jumboNextCounterStart: первой записи счётчик не передаётся');

// ── 4) поля записи по ИМЕНАМ реквизитов 82374 (запись = источник, не резка) ──
(function() {
    var full = core.jumboRecordFields(JUMBO_82374, {
        jumboNo: ' C200cp383941 ', lengthStart: '12510', counterStart: '12510',
        cutsCount: '2', counterEnd: '11890', lengthEnd: '', spent: '20', writeoff: '',
        defectM: '0', defectQty: '', photo: ''
    });
    assertEqual(full.missing, [], 'jumboRecordFields: боевая схема 82374 полна');
    assertEqual(full.fields, {
        't82374': 'C200cp383941',   // гл. значение — номер
        't82376': '12510',          // начальная длина
        't791706': '12510',         // счётчик нач. записи
        't82378': '2',              // кол-во резок
        't791707': '11890',         // счётчик кон. записи
        't82380': 11870,            // конечная длина = кон. − расход − списание
        't82382': '20',             // накопленный рабочий расход
        't82384': '',               // накопленное списание
        't82386': '0',              // накопленный брак, м
        't791708': ''               // накопленный брак, шт (пустой доезжает — #4366)
    }, 'jumboRecordFields: запись собирается по именам реквизитов 82374');

    // Конечная длина не задана — считается; задана — пишется как есть.
    var computed = core.jumboRecordFields(JUMBO_82374, {
        jumboNo: 'X', counterStart: '', counterEnd: '18200', lengthEnd: '',
        cutsCount: '', spent: '30', writeoff: '60', defectM: '', defectQty: '', photo: ''
    });
    assertEqual(computed.fields['t82380'], 18110, 'jumboRecordFields: конечная = кон. − расход − списание (#4860)');
    var given = core.jumboRecordFields(JUMBO_82374, {
        jumboNo: 'X', counterStart: '', counterEnd: '', lengthEnd: '15000',
        cutsCount: '', spent: '', writeoff: '', defectM: '', defectQty: '', photo: ''
    });
    assertEqual(given.fields['t82380'], '15000', 'jumboRecordFields: готовая конечная пишется без пересчёта');

    // Автосохранение по ячейке — ТОЛЬКО вводимые поля: счётчики и длины не трогаем
    // (их ведёт отметка резки), иначе автосейв затирал бы числа цепочки.
    var input = core.jumboInputFields(JUMBO_82374, {
        jumboNo: 'J-1', lengthStart: '1', counterStart: '2', cutsCount: '3',
        counterEnd: '4', lengthEnd: '5', spent: '6', writeoff: '7', defectM: '8', defectQty: '9'
    });
    assertEqual(input.fields, {
        't82374': 'J-1', 't82382': '6', 't82384': '7', 't82386': '8', 't791708': '9'
    }, 'jumboInputFields: автосейв везёт номер, расход, списание, браки — и только их');
})();

// ── 5) подпись показаний резки: джамбо-полей там больше нет (они в записи) ──
(function() {
    var c = new Controller(new StubNode('div'));
    c.currentCut = { counterStart: '12510', notes: 'заметка', jumboNo: 'A', jumboWorkSpent: '5', jumboWriteOff: '1', defectM: '2', defectQty: '3', defect: '4' };
    assertEqual(c.readingsSignature(c.currentCut), '12510|заметка',
        'readingsSignature: только счётчик нач. и примечания — расход джамбо живёт в записи');
})();

// ── 6) контроллер: активная запись, корешки над панелью (#4916), фото/примечания ──
function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.notify = function() {};
    return c;
}

(function() {
    var c = makeController();
    var cut = {
        id: '779317', counterStart: '12510', meterage: '620', notes: 'заметка оператора',
        jumbos: [
            { id: '791461', jumboNo: 'C200cp383941', spent: '20', writeoff: '', defectM: '0', defectQty: '', counterStart: '12510', counterEnd: '11890' },
            { id: '791431', jumboNo: '123', spent: '', writeoff: '', defectM: '', defectQty: '', counterStart: '', counterEnd: '' }
        ],
        jumboActive: 0
    };
    c.currentCut = cut;
    c.loadJumboRecords = function() { return Promise.resolve(); };   // записи уже на резке
    c.render = function() {};                                        // клик по корешку перерисовывает
    var readings = c.renderReadings();
    var tabs = readings.querySelector('.atex-sl-jumbo-tabs');
    assert(!!tabs, 'строка корешков джамбо отрисована');
    var chips = tabs.querySelectorAll('.atex-sl-jumbo-tab');
    assertEqual(chips.length, 2, 'корешок на каждую запись джамбо');
    // Активный корешок — само поле номера активной записи; прочие — кнопки (#4916).
    var numberInput = chips.filter(function(n) { return n.tagName === 'INPUT'; })[0];
    assert(!!numberInput, 'активный корешок — редактируемый номер (#4916)');
    assertEqual(numberInput && numberInput.value, 'C200cp383941', 'в корешке-поле номер активной записи');
    assert(!!numberInput && numberInput.classList.contains('is-active'), 'активный корешок подсвечен');
    assert(!!tabs.querySelector('.atex-sl-jumbo-add'), 'кнопка «+ Джамбо» на месте');

    // Поля сетки читают АКТИВНУЮ запись; поля «Номер джамбо» в сетке больше нет —
    // номер живёт в строке корешков (#4916).
    var grid = readings.querySelector('.atex-sl-grid');
    var labels = grid.querySelectorAll('.atex-sl-label').map(function(n) { return n.textContent; });
    assert(labels.indexOf('Номер джамбо') === -1, 'поля «Номер джамбо» в сетке нет — номер в корешке');
    var spentInput = null;
    grid.querySelectorAll('.atex-sl-field').forEach(function(f) {
        var lbl = f.querySelectorAll('.atex-sl-label')[0];
        var label = lbl ? lbl.textContent : '';
        var ctrl = null;
        f._all([]).forEach(function(n) {
            if (!ctrl && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA')) ctrl = n;
        });
        if (label === 'Рабочий расход, м') spentInput = ctrl;
    });
    assertEqual(spentInput && spentInput.value, '20', 'накопленный расход активной записи виден');

    // Переключение корешка: активной становится вторая, поля перечитываются.
    var switchBtn = chips.filter(function(n) { return n.tagName === 'BUTTON'; })[0];
    assertEqual(switchBtn && switchBtn.textContent, '123', 'кнопка-корешок подписана номером записи');
    switchBtn.click();
    assertEqual(cut.jumboActive, 1, 'клик по корешку переключает активную запись');

    // «Фото брака» и «Примечания» — соседние ячейки сетки (одна строка, п.3 тикета).
    assertEqual(labels[labels.length - 2], 'Фото брака', 'предпоследняя ячейка сетки — фото брака');
    assertEqual(labels[labels.length - 1], 'Примечания', 'последняя ячейка сетки — примечания');

    // Записей нет — сетка жива, корешок один и это черновик номера (пустой отчёт
    // и записи пульт переживает).
    var cut2 = { id: '1', counterStart: '', meterage: '', notes: '', jumbos: [], jumboActive: 0 };
    c.currentCut = cut2;
    var s2 = c.renderReadings();
    assert(!!s2.querySelector('.atex-sl-grid'), 'без записей джамбо сетка показаний на месте');
    var tabs2 = s2.querySelector('.atex-sl-jumbo-tabs');
    var inputs2 = tabs2 ? tabs2.querySelectorAll('.atex-sl-jumbo-tab').filter(function(n) { return n.tagName === 'INPUT'; }) : [];
    assertEqual(inputs2.length, 1, 'без записей корешок один — черновик номера (#4916)');
})();

// ── 7) отметка резки: дельта копится в запись, резка джамбо-реквизиты не получает ──
function cutMeta() {
    // Метаданные 1078 С ДжАМБО-реквизитами: чтобы отсутствие их в _m_set было
    // осознанным (id разрешаются, но в поля они не попадают).
    return {
        id: '1078',
        reqs: [
            { id: '1164', val: 'Счётчик нач.' }, { id: '1166', val: 'Счётчик кон.' },
            { id: '1168', val: 'Погонаж факт, м' }, { id: '24305', val: 'Метраж, м' },
            { id: '657315', val: 'Кол-во резок факт' }, { id: '1161', val: 'Начато' },
            { id: '1162', val: 'В работе' }, { id: '1171', val: 'Примечания' },
            { id: '3861x', val: 'Расход сырья' },
            // Выведенные из эксплуатации реквизиты джамбо резки:
            { id: '787042', val: 'Рабочий расход, м' }, { id: '787043', val: 'К списанию, м' },
            { id: '8458', val: 'Брак, м' }, { id: '785730', val: 'Брак, шт' },
            { id: '82', val: 'Брак, м²' }
        ]
    };
}
(function() {
    var c = makeController();
    c.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
    var rec = {
        id: '791461', jumboNo: 'C200cp383941', spent: '20', writeoff: '', defectM: '0', defectQty: '',
        spentDraft: '5', writeoffDraft: '2', defectMDraft: '1', defectQtyDraft: '2',
        counterStart: '12510', counterEnd: ''
    };
    var cut = {
        id: '779317', batchId: '700', status: 'В работе',
        counterStart: '12510', meterage: '0', actualRuns: '0', plannedRuns: '2', runLength: '450',
        notes: '', materialId: '2086', material: 'MR194',
        jumbos: [rec], jumboActive: 0
    };
    c.currentCut = cut;
    c.findBatch = function() { return { id: '700', remainderM: 12510, materialId: '2086', widthMm: 300 }; };
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.createEvent = function() { return Promise.resolve({}); };
    c.syncBatchRemainder = function() { return Promise.resolve(null); };
    c.loadEvents = function() { return Promise.resolve(); };
    c.loadCuts = function() { return Promise.resolve(); };
    c.applyEventStatuses = function() {};
    c.isCutLocked = function() { return false; };
    c.render = function() {};
    c.notify = function(msg, kind) { posts.push({ notify: msg, kind: kind }); };

    c.markPassDone(false);

    // Цепочка асинхронная — ждём её завершения через микротаск-цикл.
    setImmediate(function() {
        var cutSet = posts.filter(function(p) { return p.path === '_m_set/779317?JSON'; })[0];
        assert(!!cutSet, 'отметка пишет показания в резку');
        assert(!cutSet || !('t787042' in cutSet.fields), 'резка НЕ получает «Рабочий расход, м» (787042 выведен)');
        assert(!cutSet || !('t787043' in cutSet.fields), 'резка НЕ получает «К списанию, м» (787043 выведен)');
        assert(!cutSet || !('t8458' in cutSet.fields), 'резка НЕ получает «Брак, м» (8458 выведен)');
        assert(!cutSet || !('t785730' in cutSet.fields), 'резка НЕ получает «Брак, шт» (785730 выведен)');
        assertEqual(cutSet && cutSet.fields['t657315'], 1, 'факт проходов пишется как раньше');
        // Погонаж = 0 + 1×450 + расход 5 + списание 2 + брак 1 = 458 (п.2 ТЗ #4902).
        assertEqual(cutSet && cutSet.fields['t1168'], 458, 'погонаж копит введённое при отметке');

        // Активная запись получила накопленное: 20+5, 0+2, 0+1, 0+2.
        var jumboSet = posts.filter(function(p) { return p.path === '_m_set/791461?JSON'; })[0];
        assert(!!jumboSet, 'отметка пишет активную запись джамбо');
        assertEqual(jumboSet && jumboSet.fields['t82382'], 25, 'расход записи = накопленное 20+5');
        assertEqual(jumboSet && jumboSet.fields['t82384'], 2, 'списание записи = 0+2');
        assertEqual(jumboSet && jumboSet.fields['t82386'], 1, 'брак м записи = 0+1');
        assertEqual(jumboSet && jumboSet.fields['t791708'], 2, 'брак шт записи = 0+2');
        // Поля после отметки показывают НАКОПЛЕННОЕ (не очищаются — решение заказчика).
        assertEqual(rec.spent, 25, 'поле расхода после отметки — накопленное');
        assertEqual(rec.spentDraft, '', 'черновик ввода после отметки сброшен');

        // Отрицательная проверка: черновики не вводили — дельта нулевая, отметка не задваивает.
        posts.length = 0;
        rec.spentDraft = ''; rec.writeoffDraft = ''; rec.defectMDraft = ''; rec.defectQtyDraft = '';
        cut.actualRuns = '1';
        c.markPassDone(false);
        setImmediate(function() {
            var j2 = posts.filter(function(p) { return p.path === '_m_set/791461?JSON'; })[0];
            assertEqual(j2 && j2.fields['t82382'], 25, 'повторная отметка без ввода расход не задваивает');
            assert(process.exitCode ? 'есть падения выше' : 'ok', 'маркер конца проверки markPassDone');
            done2();
        });
    });
    function done2() {
        // ── 8) завершение: финальная запись активного джамбо + память по сырью ──
        var store = {};
        global.window.localStorage = {
            getItem: function(k) { return store[k] == null ? null : store[k]; },
            setItem: function(k, v) { store[k] = String(v); },
            removeItem: function(k) { delete store[k]; }
        };
        var c2 = makeController();
        c2.db = 'testdb';
        c2.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
        var rec2 = {
            id: '791295', jumboNo: '102605081738', spent: 30, writeoff: 60, defectM: 0, defectQty: 0,
            counterStart: '3703', counterEnd: ''
        };
        var cut2 = {
            id: '786385', batchId: '700', status: 'В работе',
            counterStart: '3703', meterage: '1890', actualRuns: '2', plannedRuns: '2', runLength: '900',
            notes: '', materialId: '2086', material: 'MR194', inWork: '1',
            jumbos: [rec2], jumboActive: 0
        };
        c2.currentCut = cut2;
        var posts2 = [];
        c2.post = function(path, fields) { posts2.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
        c2.createEvent = function() { return Promise.resolve({}); };
        c2.recordActualRolls = function() { return Promise.resolve(); };
        c2.loadBatches = function() { return Promise.resolve(); };
        c2.loadCuts = function() { return Promise.resolve(); };
        c2.loadEvents = function() { return Promise.resolve(); };
        c2.applyEventStatuses = function() {};
        c2.advanceToNextCut = function() {};
        c2.isCutLocked = function() { return false; };
        c2.eventDateTime = function() { return '2026-09-08T12:00:00'; };
        c2.notify = function() {};

        c2.finishCut();

        setImmediate(function() {
            var cutSet = posts2.filter(function(p) { return p.path === '_m_set/786385?JSON'; })[0];
            assert(!!cutSet, 'завершение пишет счётчики резки');
            assert(!cutSet || !('t787045' in (cutSet && cutSet.fields)), 'резка НЕ получает «№ джамбо» (787045 выведен)');
            var jumboSet = posts2.filter(function(p) { return p.path === '_m_set/791295?JSON'; })[0];
            assert(!!jumboSet, 'завершение пишет финальную запись джамбо');
            assertEqual(jumboSet && jumboSet.fields['t82378'], 2, 'финал: кол-во резок факт');
            assertEqual(jumboSet && jumboSet.fields['t791707'], 1813, 'финал: счётчик кон. записи = счётчик резки (3703−1890)');
            assertEqual(jumboSet && jumboSet.fields['t82380'], 1723, 'финал: конечная длина = 1813 − 30 − 60');
            var mem = JSON.parse(store['atex-sl-jumbo-by-material:testdb'] || '{}');
            assertEqual(mem['2086'] && mem['2086'].no, '102605081738', 'память по сырью: номер джамбо');
            assertEqual(mem['2086'] && mem['2086'].counterEnd, 1813, 'память по сырью: счётчик кон.');
            done3();
        });
    }
    function done3() {
        // ── 9) prefill номера из памяти по сырью ──
        var store = { 'atex-sl-jumbo-by-material:testdb': JSON.stringify({ '2086': { no: '102605081738', counterEnd: 1813 } }) };
        global.window.localStorage = {
            getItem: function(k) { return store[k] == null ? null : store[k]; },
            setItem: function(k, v) { store[k] = String(v); },
            removeItem: function(k) { delete store[k]; }
        };
        var c3 = makeController();
        c3.db = 'testdb';
        c3.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
        var cut3 = { id: '700001', counterStart: '', meterage: '', notes: '', materialId: '2086', material: 'MR194', jumbos: [], jumboActive: 0 };
        c3.currentCut = cut3;
        var requested = [];
        c3.getJson = function(path) { requested.push(path); return Promise.resolve([]); };
        c3.loadJumboRecords(cut3);
        setImmediate(function() {
            assert(requested.some(function(p) { return p.indexOf('report/task_jumbo?JSON_KV&FR_task_id=700001') === 0; }),
                'записи читаются отчётом task_jumbo по заданию');
            assertEqual(cut3.pendingJumbo && cut3.pendingJumbo.jumboNo, '102605081738',
                'на резке без записей номер подставляется из памяти по сырью');
            // Незнакомое сырьё — подставлять нечего.
            var cut4 = { id: '700002', counterStart: '', meterage: '', notes: '', materialId: '99', material: 'ХЗ', jumbos: [], jumboActive: 0 };
            c3.currentCut = cut4;
            c3.loadJumboRecords(cut4);
            setImmediate(function() {
                assertEqual(cut4.pendingJumbo || null, null, 'по незнакомому сырью номер не выдумывается');
                // Добавление джамбо: «Счётчик кон.» предыдущего переходит в «Счётчик нач.».
                var c4 = makeController();
                c4.db = 'testdb';
                c4.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
                var cut5 = {
                    id: '700003', counterStart: '12510', meterage: '', notes: '', materialId: '2086', material: 'MR194',
                    jumbos: [{ id: '791461', jumboNo: 'C200cp383941', counterStart: '12510', counterEnd: '11890', spent: '', writeoff: '', defectM: '', defectQty: '' }],
                    jumboActive: 0
                };
                c4.currentCut = cut5;
                var posts3 = [];
                c4.post = function(path, fields) { posts3.push({ path: path, fields: fields }); return Promise.resolve({ obj: '9001' }); };
                c4.notify = function() {};
                c4.render = function() {};
                c4.askAddJumbo(cut5);
                // Модалка: вводим номер и подтверждаем (модалка вешается в root пульта).
                var overlay = c4.root.childNodes[c4.root.childNodes.length - 1];
                var input = null, ok = null;
                overlay._all([]).forEach(function(n) {
                    if (!input && n.tagName === 'INPUT') input = n;
                    if (!ok && n.classList.contains('atex-sl-btn-primary')) ok = n;
                });
                input.value = '12';
                ok.click();
                setImmediate(function() {
                    var created = posts3.filter(function(p) { return p.path.indexOf('_m_new/82374?JSON&up=700003') === 0; })[0];
                    assert(!!created, 'новый джамбо создаётся записью под задание');
                    assertEqual(created && created.fields['t791706'], '11890',
                        'счётчик нач. нового = счётчик кон. предыдущего');
                    assertEqual(cut5.jumboActive, 1, 'новая закладка активна');
                    assert(process.exitCode ? 'есть падения выше' : 'ok', 'маркер конца проверки');
                    console.log('\n' + passed + '/' + total + ' passed');
                    if (process.exitCode) process.exit(process.exitCode);
                });
            });
        });
    }
})();

console.log('(core-часть: ' + passed + '/' + total + ' — остальное в асинхронных проверках)');
