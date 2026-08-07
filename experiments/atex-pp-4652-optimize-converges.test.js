// issue #4652 (из #4650): «УПОРЯДОЧИТЬ» СХОДИТСЯ — нажатия подряд не переворачивают план.
//
// Боевая ateh, 07.08.2026 19:20–19:22: четыре нажатия подряд, каждое отменяет предыдущее — 23
// прохода цепочки 4587 ходят между головой и хвостом (666705 58↔81, 669458 42↔19), и каждое
// нажатие пишет в базу два десятка записей. Плана, к которому кнопка сходится, не существует.
//
// Почему так выходило. Кандидат выигрывал сравнение по минутам УПАКОВЩИКА, а после выбора его
// правили ЕЩЁ ДВАЖДЫ: полировка порядка внутри дней (#4446) и сведение стартов встык (#4444).
// Записывался, стало быть, не тот план, который победил, — и следующее нажатие честно видело
// «этот план хуже» и откатывало его. Мерка обязана быть функцией ПЛАНА, а не того, откуда его
// прочитали: пока их две, один и тот же план оказывается лучше сам себя в обе стороны, и цикл
// не заканчивается никогда.
//
// Правило: предпросмотр показывается ТОЛЬКО если ИТОГОВЫЙ план (после полировки и сведения)
// СТРОГО лучше хранимого — обе стороны меряет один planObjective. Тогда каждое нажатие строго
// уменьшает объектив, а строго убывающая величина циклов не даёт.
//
// Run with: node experiments/atex-pp-4652-optimize-converges.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4446-preview-polish.test.js) ──
function StubNode(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {}; this.style = {};
    this._className = ''; this._text = ''; this._listeners = {}; this.value = ''; this.disabled = false; this.options = [];
    var self = this;
    this.classList = {
        add: function (c) { if (self._classes().indexOf(c) === -1) self._className = (self._className + ' ' + c).trim(); },
        remove: function (c) { self._className = self._classes().filter(function (x) { return x !== c; }).join(' '); },
        contains: function (c) { return self._classes().indexOf(c) !== -1; },
        toggle: function (c, on) { if (on) this.add(c); else this.remove(c); }
    };
}
StubNode.prototype._classes = function () { return this._className.split(/\s+/).filter(Boolean); };
Object.defineProperty(StubNode.prototype, 'className', { get: function () { return this._className; }, set: function (v) { this._className = String(v || ''); } });
Object.defineProperty(StubNode.prototype, 'textContent', {
    get: function () { if (this.childNodes.length) return this.childNodes.map(function (c) { return c.textContent; }).join(''); return this._text; },
    set: function (v) { this._text = String(v == null ? '' : v); this.childNodes = []; } });
Object.defineProperty(StubNode.prototype, 'innerHTML', { get: function () { return ''; }, set: function (v) { if (v === '') { this.childNodes = []; this._text = ''; } } });
Object.defineProperty(StubNode.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
StubNode.prototype.appendChild = function (n) { this.childNodes.push(n); n.parentNode = this; if (this.tagName === 'SELECT' && n.tagName === 'OPTION') this.options.push(n); return n; };
StubNode.prototype.removeChild = function (n) { this.childNodes = this.childNodes.filter(function (c) { return c !== n; }); return n; };
StubNode.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
StubNode.prototype.getAttribute = function (k) { return this.attributes[k] == null ? null : this.attributes[k]; };
StubNode.prototype.addEventListener = function () {};
StubNode.prototype.focus = function () {}; StubNode.prototype.setSelectionRange = function () {};
StubNode.prototype._all = function (acc) { this.childNodes.forEach(function (c) { if (c instanceof StubNode) { acc.push(c); c._all(acc); } }); return acc; };
StubNode.prototype.querySelectorAll = function (sel) { var cls = sel.replace(/^\./, ''); return this._all([]).filter(function (n) { return n.classList.contains(cls); }); };
StubNode.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };

global.document = {
    createElement: function (tag) { return new StubNode(tag); },
    createTextNode: function (t) { var n = new StubNode('#text'); n._text = String(t == null ? '' : t); return n; },
    body: new StubNode('body'), readyState: 'loading', getElementById: function () { return null; }, addEventListener: function () {}
};
global.window = { db: 'testdb' };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
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

