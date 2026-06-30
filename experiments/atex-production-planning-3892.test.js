// Tests for ideav/crm#3892 — ЯВНЫЙ «ID первой части» (голова цепочки дробления) вместо
// эвристики continuationSignature, и defect C (раздел «Связанные позиции» показывал делёный
// метраж обеспечения сегмента, напр. 348.496, вместо реальной длины прогона 450).
//
// Что проверяем:
//   1. mergeContinuationChains группирует сегменты по ЯВНОМУ firstPartId (а не по сигнатуре):
//      1a — голова + продолжение с одинаковым маркером сливаются в одну логическую резку;
//      1b — два РАЗНЫХ заказа одной конфигурации в смежные дни (которые эвристика СКЛЕИЛА бы)
//           с разными маркерами НЕ сливаются;
//      1c — записи без маркера (легаси) сливаются прежней эвристикой (поведение сохранено);
//      1d — смешанный набор (маркер + легаси) обрабатывается независимо.
//   2. planCutOperations проставляет firstPartId = id головы на голову (=своя) и продолжения.
//   3. applySplitPlan пишет «ID первой части» (t196458-аналог) на голову (update) и продолжение
//      (create); при отсутствии firstPartId в ops — фолбэк на голову цепочки/собственный id.
//   4. cutRunLength (источник метража для «Связанных позиций») возвращает длину прогона головы
//      (450), игнорируя делёную долю обеспечения сегмента (348.496) — корень defect C.
//
// Run with: node experiments/atex-production-planning-3892.test.js

process.env.TZ = 'UTC';

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Часть 1 + 2 + 4: чистые функции planning.
// ─────────────────────────────────────────────────────────────────────────────
var planning = require('../download/atex/js/production-planning.js').planning;
var mergeContinuationChains = planning.mergeContinuationChains;
var planCutOperations = planning.planCutOperations;
var cutRunLength = planning.cutRunLength;

var DAY = 86400;   // секунда-смещение смежного дня (planDate в секундах)
function widths(pairs) { var o = []; pairs.forEach(function(pr) { for (var i = 0; i < pr[1]; i++) o.push(pr[0]); }); return o; }
// Резка для mergeContinuationChains: одинаковая сигнатура у X/Y (material/winding/knives),
// различает их только firstPartId. planDate в секундах (день = planDate/86400).
function ch(id, firstPartId, dayOffset, runs) {
    return {
        id: id, firstPartId: firstPartId,
        slitter: { id: 'S1' }, materialId: 'M7', winding: 'OUT',
        knifeWidths: widths([[59, 16]]), knifeCount: 16,
        plannedRuns: runs == null ? 1 : runs,
        planDate: String(1780963200 + dayOffset * DAY), orderId: 'O' + id
    };
}

// ── 1a: явная цепочка (голова H + продолжение B, один маркер 'H') сливается в одну логическую.
(function () {
    var m = mergeContinuationChains([ ch('H', 'H', 0, 10), ch('B', 'H', 1, 5) ]);
    assertEqual(m.chainByLogical, { H: ['H', 'B'] }, '1a: цепочка по маркеру — голова H, продолжение B');
    assertEqual(m.cuts.length, 1, '1a: одна логическая резка');
    assertEqual(m.cuts[0].plannedRuns, 15, '1a: проходы цепочки суммируются (10+5)');
    assertEqual(m.deletes, ['B'], '1a: продолжение B помечено на удаление при пере-разбиении');
})();

// ── 1b: два РАЗНЫХ заказа одной конфигурации в смежные дни. Эвристика continuationSignature
//        склеила бы их в одну цепочку; явные разные маркеры (каждый ссылается на себя) — нет.
(function () {
    var m = mergeContinuationChains([ ch('X', 'X', 0, 3), ch('Y', 'Y', 1, 4) ]);
    assertEqual(m.chainByLogical, { X: ['X'], Y: ['Y'] }, '1b: разные маркеры — две раздельные цепочки (НЕ склеены)');
    assertEqual(m.cuts.length, 2, '1b: две логические резки');
    assertEqual(m.deletes, [], '1b: ничего не удаляется (это не продолжения)');
})();

