// Tests for ideav/crm#3939 (+ #3934) — «оверворк»: день не должен вылезать за ёмкость.
//
// Причина (журнал PP_TRACE + выгрузка из issue): при почти полном дне splitMachineQueue[gapFill]
// клал в ХВОСТ дня сегмент настройки (setup-only) с НАХЛЁСТОМ за конец окна. Его минуты попадали
// в бейдж дня (02.07 = 448 резок + 47 + 47 двух хвостов = 542 при ёмкости ~460), а при наличии
// простоя («Отпуск») applyDowntime ещё и выталкивал хвост на начало следующего дня («настройка в
// начале дня», #3934).
//
// Фикс #3939: настройку в хвост дня кладём, ТОЛЬКО если она ЦЕЛИКОМ влезает до конца рабочего окна
// (effCapacity−clock, БЕЗ нахлёста). Не влезает — в хвост НИЧЕГО, вся резка на следующий день ОДНОЙ
// карточкой. День больше не вылезает за ёмкость, и нет отдельной «настройки в начале дня».
//
// Run with: node experiments/atex-production-planning-3939.test.js

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
// Окно 08:00(480)…cutEnd 16:10(970) = ёмкость 490; нахлёст резки 5, настройки 10.
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

// ── 1) День почти полон → настройка не влезает → вся резка на след. день (без хвоста, без оверворка) ──
// A (p97×5=485) заполняет день0 до 16:05 (остаток до конца окна ≈ 5). B — та же намотка/сырьё,
// ДРУГИЕ ножи → настройка 30 (атомарная). 30 > 5 → в хвост НИЧЕГО, вся B на день1 одним сегментом.
(function () {
    var segs = planning.splitMachineQueue([cut('A', 'M', [30], 5), cut('B', 'M', [40], 1)],
        opts({ perPassByCut: { A: 97, B: 6 }, runsByCut: { A: 5, B: 1 } }));
    assert(!segs.some(function (s) { return s.cutId === 'B' && s.dayOffset === 0; }),
        '#3939: на день0 нет сегмента B (ни настройки, ни прохода) — день не раздут');
    assertEqual(bsegs(segs).map(function (s) { return { day: s.day, setup: s.setup, runs: s.runs, setupOnly: s.setupOnly }; }),
        [{ day: 1, setup: 30, runs: 1, setupOnly: false }],
        '#3939: вся резка B — ОДНИМ сегментом на день1 (настройка 30 + проход, без отдельного хвоста)');
})();

// ── 2) #3934: с далёким простоем — то же самое; нет «настройки в начале дня» на день1 ──
(function () {
    var farBlock = [[3 * 1440 + 480, 3 * 1440 + 960]];
    var segs = planning.splitMachineQueue([cut('A', 'M', [30], 5), cut('B', 'M', [40], 1)],
        opts({ perPassByCut: { A: 97, B: 6 }, runsByCut: { A: 5, B: 1 }, blockedRanges: farBlock }));
    assert(!segs.some(function (s) { return s.setupOnly; }),
        '#3934/#3939: setup-only сегмента нет вовсе → нечему выталкиваться на начало след. дня');
    var b = bsegs(segs);
    assertEqual(b.length === 1 && b[0].day, 1, '#3934/#3939: B одним сегментом на день1 (08:00), не «настройка в начале дня»');
    assertEqual(b[0].ws, DAY1, '#3934/#3939: старт B = 08:00 дня1');
})();

// ── 3) #3635 п.5 сохранён: когда настройка ВЛЕЗАЕТ целиком в остаток — хвост в конце дня0 ──
// A (p55×8=440) заполняет день0 до 440 (остаток до конца окна = 50). B — настройка 45 ≤ 50,
// проход 20 не влезает (остаток после настройки 5 < 20) → настройка 45 целиком в хвост дня0,
// проходы B — с дня1. День0 = 440+45 = 485 ≤ ёмкости 490.
(function () {
    var segs = planning.splitMachineQueue([cut('A', 'M1', [30], 8), cut('B', 'M2', [40], 2)],
        opts({ perPassByCut: { A: 55, B: 20 }, runsByCut: { A: 8, B: 2 } }));
    var b = bsegs(segs);
    assertEqual(b[0] && { day: b[0].day, setup: b[0].setup, runs: b[0].runs, setupOnly: b[0].setupOnly },
        { day: 0, setup: 45, runs: 0, setupOnly: true },
        '#3635п5/#3939: настройка 45 влезает в остаток 50 → хвост настройки в конце дня0');
    assert(b.slice(1).every(function (s) { return s.day >= 1 && !s.setupOnly && s.setup === 0; }),
        '#3635п5/#3939: проходы B — с дня1 без повторной настройки (она сделана в хвосте дня0)');
    // День0 (A 440 + хвост настройки 45 = 485) не превышает ёмкость окна 490.
    var d0 = segs.filter(function (s) { return s.dayOffset === 0; })
        .reduce(function (sum, s) { return sum + (s.setupMin || 0) + (s.durationMin || 0); }, 0);
    assert(d0 <= 490, '#3939: суммарные минуты дня0 (' + d0 + ') ≤ ёмкости окна 490');
})();

console.log('\n' + passed + ' assertions passed');
