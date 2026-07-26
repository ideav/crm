// Tests for ideav/crm#4408 — «Время старта заданий не пересчитано корректно — надо честно
// пересчитывать, за пределы дня задания не выкидывать».
//
// После #4401/PR#4403 кнопка «↻ Пересчитать наладку» писала ТОЛЬКО три колонки тайминга и не
// трогала planStart: день ехал внахлёст (скриншот задачи — №1 08:00–11:20 · 190 мин, а №2
// стартует в 08:51). Теперь пересчёт ЧЕСТНО пересобирает время старта:
//   A) день раскладывается ВСТЫК от начала смены — без дыр и нахлёстов, обед вставляется один раз;
//   B) задание остаётся в СВОЁМ дне, даже если день переполнен (за пределы дня не выкидываем);
//   C) начатое задание (#4381) — якорь, его старт не двигаем;
//   D) целый (свежий, упакованный) день не трогаем — его зазоры (обед/«Отпуск») законны;
//   E) кнопка показывается и по расхождению СТАРТОВ, а не только колонок тайминга.
//
// Run with: node experiments/atex-pp-4408-honest-starts.test.js

process.env.TZ = 'UTC';

// ── Минимальный DOM-стаб (как в atex-pp-4401-recalc-timing-only.test.js) ──
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
var planning = api.planning;

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

// Настройки смены как на стенде: 08:00–16:30, обед 12:20×40, буфер уборки 15 мин (потолок резки 16:15).
var DAY_SETTINGS = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
    LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
var DAY_START = 8 * 60, LUNCH_START = 12 * 60 + 20, LUNCH_DUR = 40;
var PACK = { dayStartMin: DAY_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR, blocked: [] };

function item(id, startMin, occMin, over) {
    var it = { cutId: id, windowStartMin: startMin, occMin: occMin, started: false };
    for (var k in (over || {})) it[k] = over[k];
    return it;
}
function startsOf(items, opts) {
    var map = planning.repackDayWindowStarts(items, opts || PACK);
    return items.map(function(it) { return map[it.cutId]; });
}
function kindsOf(items, opts) {
    return planning.dayLayoutGaps(items, opts || PACK).map(function(g) { return g.kind; });
}

// ── A) День из задачи: старты разъехались → раскладываем встык ───────────────
(function () {
    // Скриншот issue #4408 (Станок 1, Пт 24.07.2026): суммарно 395 мин работы, а карточки
    // налезают друг на друга — №1 занимает 08:00–11:10, но №2 стоит на 08:51.
    var broken = [
        item('c1', DAY_START, 190),          // 08:00
        item('c2', 8 * 60 + 51, 86),         // 08:51 — наезд на c1
        item('c3', 9 * 60 + 49, 49),         // 09:49
        item('c4', 10 * 60 + 8, 42),         // 10:08
        item('c5', 10 * 60 + 50, 28)         // 10:50
    ];
    assert(!planning.dayLayoutIsSound(broken, PACK), 'налезающие задания — день НЕ цел');
    assertEqual(kindsOf(broken), ['ok', 'overlap', 'overlap', 'overlap', 'ok'],
        'разбор дня показывает именно нахлёсты (c5 стоит встык к c4, но весь день уже уехал)');

    var got = startsOf(broken);
    // 08:00 +190 → 11:10 +86 → 12:36 (курсор дошёл до обеда) +40 обеда → 13:16 +49 → 14:05 +42 → 14:47
    assertEqual(got, [480, 670, 796, 845, 887],
        'день пересобран встык: 08:00, 11:10, 13:16 (после обеда), 14:05, 14:47');

    var fixed = broken.map(function(it, i) { return item(it.cutId, got[i], it.occMin); });
    assert(planning.dayLayoutIsSound(fixed, PACK), 'после пересборки дыр и нахлёстов нет');
    assertEqual(kindsOf(fixed), ['ok', 'ok', 'lunch', 'ok', 'ok'],
        'единственный зазор дня — обед, и он объяснён');
    assertEqual(startsOf(fixed), got, 'пересборка идемпотентна — повторный прогон ничего не меняет');
})();

// ── A2) Дыры схлопываются так же, как нахлёсты ───────────────────────────────
(function () {
    var holed = [item('h1', DAY_START, 60), item('h2', 10 * 60, 60), item('h3', 11 * 60 + 30, 30)];
    assertEqual(kindsOf(holed), ['ok', 'hole', 'hole'], 'ничем не объяснённые зазоры — дыры');
    assertEqual(startsOf(holed), [480, 540, 600], 'дыры схлопнуты: 08:00, 09:00, 10:00');

    // Первое задание дня, начатое позже смены без причины, тоже подтягивается к 08:00.
    var late = [item('l1', 9 * 60, 45)];
    assertEqual(kindsOf(late), ['hole'], 'день, начатый без причины позже смены, — дыра');
    assertEqual(startsOf(late), [480], 'первое задание дня встаёт на начало смены');
})();