// ── 1c: легаси (нет firstPartId) — прежняя эвристика (сигнатура + смежные дни) сливает.
(function () {
    var a = ch('A', '', 0, 7); var b = ch('Acont', '', 1, 3);
    var m = mergeContinuationChains([ a, b ]);
    assertEqual(m.chainByLogical, { A: ['A', 'Acont'] }, '1c: легаси-эвристика сливает смежные дни одной сигнатуры');
    assertEqual(m.cuts[0].plannedRuns, 10, '1c: проходы суммируются (7+3)');
    assertEqual(m.deletes, ['Acont'], '1c: продолжение на удаление');
})();

// ── 1d: смешанно — явная цепочка H/B + одиночная легаси-резка L другой конфигурации.
(function () {
    var L = { id: 'L', firstPartId: '', slitter: { id: 'S1' }, materialId: 'M9', winding: 'IN',
        knifeWidths: widths([[100, 2]]), knifeCount: 2, plannedRuns: 2, planDate: String(1780963200), orderId: 'OL' };
    var m = mergeContinuationChains([ ch('H', 'H', 0, 10), ch('B', 'H', 1, 5), L ]);
    assertEqual(m.chainByLogical, { H: ['H', 'B'], L: ['L'] }, '1d: явная цепочка и легаси-одиночка независимы');
    assertEqual(m.deletes, ['B'], '1d: на удаление только продолжение явной цепочки');
})();

// ── 2: planCutOperations при дроблении даёт продолжения с parentCutId = головой. Контракт ops
//       НЕ расширяем (строгие сравнения в #3280/#3427) — «ID первой части» applySplitPlan выводит
//       из parentCutId (create) / chainHeadById (update), что и проверяет часть 3.
function pcut(id, material, knifeWidths, runs, sequence) {
    return { id: id, slitter: { id: 'm3' }, materialId: material, winding: 'OUT',
        knifeWidths: knifeWidths, knifeCount: knifeWidths.length, plannedRuns: runs,
        planDate: '1780963200', sequence: sequence };
}
(function () {
    // A(15 проходов × 10 мин = 150 > день 100) дробится: голова сегодня + продолжение.
    var ops = planCutOperations(
        [ pcut('A', 'MW308', widths([[152, 6]]), 15, 1) ],
        { perPassByCut: { A: 10 }, dayStartMin: 0, dayEndMin: 100,
          times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: 1780963200000, preserveOrder: true }
    );
    var aHead = ops.updates.filter(function (u) { return u.cutId === 'A'; })[0];
    assert(aHead && aHead.firstPartId === undefined, '2: контракт ops НЕ изменён (firstPartId в ops не кладём)');
    assert(ops.creates.length >= 1, '2: A не влезла в день → есть продолжение');
    assert(ops.creates.every(function (c) { return c.parentCutId === 'A'; }),
        '2: продолжение(я) ссылаются на голову A (parentCutId) — отсюда applySplitPlan берёт «ID первой части»');
})();

// ── 4: cutRunLength = длина прогона головы (cut.length=450), а НЕ делёная доля обеспечения
//       сегмента (footage 348.496). Это значение «Связанные позиции» теперь и показывают.
(function () {
    var headCut = { id: 'C1', length: 450 };
    var supplies = [{ id: 'SUP', cutId: 'C1', footage: 348.496 }];   // делёная доля сегмента (#3280)
    assertEqual(cutRunLength(headCut, supplies, {}), 450,
        '4: cutRunLength игнорирует делёную долю обеспечения (348.496) → реальные 450 (defect C)');
})();

