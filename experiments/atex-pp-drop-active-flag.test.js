// Tests: с формы «Новое производственное задание» убрана галка «В работе», значение
// реквизита БОЛЬШЕ НЕ СОХРАНЯЕТСЯ (решение заказчика 25.07.2026).
//
// Почему убрали: реквизит «В работе» задания — флаг АКТИВНОСТИ ЗАПИСИ, а не статус. Рабочее
// место его нигде не читало (ни mapCutRecord/rowsToPlanning, ни очередь/Гант/генерация),
// переключателя на карточке нет — галка была записью в никуда. Статус очереди — отдельное
// поле (cut_status отчёта cut_planning).
//
// Покрываем:
//   1) форма (renderForm на DOM-стабе): галки «В работе» нет, класс .atex-pp-checkbox-field
//      не встречается, остальные поля формы на месте;
//   2) createCutForPosition: в payload _m_new задания НЕТ ключа реквизита «В работе»
//      (t{activeReqId}) ни в каком виде — ни '1', ни '0';
//   3) соседние записи не задеты: «Партия ГП» и «Обеспечение» свой флаг активности
//      по-прежнему пишут (галка их не касалась).
//
// Run with: node experiments/atex-pp-drop-active-flag.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-production-planning-4396.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function(c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function(c) { self._className = self._classes().filter(function(x) { return x !== c; }).join(' '); },
        contains: function(c) { return self._classes().indexOf(c) !== -1; },
        toggle: function(c, on) { if (on) this.add(c); else this.remove(c); }
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
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); };
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

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

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
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// id реквизита «В работе» задания — по нему проверяем, что ключ t9003 в payload не уехал.
var ACTIVE_REQ_ID = '9003';
var CUT_TABLE_ID = '1078';

function fakeProspect(positionId, qty) {
    return {
        forKey: String(positionId) + '|' + qty,
        positionId: String(positionId), position: { id: 'p1', length: 1000, orderId: 'o1' }, qty: qty,
        materialId: '500', layout: { windDir: 'нар', strips: [{ width: 330, qty: 3 }] },
        plannedRuns: 2, runLength: 1000, duration: 40, timing: '',
        batches: [{ width: 330, strips: 3, length: 1000 }],
        posWidth: 330, stripsPerPass: 3, producedPosRolls: 6, supplyRolls: qty,
        stockRolls: 1, sleeveTasks: [], multiLayout: false,
        scheduleCut: { id: '__new__', plannedRuns: 2, materialId: '500', winding: 'нар', knifeWidths: [330, 330, 330], runLength: 1000 }
    };
}
function makeController() {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.formEl = new StubNode('div'); c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-24', dateTo: '', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 3', stopMaterialIds: [], widthCode: '' }];
    c.activeSlitter = '101';
    c.cuts = [];
    var pos = { id: 'p1', approved: true, qty: 5, materialId: '500', width: 330, orderWidth: 330,
        length: 1000, dueKey: 20260731, orderId: 'o1', leader: '' };
    c.positions = [pos]; c.genPositions = [pos];
    c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = { '500': 1000 }; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
    c.renderLink = function() {}; c.render = function() {}; c.closeForm = function() {};
    c._notes = [];
    c.notify = function(msg, kind) { c._notes.push({ msg: msg, kind: kind }); };
    c.buildCutProspect = function(positionId, qty) {
        return Promise.resolve(fakeProspect(positionId, Math.floor(Number(qty) || 0)));
    };
    return c;
}
function renderReady(c) {
    c.draft.prospect = fakeProspect(c.draft.positionId, Math.floor(Number(c.draft.qty) || 0));
    c.renderForm();
    return c.formEl;
}

// ── 1) Формы: галки нет ──────────────────────────────────────────────────────
(function () {
    var c = makeController();
    c.draft.positionId = 'p1'; c.draft.qty = '5'; c.draft.slitterId = '101';
    var form = renderReady(c);

    assertEqual(form.querySelectorAll('.atex-pp-checkbox-field').length, 0,
        'на форме нет контейнера галки .atex-pp-checkbox-field');
    var checkboxes = form._all([]).filter(function(n) { return n.getAttribute('type') === 'checkbox'; });
    assertEqual(checkboxes.length, 0, 'на форме нет ни одного checkbox');
    assert(String(form.textContent).indexOf('В работе') === -1,
        'подписи «В работе» на форме больше нет');
    assertEqual(c.draft.active, undefined, 'в черновике нет поля active');

    // Остальные поля формы не задеты.
    var labels = form.querySelectorAll('.atex-pp-label').map(function(n) { return n.textContent; });
    assert(labels.filter(function(t) { return t.indexOf('Заказанное количество') !== -1; }).length === 1, 'поле «Заказанное количество» на месте');
    assert(labels.filter(function(t) { return t.indexOf('Кол-во рулонов') !== -1; }).length === 1, 'поле «Кол-во рулонов» на месте');
    assert(labels.filter(function(t) { return t.indexOf('Станок') !== -1; }).length === 1, 'поле «Станок» на месте');
    assert(labels.filter(function(t) { return t.indexOf('День вставки') !== -1; }).length === 1, 'поле «День вставки» (#4396) на месте');
    assert(labels.filter(function(t) { return t.indexOf('Примечания') !== -1; }).length === 1, 'поле «Примечания» на месте');
})();

