// #5075 — запись «Номера джамбо» на планшете: «Проходов» оставался только для чтения.
// По журналу: запись джамбо 916937 создана с первой попытки, но saveJumboValues положил её
// id в cut.jumbos без render() — панель так и оставалась в режиме черновика (поле readonly),
// пока её не перерисует что-то другое. Решение владельца: запись джамбо сохраняется с
// повторами, а если не удалось — явная ошибка с просьбой перезагрузить РМ.
//   1) после заведения записи из черновика — render(), «Проходов» открывается;
//   2) postRetry: сеть/5xx повторяются (паузы 1 с / 2 с / 4 с), ошибка приложения — нет;
//      перед повтором _m_new перечитывается task_jumbo — запись с тем же номером не дублируется;
//   3) все попытки исчерпаны — постоянный баннер «Не удалось сохранить джамбо — перезагрузите РМ»
//      и запрет отметок до перезагрузки;
//   4) сохранение во время занятости откладывается флагом jumboRetry и выполняется по setBusy(false);
//   5) фокус на «Проходов» черновика с номером заводит запись и открывает поле.
//
// Run with: node experiments/atex-slitter-5075-jumbo-save.test.js


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
function panelField(wrap, label) {
    var fields = wrap.querySelectorAll('.atex-sl-field');
    for (var i = 0; i < fields.length; i++) {
        var span = fields[i].querySelector('.atex-sl-label');
        if (span && span.textContent === label) return fields[i].childNodes[1];
    }
    return null;
}

function fire(input, ev) { (input._listeners[ev] || []).forEach(function(fn) { fn(); }); }

// ── Поддельные таймеры: паузы между попытками записываются, а не ждутся ──
var delays = [];
var realSetTimeout = setTimeout;
global.setTimeout = function(fn, ms) { delays.push(ms); Promise.resolve().then(fn); return 0; };
function flush(n) {
    var p = Promise.resolve();
    for (var i = 0; i < (n || 60); i++) p = p.then(function() { return new Promise(function(r) { realSetTimeout(r, 0); }); });
    return p;
}
function netErr() { var e = new TypeError('Failed to fetch'); e.network = true; return e; }
function httpErr(status) { var e = new Error('HTTP ' + status); e.status = status; return e; }

// Контроллер с поддельным post: ответы по очереди из сценария (функция или значение).
function scripted(script) {
    var c = makeController();
    c.renders = 0;
    c.render = function() { c.renders++; };
    c.notes = [];
    c.notify = function(msg, kind) { c.notes.push({ msg: msg, kind: kind }); };
    c.reads = [];
    c.getJson = function(path) { c.reads.push(path); return Promise.resolve(c.taskJumboRows || []); };
    c.post = function(path, fields) {
        c.posts.push({ path: path, fields: fields });
        var step = script.length ? script.shift() : { obj: '1' };
        if (step instanceof Error) return Promise.reject(step);
        return Promise.resolve(step);
    };
    return c;
}
function draftCut(no) {
    return baseCut({ jumbos: [], pendingJumbo: jumboRecord('', no, { id: '' }) });
}
var tests = [];

// ── 1) Запись черновика заведена — панель перерисована, «Проходов» открыт ──
tests.push(function() {
    var c = scripted([{ obj: '916937' }, {}]);
    c.currentCut = draftCut('Z41316');
    c.saveJumboValues(true);
    return flush().then(function() {
        assertEqual(c.activeJumbo() && c.activeJumbo().id, '916937', '#5075: черновик стал записью 916937');
        assertEqual(c.renders >= 1, true, '#5075: после создания записи панель перерисована (иначе «Проходов» остаётся readonly)');
        var runs = panelField(c.renderReadings(), 'Проходов');
        assertEqual(runs && runs.getAttribute('readonly'), null, '#5075: «Проходов» записи редактируемый');
    });
});

// ── 2) _m_set: сетевой сбой повторяется с паузами 1 с / 2 с ──
tests.push(function() {
    delays = [];
    var c = scripted([netErr(), httpErr(503), {}]);
    var rec = jumboRecord('920010', 'Z41316', { cutsCount: '2' });
    c.currentCut = baseCut({ jumbos: [rec] });
    return c.saveJumboRecord(rec, { quiet: true, full: true }).then(function(id) {
        assertEqual([c.posts.length, id], [3, '920010'], '#5075: _m_set после сетевого сбоя и 503 доехал с третьей попытки');
        assertEqual(delays.filter(function(ms) { return ms >= 1000; }), [1000, 2000], '#5075: паузы между попытками 1 с, 2 с');
    });
});

