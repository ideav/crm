// Tests for ideav/crm#4446 — «Левый план — предлагаемый — хуже правого, его я делал вручную. Почему?»
//
// «Упорядочить» выбирает кандидата по объективу за ВЕСЬ горизонт. Кандидат может выиграть в сумме и
// при этом оставить внутри ОТДЕЛЬНОГО дня заведомо худший порядок — а оператор сравнивает свой
// ручной план с предложенным по одному дню и видит, что предложенный хуже (на стенде: тот же набор
// шести заданий 28.07, ручной порядок — 150 мин наладки, предложенный — 165).
//
// Теперь ВЫБРАННЫЙ кандидат перед показом полируется тем же локальным проходом, что и кандидат C
// (#4440, resequenceWithinDays): состав дня, его номер и станок не меняются — меняется только
// порядок внутри дня, поэтому ни сроки, ни загрузка дней не страдают, а переналадка может только
// уменьшиться. Показанное и записываемое при этом совпадают (#4444).
//
// Run with: node experiments/atex-4446-preview-polish.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4402-optimize-preview.test.js) ──
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
var P = api.planning;

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

function tsAt(hh, mm) { return Math.floor(new Date(2026, 6, 28, hh, mm, 0, 0).getTime() / 1000); }
function hhmm(tsSec) { var d = new Date(Number(tsSec) * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function widths(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }

// Задание: knives — число ножей (оно же ширина полосы), mat — сырьё.
function cutOf(id, planTs, o) {
    o = o || {};
    var runs = o.runs || 6;
    return { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: '101', label: 'Станок 101' },
        materialName: o.mat, materialId: o.mat, winding: 'OUT', batchId: '',
        knifeWidths: widths(o.knives, Math.round(900 / o.knives)), knifeCount: o.knives, rollerWidth: 60,
        plannedRuns: runs, length: 300, duration: Math.ceil(runs * 1.2), status: '', startDate: '', endDate: '',
        leaders: [], sleeves: [],
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
// Реальные минуты наладки очереди станка: первая резка ставит ножи и сырьё с нуля, дальше —
// переход к переходу (та же математика, что у движка).
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
function setupMinutes(list) {
    if (!list.length) return 0;
    var t = P.firstSetupCost(list[0], TIMES), prev = list[0];
    for (var i = 1; i < list.length; i++) { t += P.changeoverCost(prev, list[i], TIMES); prev = list[i]; }
    return t;
}
function dayOrder(c) {
    return c.cuts.slice().sort(function (a, b) { return Number(a.planDate) - Number(b.planDate); });
}

// ── 1) Кандидат с заведомо худшим порядком дня полируется перед показом ────────────────────────
(function () {
    // Ножи 15 → 8 → 15: две смены ножей там, где хватает одной (15, 15, 8).
    var cuts = [
        cutOf('c1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('c2', tsAt(9, 0), { knives: 8, mat: 'MR194', runs: 6, k: 30, m: 15 }),
        cutOf('c3', tsAt(10, 0), { knives: 15, mat: 'MWR200', runs: 8, k: 30, m: 15 })
    ];
    var c = makeController(cuts);
    var before = setupMinutes(cuts);
    assertEqual(before, 135, 'исходный день (15 → 8 → 15): 135 минут наладки — две смены ножей');

    var ops = { updates: cuts.map(function (x) {
        return { cutId: String(x.id), planStartTs: Number(x.planDate), plannedRuns: x.plannedRuns };
    }), creates: [], deletes: [] };
    c.startPlanPreview({ ops: ops, reassign: null, tailSetup: {}, slitterChange: false,
        coBefore: 105, coAfter: 105, lateBefore: 0, lateAfter: 0 });

    var shown = dayOrder(c);
    var after = setupMinutes(shown);
    assert(after < before, '#4446: показанный план дешевле по наладке: ' + before + ' → ' + after + ' мин');
    assertEqual(shown.map(function (x) { return x.knifeCount; }), [15, 15, 8],
        '#4446: одинаковые наборы ножей собраны в блок — ' + shown.map(function (x) { return x.knifeCount; }).join('→'));

    // День у всех тот же — полировка порядок меняет, дни нет.
    var dayOf = function (ts) { return Math.floor((Number(ts) * 1000 - new Date(2026, 6, 28, 0, 0, 0, 0).getTime()) / 86400000); };
    assert(shown.every(function (x) { return dayOf(x.planDate) === 0; }), '#4446: ни одно задание не сменило день');

    // Показанное = записываемое.
    var byId = {}; ops.updates.forEach(function (u) { byId[String(u.cutId)] = Number(u.planStartTs); });
    shown.forEach(function (x) {
        assertEqual(hhmm(byId[String(x.id)]), hhmm(x.planDate),
            '#4446: в ops у ' + x.id + ' то же время, что на карточке');
    });
})();

// ── 2) Хороший порядок дня полировка не портит ─────────────────────────────────────────────────
(function () {
    var cuts = [
        cutOf('d1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('d2', tsAt(9, 0), { knives: 15, mat: 'MR194', runs: 8, k: 0, m: 15 }),
        cutOf('d3', tsAt(10, 0), { knives: 8, mat: 'MWR200', runs: 6, k: 30, m: 15 })
    ];
    var c = makeController(cuts);
    var ops = { updates: cuts.map(function (x) {
        return { cutId: String(x.id), planStartTs: Number(x.planDate), plannedRuns: x.plannedRuns };
    }), creates: [], deletes: [] };
    c.startPlanPreview({ ops: ops, reassign: null, tailSetup: {}, slitterChange: false,
        coBefore: 75, coAfter: 75, lateBefore: 0, lateAfter: 0 });

    var shown = dayOrder(c);
    assertEqual(shown.map(function (x) { return String(x.id); }), ['d1', 'd2', 'd3'],
        '#4446: уже оптимальный порядок дня остался прежним');
    assertEqual(setupMinutes(shown), 105, '#4446: наладка не выросла (45 с нуля + 15 + 45)');
})();

// ── 3) Сам локальный проход не трогает дни и станки (контроль инварианта) ─────────────────────
(function () {
    var cuts = [
        cutOf('e1', tsAt(8, 0), { knives: 15, mat: 'MW411', runs: 10, k: 0, m: 15 }),
        cutOf('e2', tsAt(9, 0), { knives: 8, mat: 'MR194', runs: 6, k: 30, m: 15 }),
        cutOf('e3', tsAt(10, 0), { knives: 15, mat: 'MWR200', runs: 8, k: 30, m: 15 })
    ];
    var c = makeController(cuts);
    var byId = {}; cuts.forEach(function (x) { byId[String(x.id)] = x; });
    var res = Controller.prototype.intraDayImprovementOps.call(c);
    assert(res.updates.length > 0, '#4446: локальный проход нашёл улучшение');
    assert(res.gainMin > 0, '#4446: выигрыш в реальных минутах: ' + res.gainMin);
    var moved = res.updates.filter(function (u) {
        var was = new Date(Number(byId[String(u.cutId)].planDate) * 1000);
        var now = new Date(Number(u.planStartTs) * 1000);
        return was.getDate() !== now.getDate();
    });
    assertEqual(moved.length, 0, '#4446: перестановка не выносит задания в другой день');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
