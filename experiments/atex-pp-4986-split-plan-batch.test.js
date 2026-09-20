// Тесты для ideav/crm#4986 — ФАЗА updates В applySplitPlan УХОДИТ ПАКЕТОМ, а не командой на операцию.
//
// #4984 перевёл на `_m_batch` шлюзы «Времени старта» и колонок наладки, но разбиение плана
// осталось на одиночных командах. Боевой лог перемещения задания (ateh1, приложен к #4986):
// 31 исходящая запись, из них 23 — из `applySplitPlan`, и 21 из этих 23 (13 `_m_save` + 8 `_m_set`)
// ручка `_m_batch` принимает. Пул по MAX_PARALLEL_WRITES раскладывает их в ~5 волн, но число
// round-trip'ов не меняет — а упирается всё именно в него (#4979).
//
// Здесь — РЕАЛЬНЫЙ applySplitPlan на стаб-`post`, который отвечает как ручка `_m_batch`:
//   1 — три изменившихся задания = ОДИН запрос `_m_batch`; в нём ровно изменившиеся;
//   2 — у одной резки `save` главного значения идёт ПЕРЕД её `set` (первая колонка — только
//       `_m_save`, issue #775), порядок операций в пакете сохранён;
//   3 — «No such record» на одной записи не валит действие: соседние применены (#3895);
//   4 — #4158: доля НЕ возвращается в обеспечение головы, которой на сервере нет, и возвращается
//       той, что жива (граница пропуска осталась на записи, как при задаче-на-резку);
//   5 — реальная (не «No such record») ошибка по-прежнему валит пересборку (#3895);
//   6 — #4628: доли обеспечения по проходам звена уходят одним пакетом;
//   7 — трасса пакета называет записи (#4177: по логу должно быть видно, ЧТО ушло).
//
// Run with: node experiments/atex-pp-4986-split-plan-batch.test.js

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

