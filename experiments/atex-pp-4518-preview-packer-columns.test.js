// #4518 (сквозной) — ПРЕДПРОСМОТР «УПОРЯДОЧИТЬ» НЕ ПЕРЕСЧИТЫВАЕТ ПЛАН УПАКОВЩИКА.
//
// СИМПТОМ (issue #4518, боевой лог ?118.95): «Упорядочить» показал десяток правок на 2–8 минут
// внутри одного дня («только время старта»), которых упаковщик не делал, и лог кнопки писал ДРУГИЕ
// времена, чем список «Деталей»:
//     [pp] ⚠️ #4444: план упаковщика разошёлся с хранимой наладкой … Заданий: 16.
//     [pp-opt] ПЕРЕМЕЩЕНИЯ: 23 …  649125: 09:08 → 09:12    (в «Деталях»: 09:08 → 09:10)
//     [pp] ⚙️ #4402 предпросмотр: переставлено 23           (в «Деталях» строк 21)
//
// ПРИЧИНА. Колонки наладки предпросмотра считались ЗАНОВО (`computeCutSetupUpdates` без planCols) —
// вторым расчётом поверх плана упаковщика. У разбитых по дням заданий и наладочных хвостов этот
// расчёт с раскладкой расходится (#4499), день выходил «несведённым», #4444 переписывал старты.
// «Применить» при этом пишет колонки УПАКОВЩИКА — показанное и записываемое считались по-разному.
//
// ПРАВИЛО (#4499): сумма минут дня и старты — ОДНА арифметика, её делает упаковщик.
//
// Сцена: '11' — продолжение вчерашней цепочки, наладка оплачена ВЧЕРА, и упаковщик ставит ему
// knife 0 / material 0. Самостоятельный пересчёт этого не знает и насчитывает первой резке дня
// полную настройку «с нуля» (30 + 15) — эти 45 минут и разъезжали день, рождая правки «на N минут»
// у всех, кто стои́т следом.
//
// Run with: node experiments/atex-pp-4518-preview-packer-columns.test.js

process.env.TZ = 'Europe/Moscow';

// ── Минимальный DOM-стаб (как в atex-4444-preview-stitched.test.js) ──
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
var P_planChangeRest = api.planning.planChangeRest;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

