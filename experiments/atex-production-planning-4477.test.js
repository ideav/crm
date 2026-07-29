// Тесты для ideav/crm#4477 — массовая запись идёт В 5 ПОТОКОВ, а неизменившееся не сохраняется.
//
// Из тикета: «Кинуть задание в другой день и посмотреть как оно сохраняется — не более 1 запроса
// одновременно… я вижу много запросов на простое изменение — возможно, некоторые лишние».
// Правило (ТЗ §15): если запросы _m_set/_m_save можно распараллелить — распараллеливаем (предел
// MAX_PARALLEL_WRITES=5); команду на сохранение значения, которое уже лежит в базе, не даём.
//
// Проверяется ШЛЮЗ, а не отдельный обработчик: «Время старта» все пути пишут через postCutStarts
// (метод saveCutStarts), поэтому правило нельзя забыть в очередном обработчике.
//   A — ручной перенос 🗓 (moveCutToDay, репро из тикета): соседи по целевому дню порядок не
//       меняют → им НЕ пишется ничего; запросов ровно один — за перемещаемое задание;
//   B — тот же перенос, когда времена дня непригодны (совпали) и день перенумеровывается целиком:
//       запросы идут ПУЛОМ до 5 одновременно (на старом коде было бы 1);
//   C — шлюз saveCutStarts сам по себе: совпавшее с хранимым не пишет, изменившееся — пулом до 5;
//   D — перетаскивание внутри дня (reorderCutInDay) пишет пулом;
//   E — «Зафиксировать» набор заданий (setCutsFixed) пишет пулом;
//   F — смена станка «Упорядочить» (persistSlitterReassignment): пул до 5 вместо безлимитного
//       Promise.all, и записи тем, у кого станок тот же, не даются;
//   G — чистая planMoveStarts: соседи сохраняют свои времена, минтуется только вставляемому;
//       непригодные времена дня → перенумерация всего дня (прежнее поведение).
//
// Run with: node experiments/atex-production-planning-4477.test.js

process.env.TZ = 'Europe/Moscow';
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

var TS = function(y, m, d, hh, mm) { return Math.floor(new Date(y, m, d, hh, mm || 0, 0, 0).getTime() / 1000); };
var TARGET_DAY = '2026-07-27';

// Счётчик параллелизма: обёртка над post, считает одновременные запросы.
function makePost(st) {
    return function(path, fields) {
        st.inflight++;
        if (st.inflight > st.maxInflight) st.maxInflight = st.inflight;
        st.posts.push({ path: path, fields: fields });
        return delay(5).then(function() { st.inflight--; return { obj: 'OK' }; });
    };
}
function savedIds(st) {
    return st.posts.filter(function(p) { return p.path.indexOf('_m_save/') === 0; })
        .map(function(p) { return p.path.replace('_m_save/', '').replace('?JSON', ''); }).sort();
}

// ── A/B: ручной перенос задания на другой день (репро тикета) ─────────────────────────────────
// Целевой день: N заданий станка «1»; переносим M с другого дня «в конец дня».
function moveHarness(neighbourStarts) {
    var st = { inflight: 0, maxInflight: 0, posts: [] };
    var moved = { id: 'M', slitter: { id: '1' }, plannedRuns: 1, planDate: String(TS(2026, 6, 30, 8, 0)), status: '' };
    var cuts = [moved];
    neighbourStarts.forEach(function(ts, i) {
        cuts.push({ id: 'N' + i, slitter: { id: '1' }, plannedRuns: 1, planDate: String(ts), status: '' });
    });
    var self = {
        busy: false, cuts: cuts,
        meta: { cut: { id: '1078', reqs: [] } },
        slitters: [{ id: '1', label: 'Станок 1' }],
        filter: { date: '2026-07-20', dateTo: '2026-07-31' },
        changeTimes: {}, daySettings: {}, opTimes: {},
        nowMs: function() { return new Date(2026, 6, 20, 0, 0, 0, 0).getTime(); },
        workingWindow: function() { return { startMin: 480, cutEndMin: 990, endMin: 990, lunchStartMin: 0, lunchDurationMin: 0, cleanupMin: 30, maxOverworkTuneMin: 10, maxOverworkCutsMin: 5 }; },
        slitterOnVacationDay: function() { return false; },
        setBusy: function() {}, showProgress: function() {}, updateProgress: function() {}, hideProgress: function() {}, render: function() {},
        post: makePost(st),
        reload: function() { moved.planDate = String(TS(2026, 6, 27, 8, 0)); return Promise.resolve(); },
        notify: function() {},
        autoSequenceQueue: function() { return Promise.resolve(true); }
    };
    return { st: st, run: function() { return Controller.prototype.moveCutToDay.call(self, moved, TARGET_DAY, 'end', false, '', true); } };
}

// A — обычный день: у соседей нормальные, разные времена старта.
var sound = [TS(2026, 6, 27, 8, 0), TS(2026, 6, 27, 9, 30), TS(2026, 6, 27, 11, 0),
             TS(2026, 6, 27, 13, 0), TS(2026, 6, 27, 14, 0), TS(2026, 6, 27, 15, 0)];