// ── 3) Ответ сервера с ошибкой приложения (не сеть, не 5xx) не повторяется ──
tests.push(function() {
    var c = scripted([new Error('Нет прав'), {}]);
    var rec = jumboRecord('920011', 'Z41316', {});
    c.currentCut = baseCut({ jumbos: [rec] });
    return c.saveJumboRecord(rec, { quiet: true }).then(function() {
        assertEqual(c.posts.length, 1, '#5075: ошибка приложения (не сеть/5xx) не повторяется');
    });
});

// ── 4) _m_new: перед повтором перечитываем task_jumbo — дубля нет ──
tests.push(function() {
    var c = scripted([httpErr(502)]);
    c.taskJumboRows = [{ jumbo_id: '916937', jumbo_no: 'Z41316', task_id: '501001' }];
    c.currentCut = draftCut('Z41316');
    return c.ensureJumboRecord(c.currentCut).then(function(stored) {
        var news = c.posts.filter(function(p) { return p.path.indexOf('_m_new/') === 0; });
        assertEqual([news.length, stored && stored.id], [1, '916937'],
            '#5075: запись нашлась в task_jumbo после сбоя — второго _m_new нет, id 916937');
        assertEqual(c.reads.some(function(p) { return p.indexOf('report/task_jumbo') === 0; }), true,
            '#5075: перед повтором _m_new перечитан отчёт task_jumbo');
    });
});

// ── 5) Все попытки исчерпаны: постоянный баннер и запрет отметок до перезагрузки ──
tests.push(function() {
    delays = [];
    var c = scripted([netErr(), netErr(), netErr(), netErr(), netErr()]);
    var rec = jumboRecord('920012', 'Z41316', {});
    c.currentCut = baseCut({ jumbos: [rec] });
    return c.saveJumboRecord(rec, { quiet: true }).then(function() {
        assertEqual(c.posts.length, 4, '#5075: первая попытка и три повтора (1 с / 2 с / 4 с)');
        assertEqual(delays.filter(function(ms) { return ms >= 1000; }), [1000, 2000, 4000], '#5075: паузы 1 с, 2 с, 4 с');
        var banner = c.root.querySelector('.atex-sl-jumbo-fail');
        assertEqual(banner && banner.textContent, 'Не удалось сохранить джамбо — перезагрузите РМ',
            '#5075: постоянный баннер «Не удалось сохранить джамбо — перезагрузите РМ»');
        c.render = Controller.prototype.render;
        var n = c.posts.length;
        c.markPassDone(false);
        assertEqual(c.posts.length, n, '#5075: до перезагрузки отметки прохода не пишутся');
        assertEqual(c.notes.some(function(x) { return x.kind === 'error' && x.msg.indexOf('перезагрузите') >= 0; }), true,
            '#5075: отметка объясняет, что нужно перезагрузить РМ');
    });
});

// ── 6) Сохранение во время занятости не теряется: повтор по setBusy(false) ──
tests.push(function() {
    var c = scripted([{}]);
    var rec = jumboRecord('920013', 'Z41316', {});
    c.currentCut = baseCut({ jumbos: [rec] });
    c.savedJumbo = 'old';
    c.setBusy(true);
    c.saveJumboValues(true);
    assertEqual([c.posts.length, c.jumboRetry], [0, true], '#5075: занято — сохранение отложено флагом jumboRetry');
    c.setBusy(false);
    return flush().then(function() {
        assertEqual(c.posts.some(function(p) { return p.path === '_m_set/920013?JSON'; }), true,
            '#5075: после setBusy(false) отложенное сохранение выполнено');
    });
});

// ── 7) Фокус на «Проходов» черновика с номером заводит запись и открывает поле ──
tests.push(function() {
    var c = scripted([{ obj: '916940' }]);
    c.currentCut = draftCut('Z41399');
    var runs = panelField(c.renderReadings(), 'Проходов');
    assertEqual(runs && runs.getAttribute('readonly'), 'readonly', '#5075: у черновика «Проходов» пока только для чтения');
    fire(runs, 'focus');
    return flush().then(function() {
        assertEqual([c.posts.filter(function(p) { return p.path.indexOf('_m_new/') === 0; }).length, c.renders >= 1], [1, true],
            '#5075: фокус на «Проходов» черновика заводит запись и перерисовывает панель');
        var after = panelField(c.renderReadings(), 'Проходов');
        assertEqual(after && after.getAttribute('readonly'), null, '#5075: после этого «Проходов» редактируемый');
    });
});

tests.reduce(function(p, t, i) {
    return p.then(t).catch(function(e) {
        console.log('FAIL — сценарий ' + (i + 1) + ': исключение ' + (e && e.message || e));
        process.exitCode = 1;
    });
}, Promise.resolve()).then(function() {
    console.log('\n' + passed + ' passed');
}).catch(function(e) {
    console.log('FAIL — исключение: ' + (e && e.stack || e));
    process.exitCode = 1;
});
