// Тесты для ideav/crm#4990 — ревью #4987: пакетная запись разбиения плана.
//
//   1 — create-путь: если правка головы (`aFixOps`, шаг 2a) упёрлась в «No such record» —
//       продолжение B НЕ создаётся. Покрытие сегмента 0 никому не записано, и рождённое
//       продолжение повисло бы «не привязанным к заказу» (семья #4155/#4163). Задание остаётся
//       целым, действие не падает — как до #4987 (per-задача softSkip #3895).
//   2 — `_m_batch` ответил короче отправленной пачки: недостающие операции уходят ОДНИМ тихим
//       повтором; если и он их не вернул — они в `failures`, а не молча «применены».
//   3 — «Упорядочить» по неизменившемуся плану: фаза updates всё равно двигает прогресс по
//       каждому заданию (окно «Сохранение плана резок…» не стоит на 0/N).
//   4 — смешанный отказ пакета («No such record» + настоящий отказ): трасса называет запись,
//       которая упала по-настоящему, и несёт поимённый перечень (`failures`).
//
// Run with: node experiments/atex-pp-4990-review-4987.test.js

process.env.TZ = 'UTC';
global.window = { db: 'testdb', xsrf: 'x' };
var Controller = require('../download/atex/js/production-planning.js').Controller;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) { passed++; } else { process.exitCode = 1; }
}

function meta(id, pairs) { return { id: String(id), reqs: pairs.map(function (p) { return { id: String(p[0]), val: p[1] }; }) }; }
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['195', 'Очередность'], ['196', 'Тип намотки'], ['198', 'Лидер'],
    ['197', 'Метраж, м'], ['199', 'Длительность, минут'], ['188', 'ID первой части']
]);
var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'], ['204', 'Кол-во план'], ['205', 'В работе']]);
var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'], ['304', 'Статус'], ['305', 'Партия ГП']]);

