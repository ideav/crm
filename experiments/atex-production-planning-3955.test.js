// Tests for ideav/crm#3955 — «некоторые дни не добиты под завязку (< 450 мин)».
//
// Причина: splitMachineQueue[gapFill] (пишет план) после #3939 клал настройку в хвост дня ТОЛЬКО
// если она влезает ЦЕЛИКОМ без нахлёста (setupG ≤ effCapacity−clock). Когда в хвосте оставалось,
// например, 26 мин, а следующему заданию нужна переналадка 45 (ножи 30 + сырьё 15), в хвост не
// клали НИЧЕГО — день закрывался недобитым (424 при ёмкости 450), хотя оператор успел бы сделать
// смену ножей (30) в пределах допустимого нахлёста настройки (#3847: cutEndMin + MAX_OVERWORK_TUNE).
//
// Фикс #3955/#3847: кладём в хвост ПОДМНОЖЕСТВО настройки (minOverlapTailSetupMinutes) до конца окна
// резки с минимальным нахлёстом, но ТОЛЬКО если оно кончается ≤ потолка нахлёста настройки
// (availFor 'tune'). Остаток настройки + проходы — на следующий день. День добит «под завязку» до
// допустимого нахлёста, но не раздут за него (#3939: без безграничного нахлёста, бейджа 542).
//
// Run with: node experiments/atex-production-planning-3955.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
// Окно 08:00(480)…cutEnd 16:10(970) = ёмкость 490; нахлёст резки 5, настройки 10 (потолок 16:20).
var BASE = { dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990, maxOverworkCutsMin: 5, maxOverworkTuneMin: 10,
    leader: 0, times: TIMES, gapFill: true };
var DAY1 = 1440 + 480;   // 08:00 следующего дня
function cut(id, mat, knives, runs) {
    return { id: id, materialId: mat, winding: 'IN', batchId: 'b',
        knifeCount: (knives || [30]).length, knifeWidths: (knives || [30]), isFoil: false, plannedRuns: runs };
}
function opts(extra) { var o = {}; for (var k in BASE) o[k] = BASE[k]; for (var k2 in (extra || {})) o[k2] = extra[k2]; return o; }
function bsegs(segs) { return segs.filter(function (s) { return s.cutId === 'B'; })
    .map(function (s) { return { day: s.dayOffset, setup: s.setupMin, runs: s.runs, setupOnly: !!s.setupOnly, ws: s.windowStartMin }; }); }
function dayMinutes(segs, d) { return segs.filter(function (s) { return s.dayOffset === d; })
    .reduce(function (sum, s) { return sum + (s.setupMin || 0) + (s.durationMin || 0); }, 0); }

// ── 1) #3955: хвост 26 мин, настройка B = 45 (ножи 30 + сырьё 15) → в хвост дня0 кладём ножи 30
//    (нахлёст 4 ≤ 10), остаток настройки 15 + проходы → день1. День0 добит до 494 (был бы 464). ──
(function () {
    // A: 8 проходов × 58 = 464 (настройки нет — первая резка). Остаток до cutEnd = 490−464 = 26.
    // B: другой материал (ножи 40, сырьё M2) → настройка 45; проход 20 не влезает в 26.
    var segs = planning.splitMachineQueue([cut('A', 'M1', [30], 8), cut('B', 'M2', [40], 2)],
        opts({ perPassByCut: { A: 58, B: 20 }, runsByCut: { A: 8, B: 2 } }));
    var b = bsegs(segs);
    assertEqual(b[0] && { day: b[0].day, setup: b[0].setup, runs: b[0].runs, setupOnly: b[0].setupOnly },
        { day: 0, setup: 30, runs: 0, setupOnly: true },
        '#3955: в хвост дня0 положена ЧАСТЬ настройки (ножи 30), а не пустой день');
    assertEqual(b[1] && { day: b[1].day, setup: b[1].setup, runs: b[1].runs, setupOnly: b[1].setupOnly, ws: b[1].ws },
        { day: 1, setup: 15, runs: 2, setupOnly: false, ws: DAY1 },
        '#3955: остаток настройки 15 (сырьё) + проходы B — на день1');
    var d0 = dayMinutes(segs, 0);
    assertEqual(d0, 494, '#3955: день0 добит до 494 (A 464 + хвост ножей 30), а не 464');
    assert(d0 > 490, '#3955: день0 заполнен ЗА конец окна резки (использован допустимый нахлёст)');
    assert(d0 <= 970 - 480 + 10, '#3955: день0 (' + d0 + ') ≤ cutEnd(490) + MAX_OVERWORK_TUNE(10) = 500 — нахлёст ограничен (#3847/#3939)');
})();

// ── 2) Потолок нахлёста настройки соблюдён: хвост всего 5 мин, атомарная настройка 30 (ножи) →
//    нахлёст 25 > 10, в хвост НИЧЕГО, вся B на день1 (граница с #3939 сохранена). ──
(function () {
    // A: 5 проходов × 97 = 485. Остаток до cutEnd = 5. B: только ножи (тот же материал) → настройка 30.
    var segs = planning.splitMachineQueue([cut('A', 'M', [30], 5), cut('B', 'M', [40], 1)],
        opts({ perPassByCut: { A: 97, B: 6 }, runsByCut: { A: 5, B: 1 } }));
    assert(!segs.some(function (s) { return s.cutId === 'B' && s.dayOffset === 0; }),
        '#3955/#3939: ножи 30 при остатке 5 → нахлёст 25 > 10 → в хвост дня0 ничего');
    assertEqual(bsegs(segs).map(function (s) { return { day: s.day, setup: s.setup, runs: s.runs }; }),
        [{ day: 1, setup: 30, runs: 1 }],
        '#3955/#3939: вся B — одним сегментом на день1');
})();

// ── 3) Настройка влезает ЦЕЛИКОМ до cutEnd (#3635 п.5) — как прежде: вся настройка в хвост дня0. ──
(function () {
    // A: 8 × 55 = 440. Остаток до cutEnd = 50. B: настройка 45 ≤ 50 → вся настройка в хвост, проходы день1.
    var segs = planning.splitMachineQueue([cut('A', 'M1', [30], 8), cut('B', 'M2', [40], 2)],
        opts({ perPassByCut: { A: 55, B: 20 }, runsByCut: { A: 8, B: 2 } }));
    var b = bsegs(segs);
    assertEqual(b[0] && { day: b[0].day, setup: b[0].setup, setupOnly: b[0].setupOnly },
        { day: 0, setup: 45, setupOnly: true },
        '#3635п5: настройка 45 ≤ остаток 50 → вся в хвост дня0');
    assertEqual(b[1] && { day: b[1].day, setup: b[1].setup, runs: b[1].runs },
        { day: 1, setup: 0, runs: 2 },
        '#3635п5: проходы B — с дня1 без повторной настройки (pendingSetup = 0)');
    assert(dayMinutes(segs, 0) <= 490, '#3635п5: день0 (' + dayMinutes(segs, 0) + ') ≤ ёмкости 490 (нахлёста не потребовалось)');
})();

console.log('\n' + passed + ' assertions passed');