// ── B) За пределы дня не выкидываем ──────────────────────────────────────────
(function () {
    // Работы больше, чем влезает в смену (≈450 мин): 3 × 200 = 600 + обед.
    var over = [item('o1', DAY_START, 200), item('o2', 9 * 60, 200), item('o3', 10 * 60, 200)];
    var got = startsOf(over);
    assertEqual(got, [480, 680, 920], 'переполненный день пакуется встык (обед — внутри o2)');
    got.forEach(function(s, i) {
        assert(s >= 0 && s < 1440, 'задание #' + (i + 1) + ' осталось в СВОЁМ дне (старт внутри суток)');
    });
    assert(got[2] + 200 > 16 * 60 + 15, 'переполнение показано как есть — хвост уходит за конец смены');
})();

// ── C) Начатое задание — якорь ───────────────────────────────────────────────
(function () {
    var withStarted = [
        item('s1', DAY_START, 60),
        item('s2', 10 * 60, 60, { started: true }),   // уже идёт на станке (#4381)
        item('s3', 12 * 60, 30)
    ];
    var got = startsOf(withStarted);
    assertEqual(got[1], 10 * 60, 'старт начатого задания не тронут');
    assertEqual(got, [480, 600, 660], 'соседи встают вокруг начатого: до него и сразу после');
    assertEqual(kindsOf([item('s1', 480, 60), item('s2', 600, 60, { started: true })]),
        ['ok', 'started'], 'зазор перед начатым заданием объяснён — не дыра');
})();

// ── D) Целый день (упаковщик) не трогаем ─────────────────────────────────────
(function () {
    // Так выглядит свежий план: встык, обед зазором ровно в 12:20+.
    var sound = [item('p1', DAY_START, 180), item('p2', 11 * 60, 100), item('p3', 13 * 60 + 20, 90)];
    assertEqual(kindsOf(sound), ['ok', 'ok', 'lunch'], 'зазор в 40 мин у обеда — законный обед');
    assert(planning.dayLayoutIsSound(sound, PACK), 'свежий план упаковщика цел — пересобирать нечего');

    // «Отпуск» станка 09:00–11:00 объясняет зазор (#3764).
    var opts = { dayStartMin: DAY_START, lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR,
        blocked: [[9 * 60, 11 * 60]] };
    var downtime = [item('d1', DAY_START, 60), item('d2', 11 * 60, 60)];
    assertEqual(kindsOf(downtime, opts), ['ok', 'downtime'], 'простой станка объясняет зазор');
    assert(planning.dayLayoutIsSound(downtime, opts), 'день с «Отпуском» цел');
    // …и пересборка в него не заезжает.
    assertEqual(startsOf([item('d1', DAY_START, 60), item('d2', 8 * 60 + 30, 60)], opts), [480, 660],
        'пересборка обходит окно простоя: второе задание — сразу после него');
})();

// ── D2) Свежий план УПАКОВЩИКА читается как целый (кнопка не зажигается зря) ──
(function () {
    // Гоняем настоящий splitMachineQueue с ДРОБНОЙ намоткой и обедом, снапим окна к целым минутам
    // (#4061 — так planStart и попадает в базу) и проверяем: его собственная раскладка не выглядит
    // «развалившейся». Иначе красная кнопка светилась бы сразу после генерации.
    function cutFor(id, mat, widths) {
        return { id: id, slitter: { id: '101' }, materialId: mat, winding: 'OUT',
            knifeWidths: widths, knifeCount: widths.length, plannedRuns: 3, duration: 0 };
    }
    var segs = planning.splitMachineQueue(
        [cutFor('c1', '500', [110, 110]), cutFor('c2', '500', [110, 110]),
         cutFor('c3', '600', [55, 55, 55]), cutFor('c4', '600', [55, 55, 55])],
        { dayStartMin: DAY_START, dayEndMin: 16 * 60 + 15, dayEndHourMin: 16 * 60 + 30,
          perPassByCut: { c1: 63.4, c2: 41.7, c3: 52.3, c4: 29.9 },
          runsByCut: { c1: 3, c2: 3, c3: 3, c4: 3 },
          lunchStartMin: LUNCH_START, lunchDurationMin: LUNCH_DUR,
          maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, firstCutSetup: true, orderAuthoritative: true });
    assert(segs.length > 1, 'упаковщик разложил очередь по дням');
    var snapped = planning.snapWindowStartsWholeMinutes(segs.map(function(s) {
        return { ws: s.windowStartMin, setup: s.setupMin, cutLeader: s.durationMin };
    }));
    var byDay = {};
    segs.forEach(function(s, i) {
        var it = { cutId: s.cutId + '#' + i, windowStartMin: snapped[i],
            occMin: Math.round(s.setupMin) + Math.ceil(s.durationMin), started: false };
        var day = Math.floor(it.windowStartMin / 1440);
        (byDay[day] = byDay[day] || []).push(it);
    });
    Object.keys(byDay).forEach(function(day) {
        assert(planning.dayLayoutIsSound(byDay[day], PACK),
            'день ' + day + ' свежего плана упаковщика — целый (пересобирать нечего)');
        assertEqual(planning.repackDayWindowStarts(byDay[day], PACK),
            byDay[day].reduce(function(acc, it) { acc[it.cutId] = it.windowStartMin; return acc; }, {}),
            'день ' + day + ': пересборка вернула бы ровно те же старты');
    });
})();

