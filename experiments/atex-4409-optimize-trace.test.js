// Tests for ideav/crm#4409 — «Упорядочить»: после подтверждения появлялось ПУСТОЕ БЕЛОЕ ОКНО
// справа внизу и «ничего не происходило».
// Причина: тост вида 'warning' («Просрочка не устранена…», #4211) не имел ФОНА в
// production-planning.css, а текст тоста белый (.atex-pp-toast color:#fff) → сообщение было
// невидимым; сам алгоритм честно решил «план не трогаем».
// Покрываем:
//   1) чистую formatOptimizeTrace: разделы СТАРТ → КАНДИДАТЫ → ВЫБОР → ПЕРЕМЕЩЕНИЯ → РЕЗУЛЬТАТ →
//      СТОП, лексикографический вердикт кандидата (срок старше переналадки), «…и ещё N» вместо
//      молчаливого обрезания списка;
//   2) fillOptimizeMovesTrace: перемещения считаются от ТЕКУЩЕЙ очереди (станок/время до → после),
//      апдейт-родитель разбиения без сдвига в перемещения не попадает;
//   3) runOptimizeQueue печатает трассу на ВСЕХ выходах: «план не трогаем» (с просрочкой) и
//      предпросмотр; в трассе есть и СТАРТ, и СТОП;
//   4) невидимый тост: notify(..., 'warning') ставит класс atex-pp-toast-warning, и КАЖДЫЙ вид
//      тоста, которым пользуется контроллер, имеет правило с фоном в production-planning.css.
//
// Run with: node experiments/atex-4409-optimize-trace.test.js

process.env.TZ = 'UTC';

var fs = require('fs');
var path = require('path');

// ── Минимальный DOM-стаб (как в experiments/atex-4402-optimize-preview.test.js) ──
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
globalThis.PP_TRACE_OPTIMIZE = true;      // трассировка «Упорядочить» в Node включается явным форсом
globalThis.PP_TRACE_PLACEMENT = false;    // трасса слоя размещения здесь не нужна — не шумим

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
function hasLine(lines, re) { return lines.filter(function(l) { return re.test(l); }).length > 0; }
function lineOf(lines, re) { return lines.filter(function(l) { return re.test(l); })[0] || ''; }

// Перехват консоли: собираем только строки канала [pp-opt].
function captureTrace(fn) {
    var lines = [], orig = console.log;
    console.log = function() {
        var args = [].slice.call(arguments);
        if (String(args[0]) === '[pp-opt]') { lines.push(args.slice(1).join(' ')); return; }
        orig.apply(console, args);
    };
    try { return { lines: lines, value: fn(lines) }; } finally { console.log = orig; }
}

function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
var DAY1 = tsAt(2026, 7, 27, 8, 0);
var DAY2 = tsAt(2026, 7, 28, 8, 0);

