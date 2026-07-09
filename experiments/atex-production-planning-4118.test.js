// Тест #4118 — ДОПОЛНИТЕЛЬНЫЙ проход после планирования: всё, что ВСЁ ЕЩЁ просрочено, затолкать
// обратно в наименее штрафное место (можно на другой станок) стандартным механизмом, НЕ трогая
// остальные задания.
//
// Предыстория (issue #4118): фикс #4100 (§12-релокация по реальным дням) НЕ спас — задание всё равно
// просрочено. Причина: мягкая релокация relocatePass оценивает КАНДИДАТОВ оптимистичной оценкой дня
// (capacityMin), из-за чего «переносит вхолостую» (лог: 4 раунда / 28 переносов, 458219 за сроком) и
// оставляет реально-исправимую просрочку неисправленной.
//
// Фикс #4118: relocateOverdueReal — доп. проход, где КАЖДЫЙ кандидат проверяется РЕАЛЬНОЙ упаковкой
// (splitMachineQueue), а не оценкой. Двигаем ТОЛЬКО просроченное; принимаем перенос лишь если его
// реальный день СТРОГО меньше и ничья чужая просрочка не углубляется. Среди мест — наименьший
// реальный день, затем наименьший штраф §8.
//
// Run with: node experiments/atex-production-planning-4118.test.js

process.env.TZ = 'UTC';
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // чистая ёмкость/срок
var BASE = Date.UTC(2026, 6, 1);                 // 2026-07-01 (день 0)
var K0 = P.dayKeyFromOffset(BASE, 0);            // 20260701 — срок U
var K1 = P.dayKeyFromOffset(BASE, 1);            // 20260702

// резка-слот: wm — рабочие минуты, due — срок YYYYMMDD
function C(id, wm, due) {
    return P.slotFromCut({ id: id, materialId: 'M1', winding: 'OUT', knifeWidths: [50], knifeCount: 1,
        rollerWidth: 0, plannedRuns: 1, workMin: wm }, due);
}
function cutObj(id) { return { id: id, slitter: { id: 'x' }, materialId: 'M1', winding: 'OUT',
    knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1 }; }

// realDayFn(orderIds, machineId) → { id: dayOffset } — РЕАЛЬНЫЙ день старта каждого задания очереди
// станка реальной упаковкой splitMachineQueue (окно 100, обед/переналадки нет). perPass — минуты.
function makeRealDayFn(perPass) {
    return function (orderIds, _machineId) {
        var runs = {}; orderIds.forEach(function (id) { runs[id] = 1; });
        var segs = P.splitMachineQueue(orderIds.map(cutObj),
            { dayStartMin: 0, dayEndMin: 100, times: ZERO, perPassByCut: perPass, runsByCut: runs });
        var d = {}; segs.forEach(function (s) { var o = Number(s.dayOffset), id = String(s.cutId);
            if (d[id] == null || o < d[id]) d[id] = o; });
        return d;
    };
}

// ── 1) ВОСПРОИЗВЕДЕНИЕ + ФИКС: просроченное на полном станке уходит на свободный → в срок ───────────
(function () {
    var perPass = { A: 60, B: 60, U: 1 };
    var realDayFn = makeRealDayFn(perPass);
    // m1 забит: A,B (срок K1) держат день, крошечное U (срок K0=day0) в конце → реально переливается.
    var occ = { byMachine: { m1: [C('A', 60, K1), C('B', 60, K1), C('U', 1, K0)], m2: [] } };
    var beforeM1 = realDayFn(['A', 'B', 'U'], 'm1');
    assert(beforeM1.U > 0, '#4118 ДО доп. прохода: U (срок day0) реально на day ' + beforeM1.U + ' → просрочка');

    var ctx = { settings: {}, times: ZERO, capacityMin: 100, baseMidnightMs: BASE,
                feasibleMachine: function () { return true; } };
    var due = { A: 1, B: 1, U: 0 };
    var res = P.relocateOverdueReal(occ, due, realDayFn, ctx);

    assert(res.moves.length > 0, '#4118 доп. проход сделал перенос просроченного (переносов ' + res.moves.length + ')');
    // Пересчитать реальные дни ПОСЛЕ по фактической занятости каждого станка.
    var realNow = {};
    Object.keys(occ.byMachine).forEach(function (k) {
        var ids = occ.byMachine[k].map(function (s) { return s.id; });
        var d = realDayFn(ids, k);
        Object.keys(d).forEach(function (id) { realNow[id] = d[id]; });
    });
    assert(realNow.U <= 0, '#4118 ПОСЛЕ: U реально в срок (day ' + realNow.U + ' ≤ 0)');
    // Никто не стал БОЛЬШЕ просрочен (не навредили соседям).
    var harmed = Object.keys(realNow).filter(function (id) { return realNow[id] > due[id]; });
    assert(harmed.length === 0, '#4118 ПОСЛЕ: за сроком не осталось никого (было бы: ' + JSON.stringify(harmed) + ')');
})();