function tsAt(hh, mm) { return Math.floor(new Date(2026, 6, 28, hh, mm, 0, 0).getTime() / 1000); }
function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cutOf(id, planTs, o) {
    o = o || {};
    var runs = o.runs || 6;
    return { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: '101', label: 'Станок 101' },
        materialName: o.mat, materialId: o.mat, winding: 'OUT', batchId: '',
        knifeWidths: widths(o.knives, Math.round(900 / o.knives)), knifeCount: o.knives, rollerWidth: 60,
        plannedRuns: runs, length: 300, duration: Math.ceil(runs * 1.2), status: '', startDate: '', endDate: '',
        firstPartId: String(id), settledFromId: '', leaders: [], sleeves: [],
        storedKnifeSetupMin: String(o.k == null ? 30 : o.k),
        storedMaterialWindingMin: String(o.m == null ? 15 : o.m),
        storedCutAndLeaderMin: String(Math.ceil(runs * 1.2) + 2 * runs) };
}
function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.root = root;
    c.planBarEl = new StubNode('div'); c.formEl = new StubNode('div');
    c.queueEl = new StubNode('div'); c.linkEl = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-28', dateTo: '2026-07-29', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 101' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = []; c.supplies = []; c.genBatches = [];
    c.opTimes = { WIND_300: 1.2 };
    c.changeTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
    c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
        LUNCH_START: '12:20', LUNCH_DURATION: '40', MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
    c.prevSetupBySlitter = {};
    c.downtimesBySlitter = {}; c.calendarByDay = {}; c.freezeByDay = {};
    c.meta.cut = { id: '1078', reqs: [
        { id: '9001', val: 'Наладка ножей, мин' },
        { id: '9002', val: 'Сырье/намотка, мин' },
        { id: '9003', val: 'Резка и Лидер' },
        { id: '9004', val: 'Длительность, минут' }
    ] };
    c.notices = [];
    c.notify = function (msg, kind) { c.notices.push(kind + ': ' + msg); };
    c.renderLink = function () {};
    return c;
}
function identityOps(cuts) {
    return { updates: cuts.map(function (x) {
        return { cutId: String(x.id), planStartTs: Number(x.planDate), plannedRuns: x.plannedRuns };
    }), creates: [], deletes: [] };
}