// Стенд отвечает КАК РУЧКА `_m_batch` (ядро #4981): `{results:[…],ok:N,failed:M}` поимённо по
// операциям. Записи из `missing` отвечают «No such record» — как удалённые на сервере.
function makeController(opts) {
    var o = opts || {};
    var missing = o.missing || [];
    var root = { getAttribute: function () { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.cuts = o.cuts || [
        { id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H', leaders: [] },
        { id: 'H2', length: 300, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H2', leaders: [] },
        { id: 'H3', length: 300, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H3', leaders: [] }
    ];
    c.supplies = o.supplies || [];
    c.footageBySupply = {};
    c.calls = [];           // все запросы: { path, params }
    c.batches = [];         // только пакеты: массив операций
    c.post = function (path, params) {
        c.calls.push({ path: String(path), params: params });
        if (String(path) === '_m_batch') {
            var ops = JSON.parse((params && params.ops) || '[]');
            c.batches.push(ops);
            if (o.serverBoom) return Promise.reject(new Error('JSON: Server boom'));
            return Promise.resolve({
                results: ops.map(function (op, n) {
                    return missing.indexOf(String(op.id)) >= 0
                        ? { n: n, op: op.op, id: op.id, ok: false, error: 'JSON: No such record' }
                        : { n: n, op: op.op, id: op.id, ok: true };
                }),
                ok: ops.length, failed: 0
            });
        }
        if (o.serverBoom) return Promise.reject(new Error('JSON: Server boom'));
        var hit = missing.some(function (id) { return String(path).indexOf('/' + id + '?') >= 0; });
        if (hit) return Promise.reject(new Error('JSON: No such record'));
        return Promise.resolve({ obj: 'NEW' });
    };
    c.loadStripsForCut = function () { return Promise.resolve([]); };
    c.resolveLeaderId = function () { return ''; };
    c.reload = function () { return Promise.resolve(); };
    c.persistCutSetupColumns = function () { return Promise.resolve(); };
    c.reconcilePlanStarts = function () { return Promise.resolve(); };
    c.reconcileOrphanOrderSupplies = function () { return Promise.resolve(); };
    c.setBusy = function () {}; c.showProgress = function () {}; c.updateProgress = function () {};
    c.hideProgress = function () {}; c.render = function () {}; c.notify = function () {};
    return c;
}
// Запросы правки существующих записей — то, ради чего заведён пакет.
function editCalls(c) {
    return c.calls.filter(function (x) { return /^_m_(save|set)\//.test(x.path) || x.path === '_m_batch'; });
}
// Операции по записи — НЕЗАВИСИМО от транспорта: и в пакете, и одиночной командой. Проверки
// сохранённого поведения (#3895/#4158/#4628) обязаны быть зелёными и до правки, иначе они
// проверяют способ отправки, а не то, что записано.
function opsOn(c, id) {
    var out = [];
    c.batches.forEach(function (ops) { ops.forEach(function (op) { if (String(op.id) === String(id)) out.push(op); }); });
    c.calls.forEach(function (x) {
        var m = /^_m_(save|set)\/([^?]+)/.exec(x.path);
        if (m && decodeURIComponent(m[2]) === String(id)) out.push({ op: m[1], id: String(id), fields: x.params });
    });
    return out;
}

// ── 1 и 2: набор изменившихся заданий = ОДИН запрос; порядок save→set сохранён ────────────────
function test12() {
    var c = makeController();
    return c.applySplitPlan({
        updates: [
            { cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 },
            { cutId: 'H2', sequence: 2, planStartTs: 2000, plannedRuns: 3 },
            { cutId: 'H3', sequence: 3, planStartTs: 3000, plannedRuns: 4 }
        ],
        creates: [], deletes: []
    }).then(function (ok) {
        assert(ok === true, '1: applySplitPlan применил план');
        var edits = editCalls(c);
        assert(edits.length === 1, '1: три изменившихся задания = ОДИН запрос', '(запросов правки: ' + edits.length + ')');
        assert(c.batches.length === 1, '1: и это пакет `_m_batch`', '(пакетов: ' + c.batches.length + ')');
        var ops = c.batches[0] || [];
        var ids = {};
        ops.forEach(function (op) { ids[String(op.id)] = true; });
        assert(ids.H && ids.H2 && ids.H3 && Object.keys(ids).length === 3,
            '1: в пакете ровно изменившиеся записи', '(в пакете: ' + Object.keys(ids).join(',') + ')');

        var hOps = opsOn(c, 'H');
        var iSave = -1, iSet = -1;
        ops.forEach(function (op, i) {
            if (String(op.id) !== 'H') return;
            if (op.op === 'save' && iSave < 0) iSave = i;
            if (op.op === 'set' && iSet < 0) iSet = i;
        });
        assert(iSave >= 0, '2: главное значение резки пишется операцией `save` (первая колонка — только _m_save, #775)');
        assert(iSet >= 0, '2: реквизиты резки пишутся операцией `set`');
        assert(iSave >= 0 && iSet >= 0 && iSave < iSet,
            '2: у одной резки `save` идёт ПЕРЕД её `set` — порядок операций в пакете сохранён',
            '(save@' + iSave + ', set@' + iSet + ')');
        assert(hOps.length === 2, '2: у резки ровно две операции — save и set', '(операций: ' + hOps.length + ')');
    });
}

// ── 3: «No such record» не валит действие — соседние записи применены (#3895) ─────────────────
function test3() {
    var c = makeController({ missing: ['GONE'] });
    c.cuts = c.cuts.concat([{ id: 'GONE', length: 300, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'GONE', leaders: [] }]);
    return c.applySplitPlan({
        updates: [
            { cutId: 'GONE', sequence: 1, planStartTs: 1000, plannedRuns: 5 },
            { cutId: 'H2', sequence: 2, planStartTs: 2000, plannedRuns: 3 }
        ],
        creates: [], deletes: []
    }).then(function (ok) {
        assert(ok === true, '3: пропавшая запись не валит пересборку (вернул true)');
        assert(opsOn(c, 'H2').length > 0, '3: соседнее задание всё равно применилось');
        assert(editCalls(c).length === 1, '3: и это по-прежнему ОДИН запрос', '(запросов правки: ' + editCalls(c).length + ')');
    });
}

// ── 4: #4158 — доля не возвращается в обеспечение ПРОПАВШЕЙ головы ────────────────────────────
// Схлопывание цепочки: продолжение C1 удаляется, его доля возвращается в обеспечение головы H.
function splitOps(headId) {
    return {
        updates: [{ cutId: headId, sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
        creates: [],
        deletes: ['C1']
    };
}
function supplyStand(headId) {
    return {
        cuts: [
            { id: headId, length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: headId, leaders: [] },
            { id: 'C1', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: headId, leaders: [] }
        ],
        supplies: [
            { id: 'SUP_H', cutId: headId, positionId: 'P1', rolls: 10, footage: 200, finishedBatchId: 'FB1' },
            { id: 'SUP_C1', cutId: 'C1', positionId: 'P1', rolls: 5, footage: 100, finishedBatchId: 'FB2' }
        ]
    };
}
function test4() {
    var live = makeController(supplyStand('H'));
    return live.applySplitPlan(splitOps('H')).then(function (ok) {
        assert(ok === true, '4: схлопывание цепочки применилось');
        assert(opsOn(live, 'SUP_H').length > 0,
            '4: #4158 — доля удаляемого продолжения возвращена в обеспечение ЖИВОЙ головы');

        // Та же цепочка, но головы на сервере уже нет.
        var stand = supplyStand('GONE');
        stand.missing = ['GONE'];
        var dead = makeController(stand);
        return dead.applySplitPlan(splitOps('GONE')).then(function (ok2) {
            assert(ok2 === true, '4: пропавшая голова не валит пересборку');
            assert(opsOn(dead, 'SUP_H').length === 0,
                '4: доля НЕ возвращена в обеспечение головы, которой на сервере нет — покрытие позиции не задвоено (#4158)');
        });
    });
}

// ── 5: реальная ошибка по-прежнему валит пересборку ──────────────────────────────────────────
function test5() {
    var c = makeController({ serverBoom: true });
    return c.applySplitPlan({
        updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
        creates: [], deletes: []
    }).then(function (ok) {
        assert(ok === false, '5: посторонняя ошибка (не «No such record») ловится — вернул false');
    });
}

// ── 6: #4628 — доли обеспечения по проходам звена уходят одним пакетом ────────────────────────
// Проходы перераспределяются между УЖЕ существующими звеньями (creates нет), доли расходятся
// с проходами — фаза #4628 приводит их в соответствие.
function test6() {
    var c = makeController({
        cuts: [
            { id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H', plannedRuns: 5, planDate: 1000, leaders: [] },
            { id: 'C1', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' }, batchId: 'B1', winding: 'IN', firstPartId: 'H', plannedRuns: 5, planDate: 2000, leaders: [] }
        ],
        supplies: [
            { id: 'SUP_H', cutId: 'H', positionId: 'P1', rolls: 50, footage: 500, finishedBatchId: 'FB1' },
            { id: 'SUP_C1', cutId: 'C1', positionId: 'P1', rolls: 50, footage: 500, finishedBatchId: 'FB2' }
        ]
    });
    return c.applySplitPlan({
        updates: [
            { cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 8 },
            { cutId: 'C1', sequence: 2, planStartTs: 2000, plannedRuns: 2 }
        ],
        creates: [], deletes: []
    }).then(function (ok) {
        assert(ok === true, '6: перераспределение проходов применилось');
        var supplyOps = opsOn(c, 'SUP_H').concat(opsOn(c, 'SUP_C1'));
        assert(supplyOps.length > 0, '6: #4628 — доли обеспечения приведены к проходам звена');
        // Каждая фаза — свой пакет (updates и #4628 разнесены барьером), но внутри фазы — один запрос.
        var shareBatches = c.batches.filter(function (ops) {
            return ops.some(function (op) { return String(op.id).indexOf('SUP_') === 0; });
        });
        assert(shareBatches.length === 1, '6: все доли ушли ОДНИМ пакетом', '(пакетов с долями: ' + shareBatches.length + ')');
    });
}

// ── 7: трасса пакета называет записи (#4177) ─────────────────────────────────────────────────
// Пакет адресуется без записи в пути: без перечня операций по логу видно только «была запись».
// Именно по такому логу разбирают действия планировщика — и именно так построен #4986.
// Трасса пишется в РЕАЛЬНОМ post(), поэтому здесь — реальный транспорт со стаб-fetch (как #4177),
// а не подменённый post: подмена как раз и убрала бы то, что проверяется.
function test7() {
    global.fetch = function (url, opts) {
        var ops = JSON.parse(new URLSearchParams(String((opts && opts.body) || '')).get('ops') || '[]');
        return Promise.resolve({
            ok: true, status: 200,
            text: function () {
                return Promise.resolve(JSON.stringify({
                    results: ops.map(function (o, n) { return { n: n, op: o.op, id: o.id, ok: true }; }),
                    ok: ops.length, failed: 0
                }));
            }
        });
    };
    var ctx = {
        db: 'testdb', _ppOp: 'applySplitPlan',
        root: { getAttribute: function () { return 'testdb'; } },
        url: Controller.prototype.url, post: Controller.prototype.post,
        postOps: Controller.prototype.postOps, notify: function () {}
    };
    var lines = [];
    var realLog = console.log;
    console.log = function () { lines.push(Array.prototype.map.call(arguments, String).join(' ')); };
    return ctx.postOps([
        { op: 'save', id: 'H', fields: { t100: '1000' } },
        { op: 'set', id: 'H', fields: { t193: '5' } },
        { op: 'set', id: 'H2', fields: { t193: '3' } }
    ]).then(function () {
        console.log = realLog;
        var head = lines.filter(function (l) { return /\[pp\]\[WRITE#\d+\] BATCH/.test(l); })[0] || '';
        assert(/ops=3\b/.test(head), '7: строка трассы пакета называет ЧИСЛО операций', '(строка: ' + head.slice(0, 140) + ')');
        assert(/\bVH\b/.test(head) && /\bSH\b/.test(head) && /\bSH2\b/.test(head),
            '7: и перечисляет записи, которые в него вошли', '(строка: ' + head.slice(0, 140) + ')');
    }, function (err) { console.log = realLog; throw err; });
}

test12()
    .then(test3).then(test4).then(test5).then(test6).then(test7)
    .then(function () {
        console.log('\n' + passed + '/' + total + ' проверок пройдено.');
    })
    .catch(function (err) {
        console.log('FAIL — тест бросил: ' + (err && err.stack || err));
        process.exitCode = 1;
    });