function tsAt(hh, mm) { return Math.floor(new Date(2026, 6, 28, hh, mm, 0, 0).getTime() / 1000); }
function hhmm(tsSec) { var d = new Date(Number(tsSec) * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

function cutOf(id, planTs, o) {
    o = o || {};
    return { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: '101', label: 'Станок 101' },
        materialName: o.mat || 'MW308', materialId: o.matId || '500', winding: o.wind || 'OUT',
        knifeWidths: o.kw || [110], knifeCount: (o.kw || [110]).length, plannedRuns: o.runs || 6, length: 300,
        duration: o.cut == null ? 40 : o.cut, status: '', startDate: '', endDate: '',
        leaders: [], sleeves: [],
        storedKnifeSetupMin: String(o.k == null ? 0 : o.k),
        storedMaterialWindingMin: String(o.m == null ? 15 : o.m),
        storedCutAndLeaderMin: String(o.cut == null ? 40 : o.cut) };
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

// План упаковщика: старты встык по ЕГО же колонкам (planCols). Конфигурация у всех трёх одна
// (одно сырьё, одни ножи), поэтому переставлять внутри дня нечего — полировка #4446 в сцену не лезет.
function scene() {
    var cuts = [
        cutOf('11', tsAt(8, 0), { k: 0, m: 0, cut: 40, runs: 3 }),     // 40 мин — продолжение вчерашнего
        cutOf('12', tsAt(8, 40), { k: 0, m: 0, cut: 60, runs: 20 }),   // 60 мин
        cutOf('13', tsAt(9, 40), { k: 0, m: 0, cut: 50, runs: 12 })    // 50 мин
    ];
    var ops = { updates: [
        { cutId: '11', planStartTs: tsAt(8, 0), plannedRuns: 3, planCols: { knife: 0, material: 0, cutTime: 40 } },
        { cutId: '12', planStartTs: tsAt(8, 40), plannedRuns: 20, planCols: { knife: 0, material: 0, cutTime: 60 } },
        { cutId: '13', planStartTs: tsAt(9, 40), plannedRuns: 12, planCols: { knife: 0, material: 0, cutTime: 50 } }
    ], creates: [], deletes: [] };
    return { cuts: cuts, ops: ops };
}
function preview(c, s, trace) {
    return c.startPlanPreview({ ops: s.ops, reassign: null, tailSetup: {}, slitterChange: false, trace: trace,
        coBefore: 100, coAfter: 90, lateBefore: 0, lateAfter: 0 });
}

// ── 1. Старты упаковщика предпросмотр не трогает ─────────────────────────────────────────────
(function () {
    var s = scene();
    var c = makeController(s.cuts);
    preview(c, s);
    var shown = c.cuts.slice().sort(function (a, b) { return Number(a.planDate) - Number(b.planDate); });
    var starts = shown.map(function (x) { return hhmm(x.planDate); });
    assert(starts.join(' ') === '08:00 08:40 09:40',
        '1.1 предпросмотр показывает РОВНО старты упаковщика — ни одной правки «на N минут»',
        '(' + starts.join(' ') + ')');
    var byId = {}; s.ops.updates.forEach(function (u) { byId[String(u.cutId)] = Number(u.planStartTs); });
    assert(hhmm(byId['12']) === '08:40' && hhmm(byId['13']) === '09:40',
        '1.2 «Применить» запишет те же старты — ops сведением не переписаны',
        '(12 ' + hhmm(byId['12']) + ', 13 ' + hhmm(byId['13']) + ')');
    assert(Number(c._pendingPlan.movedCount) === 0,
        '1.3 переставлять нечего: план совпал с очередью, счётчик не выдумывает изменений',
        '(movedCount ' + c._pendingPlan.movedCount + ')');
})();

// ── 2. Колонки предпросмотра = колонки упаковщика ────────────────────────────────────────────
(function () {
    var s = scene();
    var c = makeController(s.cuts);
    preview(c, s);
    var first = c.cuts.filter(function (x) { return String(x.id) === '11'; })[0];
    assert(Math.round(Number(first.storedKnifeSetupMin)) === 0 && Math.round(Number(first.storedMaterialWindingMin)) === 0,
        '2.1 у продолжения цепочки настройка осталась нулевой — как посчитал упаковщик',
        '(ножи ' + first.storedKnifeSetupMin + ', сырьё ' + first.storedMaterialWindingMin + ')');
    var occ = c.cuts.slice().sort(function (a, b) { return Number(a.planDate) - Number(b.planDate); })
        .map(function (x) {
            return Math.round(Number(x.storedKnifeSetupMin)) + Math.round(Number(x.storedMaterialWindingMin))
                 + Math.round(Number(x.storedCutAndLeaderMin));
        });
    assert(occ.join(' ') === '40 60 50', '2.2 занятость дня — числа упаковщика', '(' + occ.join(' ') + ')');
})();

// ── 3. Счётчик панели = числу строк «Деталей» ────────────────────────────────────────────────
(function () {
    var s = scene();
    s.cuts[2].planDate = String(tsAt(10, 10));   // сейчас '13' стои́т позже; упаковщик подтягивает его встык
    s.cuts[2].number = s.cuts[2].planDate;
    var c = makeController(s.cuts);
    preview(c, s);
    var pend = c._pendingPlan;
    var movedRows = (pend.changes.rows || []).filter(function (r) { return r.kind === 'moved'; });
    assert(pend.movedCount === movedRows.length,
        '3.1 «переставлено N» панели = числу строк списка (одно число на всех)',
        '(панель ' + pend.movedCount + ', строк ' + movedRows.length + ')');
    assert(movedRows.length === 1 && movedRows[0].cutId === '13',
        '3.2 переставлено ровно то, что двигал упаковщик',
        '(' + movedRows.map(function (r) { return r.cutId; }) + ')');
    assert(movedRows[0].whenFrom === '28.07 10:10' && movedRows[0].whenTo === '28.07 09:40',
        '3.3 в списке — время упаковщика, а не пересчитанное заново',
        '(' + movedRows[0].whenFrom + ' → ' + movedRows[0].whenTo + ')');
    assert(P_planChangeRest(movedRows[0]) === 'только время старта',
        '3.4 подпись строки — про время старта (день тот же)', '(' + P_planChangeRest(movedRows[0]) + ')');
})();

// ── 4. Трасса «Упорядочить» и список «Деталей» — один и тот же план ──────────────────────────
(function () {
    var s = scene();
    s.cuts[2].planDate = String(tsAt(10, 10));
    s.cuts[2].number = s.cuts[2].planDate;
    var c = makeController(s.cuts);
    var trace = { start: null, candidates: [], choice: null, moves: [], movesTotal: 0,
                  creates: [], createsTotal: 0, deletes: [], deletesTotal: 0, result: null, stop: null };
    preview(c, s, trace);
    var pend = c._pendingPlan;
    var movedRows = (pend.changes.rows || []).filter(function (r) { return r.kind === 'moved'; });
    assert(trace.movesTotal === movedRows.length,
        '4.1 в трассе столько же перемещений, сколько в «Деталях»',
        '(трасса ' + trace.movesTotal + ', «Детали» ' + movedRows.length + ')');
    var m = (trace.moves || [])[0] || {};
    assert(m.cutId === movedRows[0].cutId && m.whenTo === movedRows[0].whenTo && m.whenFrom === movedRows[0].whenFrom,
        '4.2 и то же задание с теми же «было → стало»',
        '(трасса ' + m.cutId + ' ' + m.whenFrom + ' → ' + m.whenTo
        + '; «Детали» ' + movedRows[0].cutId + ' ' + movedRows[0].whenFrom + ' → ' + movedRows[0].whenTo + ')');
})();

console.log('\n' + passed + '/' + total + ' passed');