// Стенд отвечает КАК РУЧКА `_m_batch` (ядро #4981). Записи из `missing` — «No such record»,
// из `broken` — настоящий отказ записи. `shortBy` — на сколько операций ответ короче пачки
// (число — каждый раз; массив — по пакетам подряд, дальше полные ответы).
function makeController(opts) {
    var o = opts || {};
    var missing = o.missing || [], broken = o.broken || [];
    var root = { getAttribute: function () { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.cuts = o.cuts || [
        { id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H', leaders: [] },
        { id: 'H2', length: 300, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H2', leaders: [] }
    ];
    c.supplies = o.supplies || [];
    c.footageBySupply = {};
    c.calls = [];
    c.batches = [];
    c.progress = [];
    var nBatch = 0;
    c.post = function (path, params) {
        c.calls.push({ path: String(path), params: params });
        if (String(path) === '_m_batch') {
            var ops = JSON.parse((params && params.ops) || '[]');
            c.batches.push(ops);
            var cut = Array.isArray(o.shortBy) ? (o.shortBy[nBatch] || 0) : (o.shortBy || 0);
            nBatch++;
            var answered = ops.slice(0, Math.max(0, ops.length - cut));
            return Promise.resolve({
                results: answered.map(function (op, n) {
                    if (missing.indexOf(String(op.id)) >= 0) return { n: n, op: op.op, id: op.id, ok: false, error: 'JSON: No such record' };
                    if (broken.indexOf(String(op.id)) >= 0) return { n: n, op: op.op, id: op.id, ok: false, error: 'JSON: Field is locked' };
                    return { n: n, op: op.op, id: op.id, ok: true };
                }),
                ok: answered.length, failed: 0
            });
        }
        var hit = missing.some(function (id) { return String(path).indexOf('/' + id + '?') >= 0; });
        if (hit) return Promise.reject(new Error('JSON: No such record'));
        return Promise.resolve({ obj: 'NEW' + c.calls.length });
    };
    c.loadStripsForCut = function () { return Promise.resolve([]); };
    c.resolveLeaderId = function () { return ''; };
    c.reload = function () { return Promise.resolve(); };
    c.persistCutSetupColumns = function () { return Promise.resolve(); };
    c.reconcilePlanStarts = function () { return Promise.resolve(); };
    c.reconcileOrphanOrderSupplies = function () { return Promise.resolve(); };
    c.setBusy = function () {}; c.showProgress = function () {};
    c.updateProgress = function (n) { c.progress.push(n); };
    c.hideProgress = function () {}; c.render = function () {}; c.notify = function () {};
    return c;
}
function newCutCalls(c) {
    return c.calls.filter(function (x) { return x.path.indexOf('_m_new/' + cutMeta.id + '?') === 0; });
}

// ── 1: правка головы упёрлась в «No such record» → продолжение не рождается ───────────────────
function creates(headId) {
    return {
        updates: [{ cutId: headId, sequence: 1, planStartTs: 1000, plannedRuns: 3 }],
        creates: [{ parentCutId: headId, plannedRuns: 2, planStartTs: 2000 }],
        deletes: []
    };
}
function test1() {
    var supplies = [{ id: 'SUP_H', cutId: 'H', positionId: 'P1', rolls: 50, footage: 500, finishedBatchId: 'FB1' }];
    // Контроль: обеспечение головы живо — продолжение рождается (иначе проверка ниже пуста).
    var live = makeController({ supplies: supplies });
    return live.applySplitPlan(creates('H')).then(function (ok) {
        assert(ok === true, '1: контроль — разбиение с живой головой применилось');
        assert(newCutCalls(live).length === 1, '1: контроль — продолжение B создано', '(_m_new резки: ' + newCutCalls(live).length + ')');

        // Кеш протух: обеспечение головы на сервере уже удалено.
        var stale = makeController({ supplies: supplies, missing: ['SUP_H'] });
        return stale.applySplitPlan(creates('H')).then(function (ok2) {
            assert(ok2 === true, '1: пропавшее обеспечение головы не валит пересборку (вернул true)');
            assert(newCutCalls(stale).length === 0,
                '1: продолжение B НЕ создано — покрытие сегмента 0 не записано, задание остаётся целым',
                '(_m_new резки: ' + newCutCalls(stale).length + ')');
            var supNew = stale.calls.filter(function (x) { return x.path.indexOf('_m_new/' + supMeta.id + '?') === 0; });
            assert(supNew.length === 0, '1: и обеспечений сегментов 1..N тоже нет', '(_m_new обеспечения: ' + supNew.length + ')');
        });
    });
}

// ── 2: короткий `results` → один тихий повтор, затем учёт как отказ ──────────────────────────
var threeOps = [
    { op: 'set', id: 'A', fields: { t193: '1' } },
    { op: 'set', id: 'B', fields: { t193: '2' } },
    { op: 'set', id: 'C', fields: { t193: '3' } }
];
function test2() {
    // Первый ответ без последней операции, повтор — полный.
    var c = makeController({ shortBy: [1] });
    return c.postOps(threeOps).then(function (applied) {
        assert(applied === 3, '2: после повтора применены все три операции', '(applied=' + applied + ')');
        assert(c.batches.length === 2, '2: недостающая операция ушла повтором', '(пакетов: ' + c.batches.length + ')');
        var retry = c.batches[1] || [];
        assert(retry.length === 1 && String(retry[0].id) === 'C',
            '2: в повторе — только операция, которой не было в ответе',
            '(повтор: ' + retry.map(function (op) { return op.id; }).join(',') + ')');
    }, function (err) {
        assert(false, '2: повтор с полным ответом не должен отклоняться', '(' + (err && err.message) + ')');
    }).then(function () {
        // Сервер упорно отвечает короче: повтор один, недостающее — в отказы.
        var c2 = makeController({ shortBy: 1 });
        return c2.postOps(threeOps).then(function (applied) {
            assert(false, '2: неподтверждённая операция не считается применённой', '(applied=' + applied + ')');
        }, function (err) {
            var f = (err && err.failures) || [];
            assert(f.length === 1 && String(f[0].opId) === 'C',
                '2: операция без ответа — в failures поимённо',
                '(failures: ' + f.map(function (x) { return x.opId; }).join(',') + ')');
            assert(err && err.applied === 2, '2: применённые посчитаны верно', '(applied=' + (err && err.applied) + ')');
            assert(c2.batches.length === 2, '2: повтор ровно один', '(пакетов: ' + c2.batches.length + ')');
        });
    }).then(function () {
        // Сквозь applySplitPlan: неподтверждённая запись не выдаётся за успех.
        var c3 = makeController({ shortBy: 1 });
        return c3.applySplitPlan({
            updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
            creates: [], deletes: []
        }).then(function (ok) {
            assert(ok === false, '2: applySplitPlan не рапортует успех, если запись не подтверждена', '(вернул ' + ok + ')');
        });
    });
}

// ── 3: неизменившийся план всё равно двигает прогресс фазы updates ───────────────────────────
function test3() {
    var c = makeController({
        cuts: [
            { id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', batchIdStored: 'B1', winding: 'IN', firstPartId: 'H', plannedRuns: 5, number: 1000, leaders: [] },
            { id: 'H2', length: 300, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', batchIdStored: 'B1', winding: 'IN', firstPartId: 'H2', plannedRuns: 3, number: 2000, leaders: [] }
        ]
    });
    return c.applySplitPlan({
        updates: [
            { cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 },
            { cutId: 'H2', sequence: 2, planStartTs: 2000, plannedRuns: 3 }
        ],
        creates: [], deletes: []
    }).then(function (ok) {
        assert(ok === true, '3: повтор «Упорядочить» по неизменившемуся плану применился');
        var cutEdits = c.batches.filter(function (ops) { return ops.some(function (op) { return op.id === 'H' || op.id === 'H2'; }); });
        assert(cutEdits.length === 0, '3: контроль — правок заданий нет (ранний выход фазы)', '(пакетов с заданиями: ' + cutEdits.length + ')');
        var top = c.progress.length ? Math.max.apply(null, c.progress) : 0;
        assert(top >= 2, '3: прогресс фазы updates дошёл до 2/2', '(прогресс: [' + c.progress.join(',') + '])');
    });
}

// ── 4: смешанный отказ — трасса называет настоящую упавшую запись ────────────────────────────
function test4() {
    var c = makeController({ missing: ['H'], broken: ['H2'] });
    var lines = [];
    var realErr = console.error;
    console.error = function () {
        lines.push(Array.prototype.map.call(arguments, function (a) {
            if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
            return String(a);
        }).join(' '));
    };
    return c.applySplitPlan({
        updates: [
            { cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 },
            { cutId: 'H2', sequence: 2, planStartTs: 2000, plannedRuns: 3 }
        ],
        creates: [], deletes: []
    }).then(function (ok) {
        console.error = realErr;
        assert(ok === false, '4: настоящий отказ валит пересборку, как прежде');
        var trace = lines.join('\n');
        assert(/H2/.test(trace) && /Field is locked/.test(trace),
            '4: трасса называет запись, упавшую по-настоящему, и причину',
            '(трасса: ' + trace.slice(0, 200).replace(/\n/g, ' | ') + ')');
        assert(/No such record/.test(trace), '4: и несёт поимённый перечень всех отказов пакета (failures)');
    }, function (err) { console.error = realErr; throw err; });
}

test1()
    .then(test2).then(test3).then(test4)
    .then(function () {
        console.log('\n' + passed + '/' + total + ' проверок пройдено.');
    })
    .catch(function (err) {
        console.log('FAIL — тест бросил: ' + (err && err.stack || err));
        process.exitCode = 1;
    });
