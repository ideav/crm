// Тест #4098 — просрочка от оптимистичной оценки дня; чиним ЧЕСТНОЙ ценой срока (без костылей).
//
// Слой размещения оценивает день приземления эвристикой capacityMin, реальный день даёт
// splitMachineQueue (арбитр §12). Задание 440804 (0.592 мин, срок 20260701=day0) оценивалось в
// day0 («в притык», exactDeadline +33), но реальная упаковка переливала его на day1 → просрочка.
// Штраф опоздания DEADLINE(+200 в потолок) за реальный day1 при этом НЕ начислялся (оценка видела
// day0), а мягкая §12-релокация двигает лишь «строго дешевле» → не спасала.
//
// Фикс (только штрафы): при оценке цены «ОСТАТЬСЯ» в релокации срок считаем по РЕАЛЬНОМУ дню
// (ctx.selfRealDayKey из splitMachineQueue). Тогда просроченное реально стоит DEADLINE, и штатный
// выбор самого дешёвого места сам уводит его в срок (день в срок дешевле штрафа опоздания).
// Плюс единственное исключение: не двигаем срочное задание НА место за сроком (вернётся штрафом).
//
// Run with: node experiments/atex-production-planning-4098.test.js

process.env.TZ = 'UTC';
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // без переналадки — чистая ёмкость/срок
var BASE = Date.UTC(2026, 6, 1);                 // 2026-07-01 (день 0)
var K0 = P.dayKeyFromOffset(BASE, 0);            // 20260701 — срок U
var K1 = P.dayKeyFromOffset(BASE, 1);            // 20260702 — реальный день перелива
// резка-слот: wm — рабочие минуты (для оценки дня), due — срок YYYYMMDD
function C(id, wm, due) {
    return P.slotFromCut({ id: id, materialId: 'M1', winding: 'OUT', knifeWidths: [50], knifeCount: 1,
        rollerWidth: 0, plannedRuns: 1, workMin: wm }, due);
}
function cutObj(id) { return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
    knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1 }; }
// реальные дни очереди (мин dayOffset сегментов) реальной упаковкой splitMachineQueue (окно 100)
function packReal(orderIds, perPass) {
    var segs = P.splitMachineQueue(orderIds.map(cutObj),
        { dayStartMin: 0, dayEndMin: 100, times: ZERO, perPassByCut: perPass,
          runsByCut: { A: 1, B: 1, U: 1 } });
    var d = {}; segs.forEach(function (s) { var o = Number(s.dayOffset), id = String(s.cutId);
        if (d[id] == null || o < d[id]) d[id] = o; });
    return d;
}

// ── 1) ЧЕСТНАЯ цена срока: scorePosition по РЕАЛЬНОМУ дню (за срок) дороже, чем по ОЦЕНКЕ (в притык) ─
(function () {
    // U (срок K0) на позиции, которую ОЦЕНКА (ёмкость 200) видит в day0 → «в притык» exactDeadline +33
    var arr = [C('A', 60, K1), C('B', 60, K1)];
    var ctxEst = { settings: {}, times: ZERO, capacityMin: 200, baseMidnightMs: BASE, slitterId: 'm1' };
    var scEst = P.scorePosition(arr, 2, C('U', 1, K0), ctxEst);
    // тот же слот, но цену «остаться» считаем по РЕАЛЬНОМУ дню day1 (K1) → опоздание DEADLINE (потолок)
    var scReal = P.scorePosition(arr, 2, C('U', 1, K0),
        { settings: {}, times: ZERO, capacityMin: 200, baseMidnightMs: BASE, slitterId: 'm1', selfRealDayKey: K1 });
    assert(scEst.byFactor.exactDeadline === 33 && !scEst.byFactor.deadline,
        '#4098 оценка (day0): «в притык» exactDeadline +33, штрафа опоздания нет');
    assert(scReal.byFactor.deadline === 100 && !scReal.byFactor.exactDeadline,
        '#4098 реальный день (day1): опоздание DEADLINE +100 (потолок), не «в притык»');
    assert(scReal.weight > scEst.weight, '#4098 честная цена «остаться» за сроком ДОРОЖЕ оценки в притык');
})();

// ── 2) ИНТЕГРАЦИЯ: оптимистичная оценка (bug #4098) → релокация штатно уводит просроченное в срок ──
(function () {
    var perPass = { A: 60, B: 60, U: 1 };
    // размещение поставило крошечное U последним, за A,B (как 440804 на поз 14)
    var occ = { byMachine: { m1: [C('A', 60, K1), C('B', 60, K1), C('U', 1, K0)] } };
    var before = packReal(['A', 'B', 'U'], perPass);
    assert(before.U > 0, '#4098 инт.: ДО фикса U (срок day0) реально на day ' + before.U + ' → просрочка');
    // ОПТИМИСТИЧНАЯ оценка порядка: ёмкость 200 → оценка видит всех в day0 (воспроизводит баг);
    // арбитр срока — реальные дни before (splitMachineQueue). Веса дефолтные (DEADLINE 100 > переналадки).
    var ctx = { settings: {}, times: ZERO, capacityMin: 200, baseMidnightMs: BASE,
                dueDayByCut: { A: 1, B: 1, U: 0 }, feasibleMachine: function () { return true; } };
    var rel = P.relocatePass(occ, before, ctx);
    var order = occ.byMachine.m1.map(function (s) { return s.id; });
    var after = packReal(order, perPass);
    assert(rel.moves.length > 0, '#4098 инт.: релокация сделала перенос (просроченное дешевле в срок)');
    assert(after.U <= 0, '#4098 инт.: ПОСЛЕ фикса U реально в срок (day ' + after.U + ' ≤ срок 0)');
    assert(after.A <= 1 && after.B <= 1, '#4098 инт.: A,B (срок day1) не просрочены — не срочное уступило день');
})();

// ── 3) ГАРАНТИЯ: после релокации НИ ОДНО срочное задание не стоит за своим сроком ─────────────────
(function () {
    var perPass = { A: 60, B: 60, U: 1 };
    var occ = { byMachine: { m1: [C('A', 60, K1), C('B', 60, K1), C('U', 1, K0)] } };
    var ctx = { settings: {}, times: ZERO, capacityMin: 200, baseMidnightMs: BASE,
                dueDayByCut: { A: 1, B: 1, U: 0 }, feasibleMachine: function () { return true; } };
    P.relocatePass(occ, packReal(['A', 'B', 'U'], perPass), ctx);
    var after = packReal(occ.byMachine.m1.map(function (s) { return s.id; }), perPass);
    var due = { A: 1, B: 1, U: 0 };
    var overdue = Object.keys(after).filter(function (id) { return after[id] > due[id]; });
    assert(overdue.length === 0, '#4098 гарантия: за сроком не осталось никого (было бы: ' + JSON.stringify(overdue) + ')');
})();

// ── 4) ИСКЛЮЧЕНИЕ: не в срок / без срока не трогаем, штрафом за срок не двигаем зря ────────────────
(function () {
    // всё реально в срок → релокации быть не должно (нет ни просрочки, ни фольги)
    var occ = { byMachine: { m1: [C('A', 40, K0), C('B', 40, K0)] } };
    var rel = P.relocatePass(occ, { A: 0, B: 0 },
        { settings: {}, times: ZERO, capacityMin: 200, baseMidnightMs: BASE, dueDayByCut: { A: 0, B: 0 } });
    assert(rel.moves.length === 0, '#4098 всё в срок → релокация ничего не двигает');
})();

console.log('\n' + passed + '/' + total + ' passed');
