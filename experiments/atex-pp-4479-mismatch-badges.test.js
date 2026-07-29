// Tests for ideav/crm#4479 — отклонение, найденное автоматической проверкой, видно НА ОБЪЕКТЕ:
// кнопка «↻ Пересчитать наладку (заданий: N)» называет число, а какие это задания и что с ними
// не так — показывают бейджи на карточках очереди (суть) и их подсказки (было → стало).
// Покрываем:
//   1) ПРАВИЛО (общий тест, любые входы): сколько заданий насчитал детектор — столько бейджей в
//      очереди, и ровно на тех же id. Источник у счётчика и бейджей один (recalcMismatchRows),
//      разойтись они не могут;
//   2) чистые setupMismatchRows / setupMismatchSummary / setupMismatchTitle: расхождение колонок
//      наладки, расхождение старта, оба сразу, пустой вход;
//   3) карточку: текст бейджа = суть отклонения, title = «было → стало»;
//   4) расхождений нет → ни кнопки, ни бейджей (пустая очередь ничем не помечена).
//
// Run with: node experiments/atex-pp-4479-mismatch-badges.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в experiments/atex-pp-4401-recalc-timing-only.test.js) ──
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
var planning = api.planning;
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
function at(hh, mm) { return tsAt(2026, 7, 27, hh, mm); }
var FILTER = { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' };

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
// Хранимые колонки = расчёт (как после записи наладки). Кривыми остаются только старты.
function syncStoredTiming(ctrl, cuts) {
    (ctrl.computeCutSetupUpdates(null, { dryRun: true }).updates || []).forEach(function(u) {
        var cut = cuts.filter(function(x) { return String(x.id) === String(u.cutId); })[0];
        if (!cut) return;
        cut.storedKnifeSetupMin = String(u.knife);
        cut.storedMaterialWindingMin = String(u.material);
        cut.storedCutAndLeaderMin = String(u.cutTime);
    });
    ctrl._setupMismatchCache = null;
}
// Хранимые колонки И старты приведены к расчёту → расхождений нет вовсе.
function syncTimingAndStarts(ctrl, cuts) {
    syncStoredTiming(ctrl, cuts);
    var byDay = {};
    cuts.forEach(function(cut) {
        var day = new Date(Number(cut.planDate) * 1000).toDateString();
        var occ = Number(cut.storedKnifeSetupMin) + Number(cut.storedMaterialWindingMin) + Number(cut.storedCutAndLeaderMin);
        var ts = byDay[day] != null ? byDay[day] : Number(cut.planDate);
        cut.planDate = String(ts); cut.number = String(ts);
        byDay[day] = ts + occ * 60;
    });
    ctrl._setupMismatchCache = null;
}
function badgesOf(queueEl) {
    return queueEl.querySelectorAll('.atex-pp-cut').map(function(card) {
        return { cutId: String(card.dataset.cutId),
                 badge: card.querySelector('.atex-pp-cut-mismatch-badge') };
    }).filter(function(x) { return !!x.badge; });
}
function counterOf(queueEl) {
    var btn = queueEl.querySelectorAll('.atex-pp-recalc-setup')[0] || null;
    if (!btn) return null;
    var m = /заданий:\s*(\d+)/.exec(String(btn.textContent));
    return m ? Number(m[1]) : null;
}

// ── 1) ПРАВИЛО: счётчик кнопки = бейджи на карточках, на тех же заданиях ─────
// Общий тест: разные виды расхождения (пустые колонки, кривые старты, смесь, ничего) —
// в каждом случае найденное автоматической проверкой обязано быть видно на объектах.
(function () {
    var CASES = [
        { name: 'пустые колонки тайминга у всей очереди',
          build: function() { return [cutOf('a1', '101', at(8, 0)), cutOf('a2', '101', at(11, 0)), cutOf('a3', '101', at(13, 0))]; },
          prep: function() {} },
        { name: 'колонки актуальны, разъехались старты',
          build: function() { return [cutOf('b1', '101', at(8, 0)), cutOf('b2', '101', at(8, 51)), cutOf('b3', '101', at(9, 49))]; },
          prep: function(c, cuts) { syncStoredTiming(c, cuts); } },
        { name: 'сдвинуто хранимое у одного задания',
          build: function() { return [cutOf('c1', '101', at(8, 0)), cutOf('c2', '101', at(11, 0))]; },
          prep: function(c, cuts) { syncTimingAndStarts(c, cuts); cuts[1].storedCutAndLeaderMin = '999'; c._setupMismatchCache = null; } },
        { name: 'расхождений нет',
          build: function() { return [cutOf('d1', '101', at(8, 0)), cutOf('d2', '101', at(11, 0))]; },
          prep: function(c, cuts) { syncTimingAndStarts(c, cuts); } }
    ];
    CASES.forEach(function(cs) {
        var cuts = cs.build();
        var c = makeController(cuts, FILTER);
        cs.prep(c, cuts);
        var ids = c.recalcMismatchIds('101');
        c.renderQueue();
        var marked = badgesOf(c.queueEl);
        assertEqual(marked.length, ids.length,
            cs.name + ': бейджей столько же, сколько насчитал детектор (' + ids.length + ')');
        assertEqual(marked.map(function(x) { return x.cutId; }).sort(), ids.slice().sort(),
            cs.name + ': помечены ровно те задания, что в списке расхождений');
        assertEqual(counterOf(c.queueEl), ids.length ? ids.length : null,
            cs.name + ': число в кнопке = число бейджей');
    });
})();

// ── 2) Чистые разбор и подписи ──────────────────────────────────────────────
(function () {
    var timing = [{ cutId: 'a1', knife: 45, material: 6, cutTime: 72,
                    wasKnife: '30', wasMaterial: '6', wasCutTime: '72' }];
    var starts = [{ cutId: 'a2', ts: at(9, 23), wasTs: at(8, 51) }];
    var res = planning.setupMismatchRows(timing, starts);

    assertEqual(res.ids, ['a1', 'a2'], 'сперва расхождения колонок, затем стартов — как считает детектор');
    assertEqual(res.byId['a1'].timing, [{ key: 'knife', label: 'наладка ножей', from: 30, to: 45 }],
        'у колонок видно ровно ту, что разошлась (совпавшие не шумят)');
    assertEqual([res.byId['a1'].timingChanged, res.byId['a1'].startChanged], [true, false],
        'расхождение тайминга не выдаёт себя за расхождение старта');
    assertEqual([res.byId['a2'].startChanged, res.byId['a2'].whenFrom, res.byId['a2'].whenTo],
        [true, '27.07 08:51', '27.07 09:23'], 'у старта — «было → стало» в формате очереди');

    assertEqual(planning.setupMismatchSummary(res.byId['a1']), 'наладка', 'бейдж расхождения колонок');
    assertEqual(planning.setupMismatchSummary(res.byId['a2']), 'старт', 'бейдж расхождения старта');
    assertEqual(planning.setupMismatchSummary(planning.setupMismatchRows(
        [{ cutId: 'x', knife: 45, material: 6, cutTime: 72, wasKnife: '30', wasMaterial: '6', wasCutTime: '72' }],
        [{ cutId: 'x', ts: at(9, 23), wasTs: at(8, 51) }]).byId['x']),
        'наладка · старт', 'разошлось и то и другое — сказано и то и другое');
    assertEqual(planning.setupMismatchSummary(null), '', 'нечего показывать — пустая подпись');

    assert(/наладка ножей 30 → 45 мин/.test(planning.setupMismatchTitle(res.byId['a1'])),
        'подсказка колонок — «было → стало» с единицами');
    assert(/старт 27\.07 08:51 → 27\.07 09:23/.test(planning.setupMismatchTitle(res.byId['a2'])),
        'подсказка старта — «было → стало»');
    assert(/Пересчитать наладку/.test(planning.setupMismatchTitle(res.byId['a2'])),
        'в подсказке сказано, чем это чинится');

    // Пустая колонка — честное «— → N» (её тоже перепишет пересчёт, и она тоже в счётчике).
    var empty = planning.setupMismatchRows(
        [{ cutId: 'e1', knife: 45, material: 0, cutTime: 72, wasKnife: '', wasMaterial: '', wasCutTime: '' }], []);
    assertEqual(empty.ids, ['e1'], 'пустые колонки — тоже расхождение');
    assert(/наладка ножей — → 45 мин/.test(planning.setupMismatchTitle(empty.byId['e1'])),
        'пустое хранимое подписано «—», а не нулём');

    assertEqual(planning.setupMismatchRows([], []), { rows: [], byId: {}, ids: [] },
        'пустой вход → пустой разбор');
})();

// ── 3) Карточка очереди: суть на бейдже, детали в подсказке ─────────────────
(function () {
    var cuts = [cutOf('a1', '101', at(8, 0)), cutOf('a2', '101', at(8, 51))];
    var c = makeController(cuts, FILTER);
    syncStoredTiming(c, cuts);                     // колонки актуальны, кривой только старт
    c.renderQueue();

    var marked = badgesOf(c.queueEl);
    assert(marked.length > 0, 'расхождение старта помечено на карточке');
    var a2 = marked.filter(function(x) { return x.cutId === 'a2'; })[0];
    assert(!!a2, 'помечено задание, у которого разъехался старт');
    assertEqual(a2 && a2.badge.textContent, 'старт', 'бейдж называет суть отклонения');
    assert(/→/.test((a2 && a2.badge.getAttribute('title')) || ''),
        'в подсказке бейджа — «было → стало»');

    // Расхождение колонок наладки — тот же бейдж, другая суть.
    var cuts2 = [cutOf('k1', '101', at(8, 0)), cutOf('k2', '101', at(11, 0))];
    var c2 = makeController(cuts2, FILTER);
    syncTimingAndStarts(c2, cuts2);
    cuts2[1].storedKnifeSetupMin = '999';
    c2._setupMismatchCache = null;
    c2.renderQueue();
    var k2 = badgesOf(c2.queueEl).filter(function(x) { return x.cutId === 'k2'; })[0];
    assert(!!k2, 'сдвинутая колонка наладки помечена на своей карточке');
    assert(/наладка/.test((k2 && k2.badge.textContent) || ''), 'бейдж говорит про наладку');
    assert(/999 →/.test((k2 && k2.badge.getAttribute('title')) || ''),
        'в подсказке видно прежнее значение колонки');
})();

// ── 4) Расхождений нет — очередь чистая ─────────────────────────────────────
(function () {
    var cuts = [cutOf('z1', '101', at(8, 0)), cutOf('z2', '101', at(11, 0))];
    var c = makeController(cuts, FILTER);
    syncTimingAndStarts(c, cuts);
    c.renderQueue();
    assertEqual(c.recalcMismatchIds('101'), [], 'детектор молчит');
    assertEqual(c.queueEl.querySelectorAll('.atex-pp-recalc-setup').length, 0, 'кнопки нет');
    assertEqual(badgesOf(c.queueEl).length, 0, 'и бейджей нет — карточки ничем не помечены');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