// ── 1) Чистая formatOptimizeTrace ────────────────────────────────────────────
(function () {
    var trace = {
        start: { cutCount: 42, fixedCount: 7, slitterCount: 4, windowLabel: '24.07.2026 – 09.08.2026',
            lateBefore: 5, coBefore: 915 },
        candidates: [
            { key: 'B', title: 'порядок/дни на текущих станках', late: 6, changeover: 640 },
            { key: 'A', title: 'со сменой станка', reassignCount: 3, late: 5, changeover: 700 }
        ],
        choice: { action: 'A', title: 'со сменой станка' },
        moves: [{ cutId: '640990', slitterFrom: 'Станок 1', slitterTo: 'Станок 2', whenFrom: '24.07 08:00', whenTo: '25.07 10:30' },
                { cutId: '641786', slitterFrom: 'Станок 1', slitterTo: 'Станок 1', whenFrom: '24.07 09:20', whenTo: '24.07 11:05' }],
        movesTotal: 12,
        creates: [{ parentCutId: '641786', when: '25.07 08:00', runs: 3 }], createsTotal: 1,
        deletes: ['641788'], deletesTotal: 1,
        result: {
            before: { changeoverCount: 48, changeoverMin: 915, knifeCount: 13, knifeMin: 390, materialCount: 35, materialMin: 525, overdue: 5 },
            after: { changeoverCount: 33, changeoverMin: 640, knifeCount: 9, knifeMin: 270, materialCount: 24, materialMin: 370, overdue: 4 }
        },
        stop: { code: 'preview', text: 'предпросмотр показан — в БД НЕ записано, ждём «Применить» / «Отменить»' }
    };
    var lines = planning.formatOptimizeTrace(trace);

    assert(hasLine(lines, /^СТАРТ: заданий 42 \(зафиксировано 7\), станков 4, окно 24\.07\.2026 – 09\.08\.2026$/),
        'СТАРТ: сколько заданий/фикс/станков и за какое окно');
    assert(hasLine(lines, /текущий план: опозданий 5 дн, переналадка 915 мин/), 'СТАРТ: показатели текущего плана');
    assert(/ХУЖЕ: опозданий \+1 дн \(срок старше переналадки\)/.test(lineOf(lines, /^КАНДИДАТ B/)),
        'кандидат B хуже: опозданий больше, хотя переналадка меньше (лексикографика §14)');
    assert(/переназначений станка 3/.test(lineOf(lines, /^КАНДИДАТ A/))
        && /ЛУЧШЕ: опоздания те же, переналадка -215 мин/.test(lineOf(lines, /^КАНДИДАТ A/)),
        'кандидат A: опоздания те же, переналадка меньше → ЛУЧШЕ');
    assert(hasLine(lines, /^ВЫБОР: A — со сменой станка$/), 'ВЫБОР назван');
    assert(hasLine(lines, /^ПЕРЕМЕЩЕНИЯ: 12$/), 'ПЕРЕМЕЩЕНИЯ: сколько всего');
    assert(hasLine(lines, /^ {2}640990: 24\.07 08:00 → 25\.07 10:30 · станок Станок 1 → Станок 2$/),
        'перемещение со сменой станка: время и станок до → после');
    assert(hasLine(lines, /^ {2}641786: 24\.07 09:20 → 24\.07 11:05 \(станок тот же: Станок 1\)$/),
        'перемещение внутри станка помечено «станок тот же»');
    assert(hasLine(lines, /^ {2}…и ещё 10 — поимённо показаны первые 2$/),
        'остаток списка НЕ замалчивается — сказано, сколько не показано');
    assert(hasLine(lines, /^НОВЫЕ СЕГМЕНТЫ \(появятся по «Применить»\): 1$/) && hasLine(lines, /от 641786: 25\.07 08:00, проходов 3/),
        'новые сегменты дробления перечислены');
    assert(hasLine(lines, /^УДАЛЯЕТСЯ ЗАПИСЕЙ: 1 — 641788$/), 'удаляемые записи перечислены');
    assert(hasLine(lines, /переналадки: 48 \(915 мин\) → 33 \(640 мин\)/) && hasLine(lines, /просрочено заданий: 5 → 4/),
        'РЕЗУЛЬТАТ: цифры панели «Качество плана» до и после');
    assert(hasLine(lines, /^СТОП: предпросмотр показан/), 'СТОП: чем кончилось');
    assertEqual(lines[0], '═══ УПОРЯДОЧИТЬ (#4409) ═══', 'блок открывается заголовком');
    assert(/^СТОП: /.test(lines[lines.length - 1]), 'блок закрывается строкой СТОП');
})();

