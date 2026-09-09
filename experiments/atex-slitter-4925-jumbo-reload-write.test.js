// #4925 — корректность отображения номеров джамбо (боевой кейс: заказ 5208).
// Два дефекта, увиденных вживую:
//   1. «Номер пропал»: записи джамбо читаются асинхронно ПОСЛЕ построения панели
//      показаний, и apply() ничего не перерисовывал — корешки с номерами не
//      появлялись, у завершённого задания поле «Номер джамбо» выглядело пустым,
//      хотя запись в базе есть.
//   2. «Не записывается»: jumboFieldsPut клал главное значение (t82374 = номер) в
//      поля `_m_set`, а `_m_set` главное значение не пишет (docs/kb/crud.md,
//      #4906); на бою такой запрос отбивался ЦЕЛИКОМ ошибкой доступа в массивном
//      ответе `[{error: …}]`, которую post() принимал за успех — финальные
//      счётчики и накопленный расход молча не сохранялись.
//
// Run with: node experiments/atex-slitter-4925-jumbo-reload-write.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-slitter-4916-jumbo-tab-row.test.js) ──
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
var core = slitter.core;

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

// Боевая строка отчёта task_jumbo записи 795551 (задание 792169, заказ 5208).
var ROW_795551 = {
    jumbo_id: '795551', jumbo_no: '123', task_id: '792169',
    length_start: '', counter_start: '79000', cuts_count: '',
    counter_end: '', length_end: '', spent: '', writeoff: '',
    defect_m: '', defect_qty: '', photo: ''
};

function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.notify = function() {};
    return c;
}

// ── 1) записи пришли ПОСЛЕ построения панели — apply перерисовывает пульт ──
(function() {
    var c = makeController();
    c.meta = { jumboTable: JUMBO_82374 };
    var cut = { id: '792169', counterStart: '70600', meterage: '8400', notes: '', jumbos: [], jumboActive: 0 };
    c.currentCut = cut;
    var requestedUrl = '';
    c.getJson = function(url) {
        requestedUrl = url;
        return Promise.resolve([ROW_795551]);   // ответ летит ПОСЛЕ построения DOM
    };
    var renders = 0;
    c.render = function() { renders++; };

    // Как в пульте: панель построена (поле пустое), записи ещё в полёте.
    var wrap = c.renderReadings();
    var tabs = wrap.childNodes[0];
    var input = tabs.childNodes.filter(function(n) { return n.tagName === 'INPUT'; })[0];
    assertEqual(input ? input.value : null, '', '#4925: до прихода записей поле номера пустое');

    setImmediate(function() {
        assertEqual(requestedUrl.indexOf('report/task_jumbo?JSON_KV&FR_task_id=792169'), 0,
            '#4925: записи читаются отчётом task_jumbo по заданию');
        assertEqual(cut.jumbos.length, 1, '#4925: запись применена к заданию');
        assertEqual(cut.jumbos[0].jumboNo, '123', '#4925: номер записи — 123');
        assert(renders > 0, '#4925: apply перерисовал пульт после прихода записей (#4925, «номер пропал»)');

        // Перерисованный пульт показывает номер в активном корешке.
        var rewrap = c.renderReadings();
        var retabs = rewrap.childNodes[0];
        var chips = retabs.childNodes.filter(function(n) { return n.tagName === 'BUTTON' && n.classList.contains('atex-sl-jumbo-tab'); });
        var reinput = retabs.childNodes.filter(function(n) { return n.tagName === 'INPUT'; })[0];
        assertEqual(reinput ? reinput.value : null, '123', '#4925: после перерисовки номер виден в корешке-поле');
        assertEqual(chips.length, 0, '#4925: единственная запись — активный корешок, чужих кнопок нет');
        styleGuardDone();
    });
})();