// ── 2) Создание: реквизит «В работе» не пишется ──────────────────────────────
function makeCreateController() {
    var c = makeController();
    // ВАЖНО: имя реквизита в метаданных Integram лежит в `val` (matchesName смотрит val/alias),
    // а не в `name` — с `name` ничего не резолвится и тест был бы ложно-зелёным.
    c.meta.cut = { id: CUT_TABLE_ID, reqs: [
        { id: '9001', val: 'Слиттер' },
        { id: '9002', val: 'Кол-во план' },
        { id: ACTIVE_REQ_ID, val: 'В работе' },     // реквизит в схеме ЕСТЬ — но писать не должны
        { id: '9004', val: 'Примечания' }
    ] };
    c.meta.finishedBatch = { id: '1080', reqs: [{ id: '8001', val: 'В работе' }] };
    c.meta.supply = { id: '1079', reqs: [{ id: '7001', val: 'В работе' }] };
    c.meta.sleeveTask = null;
    c._posts = [];
    c.post = function(path, fields) { c._posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: 'NEW1' }); };
    c.reload = function() {
        c.cuts = [{ id: 'NEW1', number: '1', slitter: { id: '101', label: 'Станок 3' },
            materialId: '500', planDate: '', startDate: '', endDate: '' }];
        return Promise.resolve();
    };
    c.persistCutSetupColumns = function() { return Promise.resolve(); };
    c.moveCutToDay = function() { return Promise.resolve(true); };
    c.resolveLeaderId = function() { return ''; };
    c.sleeveTaskReqIds = function() { return null; };
    c.draft.positionId = 'p1'; c.draft.qty = '5'; c.draft.slitterId = '101';
    c.draft.prospect = fakeProspect('p1', 5);
    return c;
}
function flush() {
    var p = Promise.resolve();
    for (var i = 0; i < 40; i++) p = p.then(function() {});
    return p;
}

(function run() {
    var c = makeCreateController();
    c.createCutForPosition();
    flush().then(function() {
        var cutPost = c._posts.filter(function(p) { return p.path.indexOf('_m_new/' + CUT_TABLE_ID) === 0; })[0];
        assert(!!cutPost, 'задание создаётся (POST _m_new по таблице задания есть)');

        var keys = Object.keys(cutPost.fields || {});
        assertEqual(keys.indexOf('t' + ACTIVE_REQ_ID), -1,
            'в payload задания НЕТ ключа реквизита «В работе» (t' + ACTIVE_REQ_ID + ')');
        assertEqual(cutPost.fields['t' + ACTIVE_REQ_ID], undefined,
            'значение «В работе» не пишется ни как 1, ни как 0');
        // Полезные поля на месте — payload не выхолостили заодно.
        assertEqual(cutPost.fields['t9001'], '101', 'станок в payload остался');
        assert(cutPost.fields['t9002'] != null, 'кол-во проходов в payload осталось');

        // 3) Соседние записи свой флаг активности пишут по-прежнему.
        var fbPost = c._posts.filter(function(p) { return p.path.indexOf('_m_new/1080') === 0; })[0];
        var supPost = c._posts.filter(function(p) { return p.path.indexOf('_m_new/1079') === 0; })[0];
        assertEqual(fbPost && fbPost.fields['t8001'], '1', '«Партия ГП» свой флаг активности пишет (её галка не касалась)');
        assertEqual(supPost && supPost.fields['t7001'], '1', '«Обеспечение» свой флаг активности пишет (её галка не касалась)');

        console.log('\n' + passed + '/' + total + ' passed');
    }).catch(function(e) { console.error('FAIL — исключение в асинхронной части:', e && e.stack || e); process.exitCode = 1; });
})();