// ── 2) НИЧЕГО НЕ ПРОСРОЧЕНО → доп. проход не двигает ничего (no-op) ────────────────────────────────
(function () {
    var perPass = { A: 40, B: 40 };
    var occ = { byMachine: { m1: [C('A', 40, K0), C('B', 40, K0)], m2: [] } };
    var res = P.relocateOverdueReal(occ, { A: 0, B: 0 }, makeRealDayFn(perPass),
        { settings: {}, times: ZERO, capacityMin: 100, baseMidnightMs: BASE, feasibleMachine: function () { return true; } });
    assert(res.moves.length === 0, '#4118 всё в срок → доп. проход ничего не двигает');
})();

// ── 3) ГЕНУИННО ПОЛНО (просрочка неизбежна, некуда лучше) → no-op, не создаёт хаоса ────────────────
(function () {
    // Один станок (feasibleMachine=только m1), 3×60 при окне 100: минимум 2 дня → кто-то ЗА day0
    // неизбежно. Любой перенос, спасающий один, углубляет чужую просрочку (harms) → отклонён.
    var perPass = { A: 60, B: 60, D: 60 };
    var occ = { byMachine: { m1: [C('A', 60, K0), C('B', 60, K0), C('D', 60, K0)], m2: [] } };
    var res = P.relocateOverdueReal(occ, { A: 0, B: 0, D: 0 }, makeRealDayFn(perPass),
        { settings: {}, times: ZERO, capacityMin: 100, baseMidnightMs: BASE,
          feasibleMachine: function (tid) { return String(tid) === 'm1'; } });
    assert(res.moves.length === 0, '#4118 неизбежная просрочка (нет лучшего места) → без бессмысленных переносов');
    // m2 (недопустим) остался пуст — просроченное туда не выброшено.
    assert(occ.byMachine.m2.length === 0, '#4118 недопустимый станок не задет (m2 пуст)');
    assert(occ.byMachine.m1.length === 3, '#4118 все 3 задания на m1 (ничего не потеряно)');
})();

// ── 4) ИНТЕГРАЦИЯ через planCutOperations (живой путь slotPlacement + §12 + доп. проход #4118) ──────
(function () {
    var IBASE = new Date('2026-06-23T00:00:00').getTime();
    function icut(id, mid) { return { id: id, slitter: { id: mid }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [59], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: false }; }
    function iymd(dayoff) { var d = new Date(IBASE + dayoff * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
    function iday(ops, id) { var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
        return u ? Math.round((Number(u.planStartTs) * 1000 - IBASE) / 86400000) : null; }

    // 2 станка, окно 120 (1 задача/день по 100 мин). На m1 стоят L1,L2 (поздний срок day8) и срочное
    // U (срок day0). Проверяем ЖИВОЙ конвейер целиком (размещение → §12 → доп. проход #4118): срочное
    // остаётся в срок, а доп. проход встроен и не делает лишних переносов, когда размещение уже справилось
    // (регрессионная проверка проводки). Поведенческую суть доп. прохода несут разделы 1–3.
    // feasibleMachineFor допускает оба станка.
    var U = icut('U', 'm1'), L1 = icut('L1', 'm1'), L2 = icut('L2', 'm1');
    var pp = { U: 100, L1: 100, L2: 100 };
    var ops = P.planCutOperations([L1, L2, U], {
        weights: P.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }), times: { BETWEEN_CUTS: 0 },
        dayStartMin: 0, dayEndMin: 120, dayEndHourMin: 120, perPassByCut: pp, planBaseMidnightMs: IBASE,
        gapFill: true, slotPlacement: true, slitterIds: ['m1', 'm2'],
        feasibleMachineFor: function () { return true; },
        dueKeyByCut: { U: iymd(0), L1: iymd(8), L2: iymd(8) }, dueDayByCut: { U: 0, L1: 8, L2: 8 }
    });
    assert(iday(ops, 'U') != null && iday(ops, 'U') <= 0,
        '#4118 интеграция: срочное U (срок day0) в срок — день ' + iday(ops, 'U') + ' ≤ 0 (живой путь + доп. проход)');
})();

console.log('\n' + passed + '/' + total + ' passed');