// ── 2) поля для `_m_set` БЕЗ главного значения (t82374) ──
(function() {
    assertEqual(Object.prototype.hasOwnProperty.call(
        core.jumboRecordFields(JUMBO_82374, { jumboNo: '123', counterEnd: '70600', cutsCount: '28' }).fields, 't82374'), false,
        '#4925: jumboRecordFields (финальная доводка) не кладёт главное значение');
    assertEqual(Object.prototype.hasOwnProperty.call(
        core.jumboInputFields(JUMBO_82374, { jumboNo: '123', spent: '6' }).fields, 't82374'), false,
        '#4925: jumboInputFields (автосохранение) не кладёт главное значение');

    // Payload финальной доводки finishCut — тот же jumboFields: реквизиты на месте.
    var c = makeController();
    c.meta = { jumboTable: JUMBO_82374 };
    var finals = c.jumboFields({ jumboNo: '123', counterStart: '79000', counterEnd: '70600', cutsCount: '28', spent: 0, writeoff: 0, defectM: 0, defectQty: 0 });
    assertEqual(finals['t791707'], '70600', '#4925: «Счётчик кон.» в финальном payload');
    assertEqual(finals['t82378'], '28', '#4925: «Кол-во резок» в финальном payload');
    assertEqual(finals['t82380'], 70600, '#4925: конечная длина = счётчик кон. (расходы нулевые)');
})();

// ── 3) post() видит ошибку в массивном ответе `[{error: …}]` ──
(function() {
    var c = makeController();
    var responses = [];
    global.fetch = function() {
        var body = responses.length ? responses.shift() : '{}';
        return Promise.resolve({ text: function() { return Promise.resolve(body); } });
    };

    // Ровно боевой ответ #4925: запрет доступа к главному значению — массив с ошибкой.
    responses.push('[{"error":"У вас нет доступа к реквизиту объекта: 795551, 82374 () или его родителю  ()! Ваш глобальный доступ: \'WRITE\'."}]');
    var failed = false;
    c.post('_m_set/795551?JSON', { 't82374': '123', 't791707': '70600' }).then(function() {
        styleGuard2();
    }).catch(function(err) {
        failed = true;
        assert(failed, '#4925: ошибка внутри массивного ответа не проходит за успех');
        assert(String(err.message).indexOf('нет доступа к реквизиту') !== -1, '#4925: текст ошибки сервера доезжает до вызывающего');
        styleGuard2();
    });

    // Массив БЕЗ ошибок — успех (пакетная запись); объект с error — прежнее поведение.
    function styleGuard2() {
        responses.push('[{"id":"1","obj":795551,"next_act":"nul"}]');
        c.post('_m_set/795551?JSON', { 't82378': '28' }).then(function(res) {
            assertEqual(res && res[0] && res[0].obj, 795551, '#4925: массивный ответ без ошибок — успех');
            responses.push('{"error":"boom"}');
            return c.post('_m_set/795551?JSON', {});
        }).then(function() {
            assert(false, '#4925: объектная ошибка {error} по-прежнему роняет post');
            styleGuard3();
        }).catch(function(err) {
            assertEqual(err && err.message, 'boom', '#4925: объектная ошибка {error} по-прежнему роняет post');
            styleGuard3();
        });
    }
})();

// ── 4) saveJumboRecord: записи без номера поста нет (гвард по записи, не по полям) ──
(function() {
    var c = makeController();
    c.meta = { jumboTable: JUMBO_82374 };
    var posts = [];
    c.post = function(path, fields) { posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    return c.saveJumboRecord({ id: '795551', jumboNo: '', spent: '6' }).then(function(res) {
        assertEqual(res, null, '#4925: запись без номера не сохраняется');
        assertEqual(posts.length, 0, '#4925: записи без номера — поста нет');
        styleGuard4();
    });
})();

// ── учёт асинхронных веток: ждём завершения всех трёх сценариев ──
var guardsPending = 3;
function styleGuardDone() {
    guardsPending--;
    if (guardsPending === 0) {
        console.log('\n' + passed + '/' + total + ' assertions passed');
        if (process.exitCode) process.exit(process.exitCode);
    }
}
function styleGuard3() { styleGuardDone(); }
function styleGuard4() { styleGuardDone(); }