// ── Контроллер ───────────────────────────────────────────────────────────────
var KNIFE_REQ = '96067', MAT_REQ = '96069', TIME_REQ = '96778', CUT_TABLE = '1078';
function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
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
    c.daySettings = DAY_SETTINGS; c.prevSetupBySlitter = {}; c.downtimesBySlitter = {}; c.calendarByDay = {};
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
// Приводим хранимые колонки к расчёту — как после записи наладки. Остаются «кривыми» только старты.
function syncStoredTiming(ctrl, cuts) {
    (ctrl.computeCutSetupUpdates(null, { dryRun: true }).updates || []).forEach(function(u) {
        var cut = cuts.filter(function(x) { return String(x.id) === String(u.cutId); })[0];
        if (!cut) return;
        cut.storedKnifeSetupMin = String(u.knife);
        cut.storedMaterialWindingMin = String(u.material);
        cut.storedCutAndLeaderMin = String(u.cutTime);
    });
}
function occOf(cut) {
    return Number(cut.storedKnifeSetupMin) + Number(cut.storedMaterialWindingMin) + Number(cut.storedCutAndLeaderMin);
}
function flush() {
    var p = Promise.resolve();
    for (var i = 0; i < 40; i++) p = p.then(function() {});
    return p;
}
var DAY = [2026, 7, 27];
function at(hh, mm) { return tsAt(DAY[0], DAY[1], DAY[2], hh, mm); }
var FILTER = { slitter: '', status: '', date: '2026-07-27', dateTo: '2026-07-27', query: '' };

// ── E) Детектор: разъехавшийся СТАРТ тоже зажигает кнопку ────────────────────
(function () {
    var cuts = [cutOf('a1', '101', at(8, 0)), cutOf('a2', '101', at(8, 51))];
    var c = makeController(cuts, FILTER);
    syncStoredTiming(c, cuts);
    assertEqual(c.computeCutSetupUpdates(null, { dryRun: true }).updates, [],
        'колонки тайминга уже актуальны — по #4401 расхождений нет');
    c._setupMismatchCache = null;
    var ids = c.recalcMismatchIds('101');
    assert(ids.indexOf('a2') !== -1, 'но старт разъехался → задание в списке расхождений (#4408)');

    c.renderQueue();
    var btn = c.queueEl.querySelectorAll('.atex-pp-recalc-setup')[0] || null;
    assert(!!btn, 'кнопка «Пересчитать наладку» показана по расхождению стартов');
})();

