// Tests for ideav/crm#4401 — кнопка «↻ Пересчитать наладку»:
//   A) НЕ переставляет задания — пишет только тайминг (три хранимые колонки), planStart не трогает,
//      заданий не создаёт и не удаляет;
//   B) только ЭТОТ станок и только ВИДИМЫЕ дни (диапазон фильтра [С; По]);
//   C) показывается ПО ФАКТУ РАСХОЖДЕНИЯ хранимого тайминга с расчётом по текущему порядку
//      (раньше — по сессионному флагу «двигали задания»: человек мог подвигать и уйти, флаг терялся);
//   D) подтверждения (панель ДО/ПОСЛЕ + «Ок»/«Отменить») больше нет — подтверждать нечего.
//
// Run with: node experiments/atex-pp-4401-recalc-timing-only.test.js

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

var KNIFE_REQ = '96067', MAT_REQ = '96069', TIME_REQ = '96778', CUT_TABLE = '1078';
function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }

// Задание очереди. stored* — то, что «уже записано» в БД (может разойтись с расчётом).
function cutOf(id, sid, planTs, over) {
    var c = { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: sid, label: 'Станок ' + sid },
        materialId: '500', winding: 'OUT', knifeWidths: [110, 110], knifeCount: 2,
        plannedRuns: 3, duration: 60, length: 1000, startDate: '', endDate: '',
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
    over = over || {};
    for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) c[k] = over[k];
    return c;
}
function makeController(cuts, filter) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div'); c.formEl = new StubNode('div');
    c.filter = filter || { slitter: '', status: '', date: '', dateTo: '', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 1' }, { id: '202', label: 'Станок 2' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = [];
    c.supplies = cuts.map(function(x, i) { return { id: 's' + i, cutId: x.id, positionId: null, rolls: 0, dueKey: 20260831 }; });
    c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
    c.meta.cut = { id: CUT_TABLE, reqs: [
        { id: KNIFE_REQ, val: 'Наладка ножей, мин' },
        { id: MAT_REQ, val: 'Сырье/намотка, мин' },
        { id: TIME_REQ, val: 'Резка и Лидер' }
    ] };
    c.renderLink = function() {}; c.render = function() {};
    c.showProgress = function() {}; c.hideProgress = function() {}; c.updateProgress = function() {};
    c._notes = []; c.notify = function(m, k) { c._notes.push({ msg: m, kind: k }); };
    c._posts = [];
    c.post = function(path, fields) { c._posts.push({ path: path, fields: fields }); return Promise.resolve({ obj: '1' }); };
    c.reload = function() { return Promise.resolve(); };
    return c;
}
function flush() {
    var p = Promise.resolve();
    for (var i = 0; i < 40; i++) p = p.then(function() {});
    return p;
}

var D1 = tsAt(2026, 7, 27, 8, 0), D1b = tsAt(2026, 7, 27, 12, 0), D2 = tsAt(2026, 7, 30, 8, 0);