// ─────────────────────────────────────────────────────────────────────────────
// Часть 3: applySplitPlan пишет «ID первой части» на голову и продолжение (реальный writer).
// ─────────────────────────────────────────────────────────────────────────────
global.window = { db: 'testdb', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

function meta(id, pairs) {
    return { id: String(id), reqs: pairs.map(function (p) { return { id: String(p[0]), val: p[1] }; }) };
}
var FP = '188';   // «ID первой части» (произвольный id; важно имя)
var cutMeta = meta(100, [
    ['190', 'Вид сырья'], ['191', 'Слиттер'], ['192', 'Партия сырья'], ['193', 'Кол-во план'],
    ['194', 'Статус'], ['195', 'Очередность'], ['196', 'Тип намотки'], ['198', 'Лидер'],
    ['197', 'Метраж, м'], ['199', 'Длительность, минут'], [FP, 'ID первой части']
]);
var fbMeta = meta(200, [['201', 'Ширина, мм'], ['202', 'Кол-во полос'], ['203', 'Кол-во рулонов'],
    ['204', 'Кол-во план'], ['205', 'В работе']]);
var supMeta = meta(300, [['301', 'Метраж, м'], ['302', 'Кол-во рулонов'], ['303', 'В работе'],
    ['304', 'Статус'], ['305', 'Партия ГП']]);

function makeController() {
    var root = { getAttribute: function () { return 'testdb'; } };
    var c = new Controller(root);
    c.meta.cut = cutMeta; c.meta.finishedBatch = fbMeta; c.meta.supply = supMeta;
    c.cuts = [{ id: 'H', length: 450, materialId: 'M7', status: 'В работе', slitter: { id: 'S1' },
        batchId: 'B1', winding: 'IN', leaders: [] }];
    c.supplies = [{ id: 'SUP1', cutId: 'H', rolls: 8, footage: 450, finishedBatchId: 'FB1', positionId: 'P1' }];
    c.footageBySupply = {};
    c._posts = [];
    var idc = 0;
    c.post = function (path, params) { c._posts.push({ path: path, params: params || {} }); return Promise.resolve({ obj: 'NEW' + (++idc) }); };
    c.loadStripsForCut = function () { return Promise.resolve([]); };
    c.resolveLeaderId = function () { return ''; };
    c.reload = function () { return Promise.resolve(); };
    c.persistCutSetupColumns = function () { return Promise.resolve(); };
    c.setBusy = function () {}; c.showProgress = function () {}; c.updateProgress = function () {};
    c.hideProgress = function () {}; c.render = function () {}; c.notify = function () {};
    return c;
}

var tFP = 't' + FP;
// 3a: ops с явным firstPartId — голова и продолжение получают t188 = 'H'.
var c1 = makeController();
c1.applySplitPlan({
    updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5, firstPartId: 'H' }],
    creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 2000, plannedRuns: 3, firstPartId: 'H' }],
    deletes: []
}).then(function () {
    var upd = c1._posts.filter(function (p) { return p.path === '_m_set/H?JSON'; });
    assert(upd.length === 1 && String(upd[0].params[tFP]) === 'H',
        '3a: обновление головы пишет «ID первой части» = H (ссылка на себя)');
    var cre = c1._posts.filter(function (p) { return p.path === '_m_new/100?JSON&up=1'; });
    assert(cre.length === 1 && String(cre[0].params[tFP]) === 'H',
        '3a: создаваемое продолжение пишет «ID первой части» = H (голова цепочки)');

    // 3b: ops БЕЗ firstPartId — фолбэк: голова → собственный id, продолжение → parentId.
    var c2 = makeController();
    return c2.applySplitPlan({
        updates: [{ cutId: 'H', sequence: 1, planStartTs: 1000, plannedRuns: 5 }],
        creates: [{ parentCutId: 'H', sequence: 2, planStartTs: 2000, plannedRuns: 3 }],
        deletes: []
    }).then(function () {
        var upd2 = c2._posts.filter(function (p) { return p.path === '_m_set/H?JSON'; });
        assert(upd2.length === 1 && String(upd2[0].params[tFP]) === 'H',
            '3b: без firstPartId голова всё равно получает маркер = H (фолбэк chainHeadById/own id)');
        var cre2 = c2._posts.filter(function (p) { return p.path === '_m_new/100?JSON&up=1'; });
        assert(cre2.length === 1 && String(cre2[0].params[tFP]) === 'H',
            '3b: без firstPartId продолжение получает маркер = H (фолбэк на parentId)');
        console.log('\n' + passed + ' assertions passed.');
    });
}).catch(function (err) {
    console.log('FAIL — applySplitPlan бросил: ' + (err && err.stack || err));
    process.exitCode = 1;
});