// ── 1) План, который НЕ лучше хранимого, до предпросмотра не доходит ──────────────────────────
// Порядок дня уже лучший (ножи 15 → 15 → 8), полировке брать нечего, ops повторяют хранимое.
// Такой «пересчёт» раньше показывался как готовое предложение, и «Применить» писал в базу
// десятки записей, ничего не улучшая, — с этого и начинался цикл нажатий.
(function () {
    var cuts = [
        cutOf('d1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('d2', tsAt(9, 0), { knives: 15, mat: 'MR194', runs: 8, k: 0, m: 15 }),
        cutOf('d3', tsAt(10, 0), { knives: 8, mat: 'MWR200', runs: 6, k: 30, m: 15 })
    ];
    var c = makeController(cuts);
    var objBefore = c.planObjective(cuts, null);
    var shown = c.startPlanPreview({ ops: identityOps(cuts), reassign: null, tailSetup: {}, slitterChange: false,
        objectiveBefore: objBefore.value,
        coBefore: objBefore.co, coAfter: objBefore.co, lateBefore: objBefore.late, lateAfter: objBefore.late,
        underfilledBefore: objBefore.uf, underfilledAfter: objBefore.uf });

    assertEqual(shown, false, '#4652 предпросмотр НЕ показан — итоговый план не лучше хранимого');
    assertEqual(c._pendingPlan, null, 'к записи ничего не отложено (нечего применять)');
    assertEqual(c.cuts, cuts, 'очередь на экране осталась ХРАНИМОЙ (проекция откачена)');
    assert(c.notices.some(function (n) { return /оптимальна/.test(n); }),
        'оператору сказано, что очередь уже оптимальна', '(' + c.notices.join(' | ') + ')');
})();

// ── 2) План, который РЕАЛЬНО лучше, показывается как прежде ───────────────────────────────────
// Ножи 15 → 8 → 15: полировка (#4446) собирает одинаковые ножи в блок и снимает лишнюю смену.
(function () {
    var cuts = [
        cutOf('c1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('c2', tsAt(9, 0), { knives: 8, mat: 'MR194', runs: 6, k: 30, m: 15 }),
        cutOf('c3', tsAt(10, 0), { knives: 15, mat: 'MWR200', runs: 8, k: 30, m: 15 })
    ];
    var c = makeController(cuts);
    var objBefore = c.planObjective(cuts, null);
    var shown = c.startPlanPreview({ ops: identityOps(cuts), reassign: null, tailSetup: {}, slitterChange: false,
        objectiveBefore: objBefore.value,
        coBefore: objBefore.co, coAfter: objBefore.co, lateBefore: objBefore.late, lateAfter: objBefore.late,
        underfilledBefore: objBefore.uf, underfilledAfter: objBefore.uf });

    assertEqual(shown, true, 'план дешевле по переналадке — предпросмотр показан');
    assert(!!c._pendingPlan, 'план отложен до «Применить»');
    var objAfter = c.planObjective(c.cuts, null);
    assert(objAfter.value < objBefore.value,
        '#4652 показанный план СТРОГО лучше хранимого ТОЙ ЖЕ меркой: '
        + objBefore.value + ' → ' + objAfter.value);
    assert(objAfter.co < objBefore.co, 'выигрыш — в минутах переналадки: '
        + objBefore.co + ' → ' + objAfter.co);
})();

// ── 3) Показанное лучше — значит следующий прогон на нём уже ничего не найдёт ────────────────
// Мерка тикета: два прогона подряд на одном состоянии — второй обязан вернуть «уже оптимальна» и
// НЕ писать в базу. Берём план, который первый прогон показал, объявляем его хранимым (как после
// «Применить») и прогоняем то же самое ещё раз.
(function () {
    var cuts = [
        cutOf('e1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('e2', tsAt(9, 0), { knives: 8, mat: 'MR194', runs: 6, k: 30, m: 15 }),
        cutOf('e3', tsAt(10, 0), { knives: 15, mat: 'MWR200', runs: 8, k: 30, m: 15 })
    ];
    var first = makeController(cuts);
    var obj1 = first.planObjective(cuts, null);
    first.startPlanPreview({ ops: identityOps(cuts), reassign: null, tailSetup: {}, slitterChange: false,
        objectiveBefore: obj1.value, coBefore: obj1.co, coAfter: obj1.co,
        lateBefore: obj1.late, lateAfter: obj1.late, underfilledBefore: obj1.uf, underfilledAfter: obj1.uf });
    assert(!!first._pendingPlan, 'первый прогон: план показан');

    // «Применить»: показанное становится хранимым.
    var stored = first.cuts.slice();
    var second = makeController(stored);
    var obj2 = second.planObjective(stored, null);
    var shown2 = second.startPlanPreview({ ops: identityOps(stored), reassign: null, tailSetup: {}, slitterChange: false,
        objectiveBefore: obj2.value, coBefore: obj2.co, coAfter: obj2.co,
        lateBefore: obj2.late, lateAfter: obj2.late, underfilledBefore: obj2.uf, underfilledAfter: obj2.uf });

    assertEqual(shown2, false, '#4652 ВТОРОЙ прогон подряд ничего не предлагает');
    assertEqual(second._pendingPlan, null, 'второй прогон не откладывает записей — в базу не пойдёт ничего');
    assert(obj2.value < obj1.value, 'объектив строго убыл за первый прогон и на втором стоит на месте: '
        + obj1.value + ' → ' + obj2.value);
})();

// ── 4) planObjective — одна мерка на оба плана (кандидат и хранимый) ──────────────────────────
(function () {
    var cuts = [
        cutOf('f1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('f2', tsAt(9, 0), { knives: 8, mat: 'MR194', runs: 6, k: 30, m: 15 })
    ];
    var c = makeController(cuts);
    var stored = c.planObjective(cuts, null);
    var sameByOps = c.planObjective(cuts, identityOps(cuts));
    assertEqual([stored.late, stored.uf, stored.dt], [sameByOps.late, sameByOps.uf, sameByOps.dt],
        '#4652 один и тот же план меряется одинаково — из хранимых колонок и из операций');
    assert(stored.value >= 0 && isFinite(stored.value), 'объектив — число (лексикографическая свёртка)');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