// Вердикты кандидата и «ничего не выбрали».
(function () {
    var base = { start: { cutCount: 1, fixedCount: 0, slitterCount: 1, windowLabel: 'весь горизонт', lateBefore: 2, coBefore: 100 },
        choice: { action: 'none' }, stop: { code: 'none-overdue', text: 'план НЕ изменён — просрочка не устранена' } };
    function verdictOf(cand) {
        var t = JSON.parse(JSON.stringify(base));
        t.candidates = [cand];
        return lineOf(planning.formatOptimizeTrace(t), /^КАНДИДАТ/);
    }
    assert(/ЛУЧШЕ: опозданий -1 дн/.test(verdictOf({ key: 'B', title: 'x', late: 1, changeover: 900 })),
        'меньше опозданий — ЛУЧШЕ, даже если переналадка выросла');
    assert(/РАВНО текущему/.test(verdictOf({ key: 'B', title: 'x', late: 2, changeover: 100 })), 'те же числа — РАВНО');
    assert(/ХУЖЕ: опоздания те же, переналадка \+20 мин/.test(verdictOf({ key: 'B', title: 'x', late: 2, changeover: 120 })),
        'опоздания те же, переналадка выросла — ХУЖЕ');
    assert(/не считался — переназначения станков нет/.test(verdictOf({ key: 'A', title: 'x', skipped: 'переназначения станков нет (computeReassignmentPlan)' })),
        'непосчитанный кандидат прямо помечен, а не пропущен молча');
    var lines = planning.formatOptimizeTrace(base);
    assert(hasLine(lines, /^ВЫБОР: НЕТ — ни один кандидат не лучше текущего, план НЕ трогаем$/),
        'ВЫБОР: НЕТ — прямо сказано, что план не трогаем');
    assert(!hasLine(lines, /^ПЕРЕМЕЩЕНИЯ/), 'без перемещений раздела нет');
})();

// ── 2) Контроллер: перемещения считаются от текущей очереди ──────────────────
function cutOf(id, planTs, slitterId) {
    return { id: id, number: String(planTs), planDate: String(planTs),
        slitter: { id: slitterId, label: 'Станок ' + slitterId },
        materialName: 'MW308', materialId: '500', winding: 'OUT', knifeWidths: [110], knifeCount: 1,
        plannedRuns: 6, length: 1000, duration: 60, status: '', startDate: '', endDate: '',
        leaders: [], sleeves: [], storedKnifeSetupMin: '30', storedMaterialWindingMin: '15', storedCutAndLeaderMin: '72' };
}
function makeController(cuts) {
    var root = new StubNode('div'); root.attributes['data-db'] = 'testdb';
    var c = new Controller(root);
    c.root = root;
    c.planBarEl = new StubNode('div');
    c.formEl = new StubNode('div');
    c.queueEl = new StubNode('div');
    c.linkEl = new StubNode('div');
    c.toastHost = new StubNode('div');
    c.filter = { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-28', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 101' }, { id: '202', label: 'Станок 202' }];
    c.activeSlitter = '101';
    c.cuts = cuts;
    c.positions = []; c.genPositions = []; c.supplies = []; c.genBatches = [];
    c.opTimes = {}; c.changeTimes = {}; c.footageBySupply = {}; c.consumptionByCut = {};
    c.jumboWidthByMaterial = {}; c.nominalWidthByMaterial = {}; c.actualWidthIndex = null;
    c.daySettings = {}; c.prevSetupBySlitter = {};
    c.renderLink = function() {};
    return c;
}