// ── A) recalcScopeCutIds: свой станок, видимые дни ───────────────────────────
(function () {
    var cuts = [
        cutOf('a1', '101', D1), cutOf('a2', '101', D1b),
        cutOf('a3', '101', D2),                      // тот же станок, ДЕНЬ ВНЕ окна
        cutOf('b1', '202', D1)                       // видимый день, ЧУЖОЙ станок
    ];
    var c = makeController(cuts, { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-28', query: '' });
    assertEqual(c.recalcScopeCutIds('101'), ['a1', 'a2'],
        'в набор входят только задания своего станка внутри [С; По]');
    assertEqual(c.recalcScopeCutIds('202'), ['b1'], 'у другого станка — свой набор');

    var open = makeController(cuts, { slitter: '', status: '', date: '', dateTo: '', query: '' });
    assertEqual(open.recalcScopeCutIds('101'), ['a1', 'a2', 'a3'],
        'пустой фильтр дат не ограничивает — весь станок');
})();

// ── B) setupMismatchIds: детектор расхождения, без побочных эффектов ─────────
(function () {
    var cuts = [cutOf('a1', '101', D1), cutOf('a2', '101', D1b)];
    var c = makeController(cuts, { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' });

    var ids = c.setupMismatchIds('101');
    assert(ids.length > 0, 'пустой хранимый тайминг = расхождение (кнопка нужна)');

    // Ключевое: детектор НЕ имеет права «пометить как записанное» — иначе кнопка исчезнет,
    // ничего не сохранив. Второй прогон обязан дать тот же результат.
    assertEqual(c.setupMismatchIds('101'), ids, 'повторный прогон детектора даёт то же — состояние не тронуто');
    assertEqual([cuts[0].storedKnifeSetupMin, cuts[0].storedCutAndLeaderMin], ['', ''],
        'детектор не переписал stored* у резки (dryRun)');

    // Приводим хранимое в соответствие расчёту → расхождения исчезают.
    var want = c.computeCutSetupUpdates(null, { dryRun: true }).updates;
    want.forEach(function(u) {
        var cut = cuts.filter(function(x) { return String(x.id) === String(u.cutId); })[0];
        cut.storedKnifeSetupMin = String(u.knife);
        cut.storedMaterialWindingMin = String(u.material);
        cut.storedCutAndLeaderMin = String(u.cutTime);
    });
    assertEqual(c.setupMismatchIds('101'), [], 'тайминг совпал с расчётом → расхождений нет, кнопки не будет');

    // Сдвинули хранимое у одного задания — расхождение снова только у него.
    cuts[1].storedCutAndLeaderMin = '999';
    assertEqual(c.setupMismatchIds('101'), ['a2'], 'расхождение видно ровно у того задания, где оно есть');
})();

// ── C) Кнопка в очереди: показ по факту расхождения ──────────────────────────
function recalcBtnOf(queueEl) {
    return queueEl.querySelectorAll('.atex-pp-recalc-setup')[0] || null;
}
(function () {
    var cuts = [cutOf('a1', '101', D1), cutOf('a2', '101', D1b)];
    var c = makeController(cuts, { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' });
    c.renderQueue();
    var btn = recalcBtnOf(c.queueEl);
    assert(!!btn, 'есть расхождение → кнопка «Пересчитать наладку» показана');
    assert(btn && String(btn.textContent).indexOf('заданий: 2') !== -1,
        'в подписи кнопки — сколько заданий разошлось');
    assertEqual(c.queueEl.querySelectorAll('.atex-pp-recalc-preview').length, 0,
        'панели предпросмотра ДО/ПОСЛЕ больше нет');

    // Хранимое = расчёт → кнопки нет.
    var want = c.computeCutSetupUpdates(null, { dryRun: true }).updates;
    want.forEach(function(u) {
        var cut = cuts.filter(function(x) { return String(x.id) === String(u.cutId); })[0];
        cut.storedKnifeSetupMin = String(u.knife);
        cut.storedMaterialWindingMin = String(u.material);
        cut.storedCutAndLeaderMin = String(u.cutTime);
    });
    c.renderQueue();
    assertEqual(recalcBtnOf(c.queueEl), null, 'расхождений нет → кнопки нет');
})();

// ── E) Подпись очереди станка и кэш детектора ────────────────────────────────
(function () {
    var planning = api.planning;
    var base = [cutOf('a1', '101', D1), cutOf('a2', '101', D1b), cutOf('b1', '202', D1)];
    var sig = planning.slitterQueueSignature(base, '101');
    assertEqual(planning.slitterQueueSignature(base, '101'), sig, 'подпись стабильна на неизменных данных');

    function clone(over, idx) {
        var arr = base.map(function(c) { var o = {}; for (var k in c) o[k] = c[k]; return o; });
        for (var k2 in over) arr[idx][k2] = over[k2];
        return arr;
    }
    assert(planning.slitterQueueSignature(clone({ planDate: String(D2) }, 0), '101') !== sig,
        'сдвиг planStart меняет подпись (порядок другой)');
    assert(planning.slitterQueueSignature(clone({ storedCutAndLeaderMin: '777' }, 1), '101') !== sig,
        'правка хранимого тайминга меняет подпись');
    assert(planning.slitterQueueSignature(clone({ knifeWidths: [55] }, 1), '101') !== sig,
        'смена ножей меняет подпись');
    assert(planning.slitterQueueSignature(clone({ materialId: '999' }, 1), '101') !== sig,
        'смена сырья меняет подпись');
    assertEqual(planning.slitterQueueSignature(clone({ storedCutAndLeaderMin: '777' }, 2), '101'), sig,
        'изменения на ДРУГОМ станке подпись не трогают');
})();

(function () {
    var cuts = [cutOf('a1', '101', D1), cutOf('a2', '101', D1b)];
    var c = makeController(cuts, { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' });
    var calls = 0, orig = c.computeCutSetupUpdates;
    c.computeCutSetupUpdates = function(ids, opts) { calls++; return orig.call(this, ids, opts); };

    var first = c.setupMismatchIds('101');
    assertEqual(calls, 1, 'первый вызов считает');
    c.setupMismatchIds('101'); c.setupMismatchIds('101');
    assertEqual(calls, 1, 'повторные вызовы берут кэш — очередь не пересчитывается на каждый рендер');

    cuts[1].storedCutAndLeaderMin = '777';       // данные изменились
    assertEqual(c.setupMismatchIds('101').length >= 0, true, 'после правки данных вызов проходит');
    assertEqual(calls, 2, 'изменились данные — кэш сброшен, пересчитали');

    c.filter.dateTo = '2026-07-30';              // изменилось окно фильтра
    c.setupMismatchIds('101');
    assertEqual(calls, 3, 'смена видимых дней тоже сбрасывает кэш');

    c._planDataVersion = (c._planDataVersion || 0) + 1;   // как после reload()
    c.setupMismatchIds('101');
    assertEqual(calls, 4, 'перезагрузка данных (версия) сбрасывает кэш');
    void first;
})();

// ── D) recalcSetupTiming: только тайминг, только свой станок и видимые дни ───
(function run() {
    var cuts = [
        cutOf('a1', '101', D1), cutOf('a2', '101', D1b),
        cutOf('a3', '101', D2),                      // вне окна фильтра
        cutOf('b1', '202', D1)                       // другой станок
    ];
    var c = makeController(cuts, { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' });
    c.recalcSetupTiming('101');
    flush().then(function() {
        var paths = c._posts.map(function(p) { return p.path; });
        assert(paths.length > 0, 'пересчёт что-то записал');

        // Порядок не трогаем: planStart (главное значение) пишется через _m_save, его быть не должно.
        assertEqual(paths.filter(function(p) { return p.indexOf('_m_save') === 0; }).length, 0,
            'НИ ОДНОГО _m_save — planStart не переписан, задания не переставлены');
        assertEqual(paths.filter(function(p) { return p.indexOf('_m_new') === 0 || p.indexOf('_m_del') === 0; }).length, 0,
            'заданий не создаём и не удаляем');
        assert(paths.every(function(p) { return p.indexOf('_m_set/') === 0; }),
            'все записи — _m_set (только хранимые колонки тайминга)');

        var touched = paths.map(function(p) { return p.replace(/^_m_set\//, '').replace(/\?.*$/, ''); }).sort();
        assertEqual(touched, ['a1', 'a2'],
            'затронуты только задания своего станка в видимых днях (a3 вне окна, b1 чужой станок — нетронуты)');

        // Пишутся ровно три колонки тайминга.
        var keys = Object.keys(c._posts[0].fields).sort();
        assertEqual(keys, ['t' + KNIFE_REQ, 't' + MAT_REQ, 't' + TIME_REQ].sort(),
            'в payload только «Наладка ножей» / «Сырье-намотка» / «Резка и Лидер»');

        // Расхождений нет → ничего не пишем и говорим об этом.
        var cuts2 = [cutOf('z1', '101', D1)];
        var c2 = makeController(cuts2, { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' });
        var want = c2.computeCutSetupUpdates(null, { dryRun: true }).updates;
        want.forEach(function(u) {
            cuts2[0].storedKnifeSetupMin = String(u.knife);
            cuts2[0].storedMaterialWindingMin = String(u.material);
            cuts2[0].storedCutAndLeaderMin = String(u.cutTime);
        });
        c2.recalcSetupTiming('101');
        return flush().then(function() {
            assertEqual(c2._posts.length, 0, 'нечего пересчитывать → ни одной записи в БД');
            assert(c2._notes.filter(function(n) { return n.msg.indexOf('уже актуальна') !== -1; }).length === 1,
                'сообщаем, что наладка уже актуальна');

            console.log('\n' + passed + '/' + total + ' passed');
        });
    }).catch(function(e) { console.error('FAIL — исключение в асинхронной части:', e && e.stack || e); process.exitCode = 1; });
})();
