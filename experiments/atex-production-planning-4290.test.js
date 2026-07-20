// #4290 — «Большое задание просрочено: та часть, что не влезла. Надо сдвигать раньше, пока ВСЕ
// части не влезут в срок». РАЗБИТОЕ по дням задание: голова влезает в срок, ХВОСТ намотки
// переливается на следующий день ЗА срок. Арбитр §12/#4118 (relocateOverdueReal / realDaysFrom →
// windingDaysFromSegs) брал МИН (СТАРТОВЫЙ) день намотки → задание числилось «в срок» по дню
// головы и раньше НЕ сдвигалось; хвост оставался просроченным (панель #4161 при этом считает по
// planDate хвоста-продолжения и показывает просрочку — расхождение).
//
// Фикс #4290: реальный день = ПОСЛЕДНИЙ (МАКС) день намотки = ДЕНЬ ЗАВЕРШЕНИЯ. Разбитое задание
// «в срок», лишь когда готова последняя часть → арбитр видит перелив и уводит задание раньше
// (на свободный станок / раньше по дням), пока все части не встанут в срок.
//
// Run: node experiments/atex-production-planning-4290.test.js   (PP_TRACE=1 — трасса)
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
             length: 100, planDate: String(planOrderTs), status: '', fixed: !!opt.fixed };
}
// день КАЖДОГО сегмента (updates + creates) резки — ловим и ПРОДОЛЖЕНИЕ намотки (не только голову).
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
        times: { MATERIAL_WINDING: 0, KNIFE: 0, KNIFE_MOVE: 0, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 0 },
        dayStartMin: 480, dayEndMin: 540, dayEndHourMin: 540, maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true, preserveOrder: true,
        firstCutSetup: false, prevSetupBySlitter: {}, intraDayResequence: false, slotPlacement: false
    };
    Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    return o;
}

// ── Сценарий: БОЛЬШОЕ задание BIG (срок день1) требует 2 дней намотки. День0 станка m1 забит
// филлером (60 мин = вся смена), поэтому BIG в порядке очереди m1 стартует с дня1 → намотка
// день1 (2 прохода) + день2 (1 проход, ХВОСТ ЗА СРОК). Свободный m2 того же сырья: BIG целиком
// влезает день0+день1 (завершение день1 = срок). Баг: арбитр по дню СТАРТА (день1) числит BIG
// «в срок» → не сдвигает → хвост в день2 (просрочено). Фикс: арбитр по дню ЗАВЕРШЕНИЯ (день2 >
// срок) → уводит BIG на m2 → завершение день1, в срок.
(function () {
    var base = midnight(2026, 7, 1);   // ср 01.07 = день0; день1 = 02.07, день2 = 03.07
    var cuts = [];
    var far = ymd(2026, 7, 31);
    var due = {}, dueKey = {}, perPass = {};
    function add(id, mach, ord, o) {
        o = o || {}; cuts.push(scut(id, mach, base + ord, o));
        due[id] = o.due != null ? o.due : 30; dueKey[id] = o.dk || far; perPass[id] = o.pp || 30;
    }
    // m1 день0: филлер FILL (2×30 = 60 мин = вся смена), далёкий срок.
    add('FILL', 'm1', 1, { mat: 'A', runs: 2, pp: 30 });
    // m1 после филлера: BIG — 3 прохода × 25 = 75 мин > 60 (день) ⇒ разбивается на 2 дня; срок день1.
    add('BIG', 'm1', 2, { mat: 'A', runs: 3, pp: 25, due: 1, dk: ymd(2026, 7, 2) });

    console.log('\n=== Сценарий #4290 (разбитое BIG: хвост за срок, свободный m2) ===');
    var ops = P.planCutOperations(cuts, baseOpts(base, {
        perPassByCut: perPass, slitterIds: ['m1', 'm2'],
        dueDayByCut: due, dueKeyByCut: dueKey
    }));
    var bigDays = segDaysOf(ops, base, 'BIG');
    console.log('   BIG сегменты по дням: ' + JSON.stringify(bigDays) + '  overdue: ' + JSON.stringify(overdueIds(ops)));
    assert(bigDays.length > 0 && Math.max.apply(null, bigDays) <= 1,
        '#4290: ВСЕ части BIG (срок день1) завершаются ≤ день1 — max день сегментов ' +
        (bigDays.length ? Math.max.apply(null, bigDays) : '?') + ' ≤ 1 (арбитр увёл разбитое задание раньше)');
    assert(overdueIds(ops).indexOf('BIG') < 0,
        '#4290: BIG НЕ числится просроченным в ops.overdue после фикса');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
