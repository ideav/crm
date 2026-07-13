// #4209 — «после ручного перемещения та же просрочка, как в прошлый раз» (реопен #4203/#4200).
// РЕАЛЬНАЯ причина (лог v118.31 + output.28.xlsx, заказ 3950 MWR200/IN срок 03.07):
//   • 547280 — Станок 4, 03.07 15:39, «Резка и Лидер»=0 → сегмент НАСТРОЙКИ (#3889, setupOnly, 0 проходов);
//   • 549210 — Станок 4, 06.07 08:00, намотка (23 мин) — ПРОДОЛЖЕНИЕ за выходные (день5).
// splitMachineQueue кладёт хвост-настройку в день N (setupOnly, runs:0) и НАМОТКУ в день N+k (10-planning-
// engine.js ~2886/2904). realDaysFrom/realPackFn берут МИН календарный день ПО ВСЕМ сегментам, включая
// setupOnly → резка числится «день2 (настройка), в срок», рескью #4118 её НЕ видит (лог: «осталось за
// срок 0»), а панель (#4161, planDate ПРОДОЛЖЕНИЯ) показывает просрочку. Итог: рескью слеп к переливу
// намотки за срок. Фикс: срок считать по дню ФАКТИЧЕСКОЙ намотки (сегменты setupOnly!==true).
//
// Run: node experiments/atex-production-planning-4209.test.js   (PP_TRACE=1 — трасса)
globalThis.PP_TRACE_PLACEMENT = (process.env.PP_TRACE === '1');

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function midnight(y, m, d) { return new Date(y, m - 1, d, 0, 0, 0, 0).getTime(); }
function ymd(y, m, d) { return y * 10000 + m * 100 + d; }
function scut(id, machine, planOrderTs, opt) {
    opt = opt || {};
    return { id: id, orderId: 'O_' + id, slitter: { id: machine }, materialId: opt.mat || 'A', winding: opt.wind || 'OUT',
             knifeWidths: opt.kw || [50], knifeCount: 1, rollerWidth: 0, plannedRuns: opt.runs || 1, isFoil: false,
             length: 100, planDate: String(planOrderTs), status: '', fixed: false };
}
// день КАЖДОГО сегмента (updates + creates) резки — чтобы поймать ПРОДОЛЖЕНИЕ намотки (не только голову).
function segDaysOf(ops, base, id) {
    var days = [];
    (ops.updates || []).concat(ops.creates || []).forEach(function (x) {
        if (String(x.cutId) === String(id) || String(x.parentCutId || '') === String(id))
            days.push(Math.floor((Number(x.planStartTs) * 1000 - base) / 86400000));
    });
    return days;
}
function overdueIds(ops) { return (ops.overdue || []).map(function (o) { return String(o.cutId); }); }
function baseOpts(base, extra) {
    var o = {
        planBaseMidnightMs: base, weights: {},
        times: { MATERIAL_WINDING: 15, KNIFE: 30, KNIFE_MOVE: 0, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
        dayStartMin: 480, dayEndMin: 540, dayEndHourMin: 540, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: true,
        firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: false, slotPlacement: false
    };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

// ── Scenario: заказ 3950 — намотка X переливается за выходные (setup день2 → намотка день5) ───────────
// База ср 01.07 (день0). Дни 3,4 = сб/вс (04–05.07) заблокированы ⇒ перелив дня2(пт 03.07) → день5(пн 06.07).
// Окно 60 мин. m1: дни 0,1 забиты 'A' (по 2×25), день2: A0(25, mat A) + X(срок день2, mat B, ножи 60 —
// смена сырья 15 + ножи 30 = setup 45; влезает лишь хвост-настройка 30, намотка 1×25 → день5). m2 — СВОБОДЕН
// и того же 'B' сырья: X ЦЕЛИКОМ влезает день2 в срок. Баг: рескью НЕ видит перелив (день2 по настройке),
// X остаётся с намоткой в день5 (просрочено). Фикс: рескью видит намотку в день5 → уводит X на m2 в срок.
(function () {
    var base = midnight(2026, 7, 1);
    var cuts = [];
    var far = ymd(2026, 7, 31), d2 = ymd(2026, 7, 3);
    var due = {}, dueKey = {}, perPass = {};
    function add(id, mach, ord, o) {
        o = o || {}; cuts.push(scut(id, mach, base + ord, o));
        due[id] = o.due != null ? o.due : 25; dueKey[id] = o.dk || far; perPass[id] = o.pp || 25;
    }
    // m1 дни 0,1: 4 резки 'A' (2/день), далёкий срок.
    add('A0', 'm1', 1, { mat: 'A' }); add('A1', 'm1', 2, { mat: 'A' });
    add('A2', 'm1', 3, { mat: 'A' }); add('A3', 'm1', 4, { mat: 'A' });
    // m1 день2: A4 (25, mat A) заполняет начало; X (mat B, ножи 60, срок день2) → хвост-настройка + намотка день5.
    add('A4', 'm1', 5, { mat: 'A' });
    add('X',  'm1', 6, { mat: 'B', kw: [60], wind: 'IN', due: 2, dk: d2, pp: 25, runs: 1 });
    // m2 — свободен, того же 'B': X целиком влезает в срок (день2 или раньше).
    console.log('\n=== Scenario #4209 (setup день2 → намотка день5, свободный m2) ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey,
        blockedRangesBySlitter: { m1: [[3 * 1440, 5 * 1440]], m2: [[3 * 1440, 5 * 1440]] }
    }));
    var xdays = segDaysOf(ops, base, 'X');
    console.log('   X сегменты по дням: ' + JSON.stringify(xdays) + '  overdue: ' + JSON.stringify(ops.overdue));
    assert(xdays.length > 0 && Math.max.apply(null, xdays) <= 2,
        '#4209: намотка X (срок день2) НЕ переливается за срок — max день сегментов ' +
        (xdays.length ? Math.max.apply(null, xdays) : '?') + ' ≤ 2 (рескью увёл на свободный станок)');
    assert(overdueIds(ops).indexOf('X') < 0,
        '#4209: X НЕ числится просроченным в ops.overdue после фикса');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