var hA = moveHarness(sound);
// B — времена дня совпали (след неполной пересборки, #3885): день перенумеровывается целиком.
var same = [TS(2026, 6, 27, 8, 0), TS(2026, 6, 27, 8, 0), TS(2026, 6, 27, 8, 0),
            TS(2026, 6, 27, 8, 0), TS(2026, 6, 27, 8, 0), TS(2026, 6, 27, 8, 0)];
var hB = moveHarness(same);

Promise.resolve()
    .then(function() { return hA.run(); })
    .then(function() {
        assert(savedIds(hA.st).join(',') === 'M',
            '#4477-A (репро): перенос в день с 6 соседями пишет ОДНО задание — перемещаемое (было 7 запросов; сейчас: ' + savedIds(hA.st).join(',') + ')');
        assert(hA.st.posts.length === 1,
            '#4477-A: всего запросов 1 — соседям, чей порядок не изменился, команд не даём (сейчас ' + hA.st.posts.length + ')');
    })
    .then(function() { return hB.run(); })
    .then(function() {
        // 7 заданий дня, но первое уже стои́т на 08:00 = плейсхолдер №0 → шлюз его отсеивает.
        assert(savedIds(hB.st).length === 6,
            '#4477-B: непригодные времена дня (совпали) — день перенумеровывается целиком, 6 записей из 7 (сейчас ' + savedIds(hB.st).length + ')');
        assert(hB.st.maxInflight === 5,
            '#4477-B: запись идёт пулом до 5 потоков одновременно (на цепочке было бы 1; сейчас ' + hB.st.maxInflight + ')');
    })

    // ── C: сам шлюз saveCutStarts ────────────────────────────────────────────────────────────
    .then(function() {
        var st = { inflight: 0, maxInflight: 0, posts: [] };
        var cuts = [];
        for (var i = 0; i < 8; i++) cuts.push({ id: 'C' + i, planDate: String(TS(2026, 6, 27, 8, 0) + i * 600) });
        cuts.push({ id: 'SAME', planDate: String(TS(2026, 6, 27, 8, 0)) });
        var self = { meta: { cut: { id: '1078', reqs: [] } }, cuts: cuts, post: makePost(st), notify: function() {} };
        var items = cuts.slice(0, 8).map(function(c) { return { cutId: c.id, ts: Number(c.planDate) + 60 }; });
        items.push({ cutId: 'SAME', ts: TS(2026, 6, 27, 8, 0) });           // ровно хранимое
        items.push({ cutId: 'SAME2', ts: TS(2026, 6, 27, 8, 0), wasTs: TS(2026, 6, 27, 8, 0) });   // хранимое передано явно
        return Controller.prototype.saveCutStarts.call(self, items).then(function(n) {
            assert(n === 8 && st.posts.length === 8,
                '#4477-C: шлюз пишет только изменившиеся — 8 из 10 (записано ' + n + ', запросов ' + st.posts.length + ')');
            assert(savedIds(st).indexOf('SAME') < 0 && savedIds(st).indexOf('SAME2') < 0,
                '#4477-C: совпавшему с хранимым «Времени старта» команда на сохранение не даётся');
            assert(st.maxInflight === 5,
                '#4477-C: пул до 5 потоков (сейчас ' + st.maxInflight + ')');
            assert(st.posts[0].path.indexOf('_m_save/') === 0 && st.posts[0].fields.t1078 != null,
                '#4477-C: первая колонка пишется _m_save с t{tableId} (issue #775)');
        });
    })
    .then(function() {
        // Пустой набор — ни одного запроса и ни одной ошибки (даже без метаданных).
        var st = { inflight: 0, maxInflight: 0, posts: [] };
        var self = { meta: {}, cuts: [], post: makePost(st), notify: function() {} };
        return Controller.prototype.saveCutStarts.call(self, []).then(function(n) {
            assert(n === 0 && st.posts.length === 0, '#4477-C: писать нечего → ноль запросов, промис резолвится нулём');
        });
    })

    // ── D: перетаскивание задания внутри дня (drag-drop) ─────────────────────────────────────
    .then(function() {
        var st = { inflight: 0, maxInflight: 0, posts: [] };
        var dayCuts = [];
        for (var i = 0; i < 8; i++) dayCuts.push({ id: 'D' + i, slitter: { id: '1' }, planDate: TS(2026, 6, 27, 8, 0) + i * 3600, status: '' });
        var self = {
            busy: false, cuts: dayCuts.slice(), meta: { cut: { id: '1078', reqs: [] } },
            setBusy: function() {}, render: function() {}, notify: function() {},
            post: makePost(st), reload: function() { return Promise.resolve(); }
        };
        // Тащим последнее задание дня в голову — переставляются все восемь.
        return Controller.prototype.reorderCutInDay.call(self, dayCuts, 'D7', 'D0').then(function() {
            assert(st.posts.length === 8, '#4477-D: перетаскивание переставило 8 заданий — 8 запросов (сейчас ' + st.posts.length + ')');
            assert(st.maxInflight === 5, '#4477-D: перетаскивание пишет пулом до 5 потоков (было 1; сейчас ' + st.maxInflight + ')');
        });
    })

    // ── E: «Зафиксировать» набор заданий ─────────────────────────────────────────────────────
    .then(function() {
        var st = { inflight: 0, maxInflight: 0, posts: [] };
        var ids = [];
        for (var i = 0; i < 8; i++) ids.push('F' + i);
        var self = {
            busy: false, cuts: ids.map(function(id) { return { id: id }; }),
            meta: { cut: { id: '1078', reqs: [{ id: '81530', val: 'Зафиксировано' }] } },
            computeCutSetupUpdates: function() { return { reqs: {}, updates: [] }; },
            setBusy: function() {}, showProgress: function() {}, updateProgress: function() {}, hideProgress: function() {},
            render: function() {}, notify: function() {}, post: makePost(st),
            reload: function() { return Promise.resolve(); }
        };
        return Controller.prototype.setCutsFixed.call(self, ids, true, { silent: true }).then(function() {
            var sets = st.posts.filter(function(p) { return p.path.indexOf('_m_set/') === 0; });
            assert(sets.length === 8, '#4477-E: «Зафиксировать» — 8 записей _m_set (сейчас ' + sets.length + ')');
            assert(st.maxInflight === 5, '#4477-E: «Зафиксировать» пишет пулом до 5 потоков (было 1; сейчас ' + st.maxInflight + ')');
        });
    })

    // ── F: смена станка при «Упорядочить» ────────────────────────────────────────────────────
    .then(function() {
        var st = { inflight: 0, maxInflight: 0, posts: [] };
        var cuts = [], byRec = {};
        for (var i = 0; i < 8; i++) { cuts.push({ id: 'S' + i, slitter: { id: '1' } }); byRec['S' + i] = '2'; }
        cuts.push({ id: 'SKIP', slitter: { id: '2' } }); byRec['SKIP'] = '2';   // станок уже такой — писать нечего
        var self = { cuts: cuts, post: makePost(st), notify: function() {} };
        return Controller.prototype.persistSlitterReassignment.call(self, byRec, '333').then(function() {
            assert(st.posts.length === 8,
                '#4477-F: станок пишется только там, где он реально меняется — 8 из 9 (сейчас ' + st.posts.length + ')');
            assert(st.maxInflight === 5,
                '#4477-F: смена станка идёт пулом до 5 потоков (было безлимитное Promise.all; сейчас ' + st.maxInflight + ')');
        });
    })

    // ── G: чистая planMoveStarts ─────────────────────────────────────────────────────────────
    .then(function() {
        var D = TS(2026, 6, 27, 8, 0);
        var day = [{ id: 'A', planDate: D }, { id: 'B', planDate: D + 3600 }, { id: 'C', planDate: D + 7200 }];
        var end = planning.planMoveStarts(['A', 'B', 'C', 'M'], day, 'M', D);
        assert(!end.renumbered && end.byCut.A === D && end.byCut.B === D + 3600 && end.byCut.C === D + 7200 && end.byCut.M > D + 7200,
            '#4477-G: «в конец дня» — соседи сохраняют свои времена, новое минтуется только вставляемому');
        var start = planning.planMoveStarts(['M', 'A', 'B', 'C'], day, 'M', D);
        assert(!start.renumbered && start.byCut.A === D && start.byCut.M < D,
            '#4477-G: «в начало дня» — вставляемое встаёт ПЕРЕД первым, соседи не переписываются');
        var mid = planning.planMoveStarts(['A', 'M', 'B', 'C'], day, 'M', D);
        assert(!mid.renumbered && mid.byCut.M > D && mid.byCut.M < D + 3600,
            '#4477-G: «по весу» — вставляемое встаёт в середину промежутка между соседями');
        var same2 = planning.planMoveStarts(['A', 'B', 'M'], [{ id: 'A', planDate: D }, { id: 'B', planDate: D }], 'M', D);
        assert(same2.renumbered && same2.byCut.A === D && same2.byCut.B === D + 60 && same2.byCut.M === D + 120,
            '#4477-G: совпавшие времена дня → перенумерация всего дня (прежнее поведение, порядок сохранён)');
        var noTime = planning.planMoveStarts(['A', 'M'], [{ id: 'A', planDate: '' }], 'M', D);
        assert(noTime.renumbered, '#4477-G: у соседа нет времени старта → перенумерация всего дня');
        var alone = planning.planMoveStarts(['M'], [], 'M', D);
        assert(!alone.renumbered && alone.byCut.M === D, '#4477-G: пустой целевой день — вставляемое встаёт на начало смены');
    })

    .then(function() {
        console.log('\n' + passed + '/' + total + ' проверок пройдено');
        if (passed !== total) process.exitCode = 1;
    })
    .catch(function(err) {
        console.error('ОШИБКА теста:', err && err.stack || err);
        process.exitCode = 1;
    });
