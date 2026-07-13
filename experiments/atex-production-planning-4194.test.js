// Unit tests for #4194 — при повторном проходе (слой размещения #4085) держать задания ОДНОГО
// заказа вместе. Штраф/бонус смежности заказа ORDER_DIFF_PENALTY_MN (добавлен в «Настройку»):
//   п.1 слот встраивается МЕЖДУ двумя заданиями общего заказа, сам ему не принадлежит → штраф +10;
//   п.2 слот встраивается РЯДОМ с заданием, где есть его заказ → бонус −10 (вес может быть <0,
//       преимущество перед идентичной конфигурацией ЧУЖОГО заказа — не склеивать разные заказы).
// Применяется в scorePosition (слой размещения), т.е. только при SLOT_PLACEMENT (повторный проход).
//
// Run with: node experiments/atex-production-planning-4194.test.js

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 6, 0, 0, 0, 0).getTime();   // пн 06.07.2026
// Идентичная конфигурация (одно сырьё/ножи) → переналадки между A/B/X нет; порядок задаёт ТОЛЬКО
// штраф/бонус смежности заказа. Один станок m1, крупное окно (все на день 0).
function scut(id) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: false, planDate: '', status: '', fixed: false };
}
function runPlace(inputCuts, orderIdsByCut, orderDiffWeight) {
    return P.planCutOperations(inputCuts, {
        planBaseMidnightMs: BASE, weights: { ORDER_DIFF_PENALTY_MN: orderDiffWeight }, times: {},
        dayStartMin: 480, dayEndMin: 960, dayEndHourMin: 960, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: false, slotPlacement: true,
        firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: false,
        perPassByCut: { A: 60, B: 60, X: 60 }, slitterIds: ['m1'],
        orderIdsByCut: orderIdsByCut
    });
}
// Порядок заданий в очереди станка (по planStart).
function queueOrder(ops, ids) {
    return (ops.updates || []).filter(function (u) { return ids.indexOf(String(u.cutId)) >= 0; })
        .sort(function (a, b) { return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function (u) { return String(u.cutId); });
}
function adjacent(order, a, b) {
    var ia = order.indexOf(a), ib = order.indexOf(b);
    return ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1;
}

// A,B — заказ O1; X — заказ O2. Вход A,X,B (X разделяет пару одного заказа).
var orders = { A: { O1: true }, B: { O1: true }, X: { O2: true } };
var input = function () { return [scut('A'), scut('X'), scut('B')]; };
var IDS = ['A', 'B', 'X'];

// ── Бонус/штраф ВКЛючён (10): A и B (общий заказ O1) должны стоять РЯДОМ, X не разрывает ──────────
(function () {
    var ops = runPlace(input(), orders, 10);
    var ord = queueOrder(ops, IDS);
    assert(adjacent(ord, 'A', 'B'),
        '#4194 бонус: задания одного заказа O1 (A,B) стоят рядом при ORDER_DIFF_PENALTY_MN=10 (порядок ' + ord.join(',') + ')');
})();

// ── ORDER_DIFF_PENALTY_MN=0 (выкл): идентичная конфигурация → прежний порядок вставки [A,X,B] ──────
// (X дописывается в конец при равенстве; при штрафе=0 заказ на порядок не влияет — A,B разделены).
(function () {
    var ops = runPlace(input(), orders, 0);
    var ord = queueOrder(ops, IDS);
    assert(!adjacent(ord, 'A', 'B'),
        '#4194 выкл (=0): без штрафа заказ на порядок не влияет — A,B разделены X (порядок ' + ord.join(',') + ')');
})();

// ── Нет данных о заказах → штраф инертен (как выкл): поведение прежнее ────────────────────────────
(function () {
    var ops = runPlace(input(), {}, 10);
    var ord = queueOrder(ops, IDS);
    assert(!adjacent(ord, 'A', 'B'),
        '#4194 регресс: без orderIdsByCut штраф не применяется — порядок прежний (' + ord.join(',') + ')');
})();

// ── Мульти-заказ: X несёт И O2, И O1 (джамбо) → делит заказ с A,B → бонус, встаёт рядом, не «в конец» ─
(function () {
    var multi = { A: { O1: true }, B: { O1: true }, X: { O2: true, O1: true } };
    var ops = runPlace(input(), multi, 10);
    var ord = queueOrder(ops, IDS);
    // X делит O1 со всеми → все три «одного заказа», никакой из них не разрывает чужой; штраф не растёт.
    assert(ord.length === 3, '#4194 мультизаказ: все три задания размещены (' + ord.join(',') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