// ── E2) Задание без минут занятости — день не трогаем (нечем мерить «стену») ──
(function () {
    var cuts = [cutOf('n1', '101', at(8, 0)), cutOf('n2', '101', at(11, 0))];
    var c = makeController(cuts, FILTER);
    c.meta.cut.reqs = [];   // колонок тайминга в таблице нет → занятость заданий неизвестна
    var warns = [];
    var origWarn = console.warn;
    console.warn = function() { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
    var ops = c.recalcStartUpdates('101');
    console.warn = origWarn;
    assertEqual(ops, [], 'день с заданием нулевой занятости не пересобираем');
    assert(warns.filter(function(w) { return w.indexOf('#4408') !== -1; }).length === 1,
        'и не молчим об этом — пишем в консоль');
})();

// ── F) recalcSetupTiming: пишет planStart, дни и порядок не меняет ───────────
(function run() {
    var cuts = [
        cutOf('a1', '101', at(8, 0)),
        cutOf('a2', '101', at(8, 51)),      // наезд
        cutOf('a3', '101', at(9, 49)),      // наезд
        cutOf('b1', '202', at(8, 30)),      // чужой станок
        cutOf('a9', '101', tsAt(2026, 7, 30, 8, 51))   // свой станок, день ВНЕ окна фильтра
    ];
    var c = makeController(cuts, FILTER);
    syncStoredTiming(c, cuts);
    var occ = {}; cuts.forEach(function(x) { occ[x.id] = occOf(x); });

    var ops = c.recalcStartUpdates('101');
    assertEqual(ops.map(function(o) { return o.cutId; }), ['a2', 'a3'],
        'пересобираются только разъехавшиеся задания своего станка в видимых днях');

    c.recalcSetupTiming('101');
    flush().then(function() {
        var saves = c._posts.filter(function(p) { return p.path.indexOf('_m_save/') === 0; });
        assert(saves.length > 0, '#4408: planStart переписан (_m_save с главным значением)');
        assertEqual(c._posts.filter(function(p) {
            return p.path.indexOf('_m_new') === 0 || p.path.indexOf('_m_del') === 0;
        }).length, 0, 'заданий не создаём и не удаляем — это не перепланирование');

        var touched = saves.map(function(p) { return p.path.replace(/^_m_save\//, '').replace(/\?.*$/, ''); }).sort();
        assertEqual(touched, ['a2', 'a3'],
            'тронуты только свои задания в видимых днях (b1 — чужой станок, a9 — вне окна)');
        saves.forEach(function(p) {
            assertEqual(Object.keys(p.fields), ['t' + CUT_TABLE], 'в payload старта — только главное значение');
        });

        // Новые старты: тот же день, встык по хранимым минутам.
        var newTs = {};
        saves.forEach(function(p) { newTs[p.path.replace(/^_m_save\//, '').replace(/\?.*$/, '')] = Number(p.fields['t' + CUT_TABLE]); });
        var order = ['a1', 'a2', 'a3'];
        var starts = order.map(function(id) { return newTs[id] != null ? newTs[id] : Number(cuts.filter(function(x) { return x.id === id; })[0].planDate); });
        order.forEach(function(id, i) {
            var d = new Date(starts[i] * 1000);
            assertEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], DAY, id + ': ДЕНЬ задания не изменился');
            if (i === 0) return;
            var gap = (starts[i] - starts[i - 1]) / 60 - occ[order[i - 1]];
            assertEqual(gap, 0, id + ': стартует ровно там, где кончается предыдущее (без дыры и нахлёста)');
        });
        assertEqual(starts[0], at(8, 0), 'первое задание дня стоит на начале смены');

        assert(c._notes.filter(function(n) { return n.msg.indexOf('время старта') !== -1; }).length === 1,
            'в отчёте пользователю сказано, сколько стартов пересобрано');

        // Всё сошлось → второй прогон ничего не пишет.
        var cuts2 = [cutOf('z1', '101', at(8, 0))];
        var c2 = makeController(cuts2, FILTER);
        syncStoredTiming(c2, cuts2);
        c2.recalcSetupTiming('101');
        return flush().then(function() {
            assertEqual(c2._posts.length, 0, 'наладка и старты актуальны → ни одной записи в БД');
            assert(c2._notes.filter(function(n) { return n.msg.indexOf('уже актуальна') !== -1; }).length === 1,
                'сообщаем, что пересчитывать нечего');

            // ── G) Переполненный день: задания остаются в дне, но об этом ПРЕДУПРЕЖДАЕМ ──
            var big = [
                cutOf('g1', '101', at(8, 0), { plannedRuns: 40, duration: 300 }),
                cutOf('g2', '101', at(9, 0), { plannedRuns: 40, duration: 300 })
            ];
            var c3 = makeController(big, FILTER);
            syncStoredTiming(c3, big);
            var ops3 = c3.recalcStartUpdates('101');
            ops3.forEach(function(o) {
                var d = new Date(o.ts * 1000);
                assertEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], DAY,
                    'переполненный день: задание НЕ уехало на другой день');
                var cut = big.filter(function(x) { return x.id === o.cutId; })[0];
                cut.planDate = String(o.ts); cut.number = String(o.ts);   // как после записи + reload
            });
            var warned = c3.warnOverfilledDays('101');
            assert(warned.length === 1 && warned[0].overMin > 0, 'переполнение дня посчитано');
            assert(c3._notes.filter(function(n) { return n.kind === 'warning' && n.msg.indexOf('Не помещается в смену') !== -1; }).length === 1,
                'о переполнении дня предупреждаем, а не прячем его');

            console.log('\n' + passed + '/' + total + ' passed');
        });
    }).catch(function(e) { console.error('FAIL — исключение в асинхронной части:', e && e.stack || e); process.exitCode = 1; });
})();