(function () {
    var c = makeController([cutOf('11', DAY1, '101'), cutOf('12', DAY1, '101'), cutOf('13', DAY1, '101')]);
    var trace = { moves: [], movesTotal: 0, creates: [], createsTotal: 0, deletes: [], deletesTotal: 0 };
    c.fillOptimizeMovesTrace(trace, {
        updates: [
            { cutId: '11', planStartTs: DAY2, plannedRuns: 4 },              // уехало на другой день
            { cutId: '12', planStartTs: DAY1, plannedRuns: 6, slitterId: '202' },  // тот же час, другой станок
            { cutId: '13', planStartTs: DAY1, plannedRuns: 2 }               // родитель разбиения: не двигается
        ],
        creates: [{ parentCutId: '13', planStartTs: DAY2, plannedRuns: 4 }],
        deletes: ['77']
    }, null);

    assertEqual(trace.movesTotal, 2, 'в перемещения попали только реально сдвинувшиеся (родитель разбиения — нет)');
    assertEqual(trace.moves.map(function(m) { return m.cutId; }), ['11', '12'], 'перечислены переставленные задания');
    assertEqual([trace.moves[0].whenFrom, trace.moves[0].whenTo], ['27.07 08:00', '28.07 08:00'], 'время до → после');
    assertEqual([trace.moves[1].slitterFrom, trace.moves[1].slitterTo], ['Станок 101', 'Станок 202'],
        'смена станка видна по подписи из справочника');
    assertEqual([trace.createsTotal, trace.creates[0].parentCutId, trace.creates[0].when, trace.creates[0].runs],
        [1, '13', '28.07 08:00', 4], 'новый сегмент: от какой головы, когда, сколько проходов');
    assertEqual([trace.deletesTotal, trace.deletes], [1, ['77']], 'удаляемые записи посчитаны');

    // Кандидат A: станок берётся из карты переназначения, даже если в апдейте его нет.
    var t2 = { moves: [], movesTotal: 0, creates: [], createsTotal: 0, deletes: [], deletesTotal: 0 };
    c.fillOptimizeMovesTrace(t2, { updates: [{ cutId: '11', planStartTs: DAY1, plannedRuns: 6 }], creates: [], deletes: [] },
        { '11': '202' });
    assertEqual([t2.movesTotal, t2.moves[0].slitterFrom, t2.moves[0].slitterTo], [1, 'Станок 101', 'Станок 202'],
        'переназначение станка (кандидат A) попадает в перемещения без смены времени');
})();

// ── 3) runOptimizeQueue печатает трассу на ВСЕХ выходах ─────────────────────
function stubOptimize(c, opts) {
    c.planChangeoverMin = function(cuts, map) { return map ? opts.coAfter : opts.coBefore; };
    c.planLatenessDays = function(cuts, map) { return map ? opts.lateAfter : opts.lateBefore; };
    c.computeReassignmentPlan = function() { return { changed: false, slitterByRecordId: {}, slitterReqId: '1156' }; };
    c.buildSequenceOps = function(cuts) {
        var byId = {}; (cuts || []).forEach(function(x) { byId[String(x.id)] = x; });
        return { ops: opts.ops || { updates: [], creates: [], deletes: [] }, cutsById: byId };
    };
}

// 3a) «Не трогаем» при просрочке — раньше это был НЕВИДИМЫЙ белый тост и полная тишина в консоли.
(function () {
    var c = makeController([cutOf('11', DAY1, '101')]);
    var notices = [];
    c.notify = function(msg, kind) { notices.push({ kind: kind, msg: msg }); };
    stubOptimize(c, { coBefore: 915, coAfter: 915, lateBefore: 5, lateAfter: 5 });

    var cap = captureTrace(function() { c.runOptimizeQueue(); });
    assert(hasLine(cap.lines, /^СТАРТ: заданий 1/), 'СТАРТ напечатан');
    assert(hasLine(cap.lines, /окно 27\.07\.2026 – 28\.07\.2026/), 'в СТАРТ попало окно фильтра [С;По]');
    assert(hasLine(cap.lines, /^КАНДИДАТ A .*не считался — переназначения станков нет/), 'почему кандидат A не считался');
    assert(hasLine(cap.lines, /^ВЫБОР: НЕТ/), 'сказано, что план не трогаем');
    assert(hasLine(cap.lines, /^СТОП: план НЕ изменён — просрочка не устранена: опозданий 5 дн/),
        'СТОП объясняет «ничего не произошло»: просрочка не устраняется');
    assertEqual(notices.length, 1, 'оператору сказано ровно одно');
    assertEqual(notices[0].kind, 'warning', 'и это предупреждение (#4211)');
})();

