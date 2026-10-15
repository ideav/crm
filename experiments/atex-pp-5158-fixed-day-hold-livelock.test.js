// #5158 — упаковщик не вправе зациклиться на дне, который держит 🔒.
//
// Правило #4434 п.1: с дня не уходим, пока на нём остались неразмещённые 🔒 этого дня; отказ
// уйти помечает день (forceFixedDay), и следующий выбор обязан взять 🔒 ВПЕРЁД продолжений и
// свободных — иначе тот же кандидат выбирается снова. Пул «взять 🔒 вперёд» (fixedNow) не
// содержит 🔒, приколотую ручным переносом «в конец дня» (#4464: её держат до последнего). Когда
// день полон, такая 🔒 и держала день (fixedPendingOn), и в выбор не попадала: продолжение
// «целиком на следующий день» → уйти нельзя → снова то же продолжение — до предохранителя
// guardMax. Всё, что не легло к этому моменту, уходило в unplaced (#4645), и страж записи
// отклонял каждый план (ateh 15.10.2026, симуляция #5158: ~1.3 млн выборов дня 19.10 при
// fixedToday=[960780], fixedNow=[], force=true).
//
// Run with: node experiments/atex-pp-5158-fixed-day-hold-livelock.test.js

process.env.TZ = 'UTC';
global.window = { db: 'ateh1', xsrf: 'x' };
var api = require('../download/atex/js/production-planning.js');
var P = api.planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 9, 19, 0, 0, 0, 0).getTime();    // пн 19.10.2026 = день 0
var D0 = Math.round(BASE / 1000) + 8 * 3600;               // день 0, 08:00
function W(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cut(id, mat, knives, min, runs, fixed) {
    return { id: id, slitter: { id: '1' }, materialId: mat, winding: 'OUT', batchId: 'B' + mat,
             knifeWidths: W(knives[0], knives[1]), knifeCount: knives[1], rollerWidth: 0,
             plannedRuns: runs, isFoil: false, planDate: String(D0 + min * 60), status: '',
             fixed: !!fixed, firstPartId: id };
}
function planOps(cuts, extra) {
    var pp = {}; cuts.forEach(function (c) { pp[String(c.id)] = 3; });
    var anchor = {};
    cuts.forEach(function (c) {
        if (!c.fixed) return;
        anchor[String(c.id)] = Math.floor((Number(c.planDate) * 1000 - BASE) / 86400000);
    });
    var o = { planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 480 + 450, dayEndHourMin: 480 + 450,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        gapFill: true, preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true, perPassByCut: pp, slitterIds: ['1'],
        dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: anchor };
    for (var k in (extra || {})) o[k] = extra[k];
    return P.planCutOperations(cuts, o);
}
function unplacedOf(ops) {
    return ((ops && ops.unplaced) || []).map(function (u) { return u.cutId + '(' + u.runs + ')'; });
}

// ── 1. День 0: длинное свободное L (200 проходов по 3 мин — две с лишним смены) и 🔒 M,
//       приколотая «в конец дня». L переливается через потолок дня 0 продолжением, M обязана
//       лечь на свой день, а упаковщик — разместить ВСЕ проходы. ───────────────────────────────
(function () {
    var cuts = [cut('L', 'MA', [30, 29], 0, 200), cut('M', 'MB', [150, 7], 300, 4, true)];
    var t0 = Date.now();
    var ops = planOps(cuts, { pinDayPosByCut: { M: 'end' } });
    var ms = Date.now() - t0;
    var lost = unplacedOf(ops);
    assert(lost.length === 0, '#5158: упаковщик разместил все проходы — ничего не ушло в unplaced',
        'unplaced=[' + lost.join(', ') + '], ' + ms + ' мс');
    var mDay = null;
    (ops.updates || []).concat(ops.creates || []).forEach(function (u) {
        if (String(u.cutId) === 'M' && u.planStartTs != null) mDay = Math.floor((Number(u.planStartTs) * 1000 - BASE) / 86400000);
    });
    if (mDay == null) mDay = 0;   // запись не менялась — стоит на хранимом дне 0
    assert(mDay === 0, '#5158: 🔒 «в конец дня» осталась на своём дне', 'день=' + mDay);
    var lStart = null, mStart = null;
    (ops.updates || []).forEach(function (u) {
        if (String(u.cutId) === 'L') lStart = Number(u.planStartTs);
        if (String(u.cutId) === 'M') mStart = Number(u.planStartTs);
    });
    assert(lStart != null && mStart != null && mStart > lStart,
        '#5158: 🔒 «в конец дня» встала ПОСЛЕ головы L, а не в начало дня', 'L=' + lStart + ' M=' + mStart);
})();

// ── 2. Контроль: та же 🔒 без приколки («по весу») — прежнее поведение, всё размещено. ─────
(function () {
    var cuts = [cut('L', 'MA', [30, 29], 0, 200), cut('M', 'MB', [150, 7], 300, 4, true)];
    var lost = unplacedOf(planOps(cuts));
    assert(lost.length === 0, '#5158: 🔒 без приколки — всё размещено, как и раньше',
        'unplaced=[' + lost.join(', ') + ']');
})();

console.log('Итог: ' + passed + '/' + total);
