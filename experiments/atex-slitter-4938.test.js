// #4938 — регрессия «Все проходы уже отмечены»: отказ записи ПАРТИИ СЫРЬЯ
// (syncBatchRemainder) не должен ронять цепочку отметки прохода.
//
// Боевое 10.09 (задания 789853/… заказа 5233, Станки 2 и 3): отметка записала
// «Кол-во резок факт» = плану и событие «Резка», затем syncBatchRemainder при
// отрицательном «Счётчике кон.» добавил партии снятие «В работе» — а у роли
// Оператор на этот реквизит не было гранта: сервер отбил запрос ЦЕЛИКОМ, с #4926
// массивная ошибка стала честным throw → catch «Ошибка отметки прохода», finishCut
// не вызван. Факт при этом УЖЕ в базе — каждое следующее «Готово» упиралось в
// «Все проходы уже отмечены», задание закрыли только «Прекратить».
//
// Правило: отметка к моменту синка уже записана (факт, погонаж, событие) — отказ
// склада ОРЁТ отдельной ошибкой, но не прячет сделанное и не блокирует завершение.
//
// Run with: node experiments/atex-slitter-4938.test.js

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
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function() { return ''; }, set: function(v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
StubNode.prototype.appendChild = function(n) { this.childNodes.push(n); n.parentNode = this; return n; };
StubNode.prototype.removeChild = function(n) { this.childNodes = this.childNodes.filter(function(c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function(k, v) { this.attributes[k] = String(v); if (k === 'value') this.value = String(v); };
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
            { id: '3861x', val: 'Расход сырья' }
        ]
    };
}

function makeController() {
    var root = new StubNode('div');
    root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.notify = function() {};
    return c;
}

// Контроллер с заданием «последний проход»: план 3, сделано 2, отметка «Готово»
// доводит до плана; syncBatchRemainder отбит сервером (боевое: нет гранта на
// снятие «В работе» партии → массивная ошибка → throw c #4926).
function scenario() {
    var c = makeController();
    c.meta = { cut: cutMeta(), jumboTable: JUMBO_82374 };
    var rec = {
        id: '800516', jumboNo: '349', savedNo: '349',
        spent: '', writeoff: '', defectM: '', defectQty: '',
        counterStart: '11126', counterEnd: '',
        spentDraft: '', writeoffDraft: '', defectMDraft: '', defectQtyDraft: ''
    };
    var cut = {
        id: '789853', batchId: '74925', status: 'В работе', inWork: '1',
        counterStart: '11126', meterage: '1200', actualRuns: '2', plannedRuns: '3',
        runLength: '600', notes: '', startedAt: '2026-09-10T09:00:00',
        jumbos: [rec], jumboActive: 0
    };
    c.currentCut = cut;
    var calls = { posts: [], finish: 0, notices: [] };
    c.post = function(path, fields) { calls.posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.createEvent = function(ev) { calls.posts.push({ path: 'event', fields: ev }); return Promise.resolve({}); };
    c.syncBatchRemainder = function() { return Promise.reject(new Error('нет доступа к реквизиту 16427, глобальный доступ WRITE')); };
    c.finishCut = function() { calls.finish++; };
    c.loadEvents = function() { return Promise.resolve(); };
    c.loadCuts = function() { return Promise.resolve(); };
    c.applyEventStatuses = function() {};
    c.eventDateTime = function() { return '2026-09-10T09:13:00'; };
    c.notify = function(msg, kind) { calls.notices.push({ msg: String(msg), kind: kind }); };
    c.render = function() {};
    return { c: c, cut: cut, calls: calls };
}

// ── 1) последний проход при отбитом синке партии: отметка доходит до завершения ──
var s1 = scenario();
s1.c.markPassDone(false);
setImmediate(function() {
    var wroteRuns = s1.calls.posts.filter(function(p) { return p.path === '_m_set/789853?JSON' && p.fields && p.fields['t657315'] === 3; })[0];
    assert(!!wroteRuns, 'отметка записала «Кол-во резок факт» = 3');
    var ev = s1.calls.posts.filter(function(p) { return p.path === 'event'; })[0];
    assertEqual(ev && ev.fields && ev.fields.value, '3', 'событие «Резка» со значением 3 записано');
    assertEqual(s1.calls.finish, 1,
        'отказ syncBatchRemainder НЕ блокирует завершение — finishCut вызван');
    assert(s1.calls.notices.some(function(n) { return n.kind === 'error' && /остаток|парти/i.test(n.msg); }),
        'отказ склада виден отдельной ошибкой (не молчим)');
    assert(!s1.calls.notices.some(function(n) { return /Ошибка отметки прохода/.test(n.msg); }),
        'записанная отметка не объявляется «Ошибкой отметки прохода»');
    step2();
});

// ── 2) промежуточный проход: отказ синка тоже не превращается в «ошибку отметки» ──
function step2() {
    var s2 = scenario();
    s2.cut.plannedRuns = '5';   // план 5, сделано 2 → отметка третьего, не финал
    s2.c.markPassDone(false);
    setImmediate(function() {
        assertEqual(s2.calls.finish, 0, 'не финал — finishCut не зовётся');
        assert(s2.calls.notices.some(function(n) { return n.kind === 'success'; }),
            'проход отмечен успехом — запись-то прошла');
        assert(s2.calls.notices.some(function(n) { return n.kind === 'error' && /остаток|парти/i.test(n.msg); }),
            'отказ склада виден отдельной ошибкой и на промежуточном проходе');
        assert(!s2.calls.notices.some(function(n) { return /Ошибка отметки прохода/.test(n.msg); }),
            'и здесь «Ошибка отметки прохода» не появляется');
        console.log('\n' + passed + ' / ' + total + ' assertions passed');
    });
}