// 3b) Есть что показать → предпросмотр; трасса содержит перемещения, результат и СТОП.
// #4469: задания стоя́т в РАЗНЫХ днях, и кандидат сводит их в один. Если оба положить в день 27.07,
// а кандидату отдать переезд одного из них на 28.07, такой план оставит 27.07 с дырой (в остаток
// дня влезал бы проход уехавшего задания) — ТЗ §15 это запрещает, и объектив его отвергнет.
(function () {
    var c = makeController([cutOf('11', DAY1, '101'), cutOf('12', DAY2, '101')]);
    var notices = [];
    c.notify = function(msg, kind) { notices.push({ kind: kind, msg: msg }); };
    stubOptimize(c, { coBefore: 915, coAfter: 640, lateBefore: 0, lateAfter: 0,
        ops: { updates: [{ cutId: '11', planStartTs: DAY2, plannedRuns: 6 }], creates: [], deletes: [] } });

    var cap = captureTrace(function() { c.runOptimizeQueue(); });
    assert(!!c._pendingPlan, 'план отложен (предпросмотр), в БД не писали');
    assert(hasLine(cap.lines, /^ПЕРЕМЕЩЕНИЯ: 1$/) && hasLine(cap.lines, /^ {2}11: 27\.07 08:00 → 28\.07 08:00/),
        'ПЕРЕМЕЩЕНИЯ: что куда уехало');
    assert(hasLine(cap.lines, /^ВЫБОР: B — порядок\/дни на текущих станках$/), 'ВЫБОР: кандидат B');
    assert(hasLine(cap.lines, /^РЕЗУЛЬТАТ \(окно панели «Качество плана»\):$/), 'РЕЗУЛЬТАТ по окну панели');
    assert(hasLine(cap.lines, /^СТОП: предпросмотр показан — в БД НЕ записано/), 'СТОП: ждём «Применить»/«Отменить»');

    // «Отменить» — тоже след в трассе (иначе конец истории не виден).
    var cap2 = captureTrace(function() { c.cancelPendingPlan(); });
    assert(hasLine(cap2.lines, /^СТОП: «ОТМЕНИТЬ» — план остался прежним/), 'отмена отмечена в трассе');
})();

// ── 4) Невидимый тост: класс вида + правило с фоном в CSS ───────────────────
(function () {
    var c = makeController([cutOf('11', DAY1, '101')]);
    c.notify('Просрочка не устранена', 'warning');
    var toast = c.toastHost.childNodes[0];
    assert(!!toast && toast.classList.contains('atex-pp-toast-warning'),
        'notify(..., «warning») ставит класс atex-pp-toast-warning');

    var cssPath = path.join(__dirname, '..', 'download', 'atex', 'css', 'production-planning.css');
    var css = fs.readFileSync(cssPath, 'utf8');
    var jsPath = path.join(__dirname, '..', 'download', 'atex', 'js', 'production-planning', '20-controller.js');
    var js = fs.readFileSync(jsPath, 'utf8');
    // Все виды тоста, которыми пользуется контроллер: notify(<что-то>, 'вид').
    var kinds = {};
    (js.match(/\.notify\([\s\S]*?,\s*'([a-z]+)'\s*\)/g) || []).forEach(function(m) {
        var k = /'([a-z]+)'\s*\)$/.exec(m);
        if (k && k[1]) kinds[k[1]] = true;
    });
    var used = Object.keys(kinds).sort();
    assert(used.indexOf('warning') !== -1, 'вид «warning» действительно используется контроллером');
    var noBackground = used.filter(function(kind) {
        var re = new RegExp('\\.atex-pp-toast-' + kind + '\\s*\\{[^}]*background\\s*:', 'm');
        return !re.test(css);
    });
    assertEqual(noBackground, [], 'у КАЖДОГО используемого вида тоста есть фон в CSS (иначе белый текст на белом — #4409)');
})();

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
