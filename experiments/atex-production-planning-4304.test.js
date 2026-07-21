// #4304 — «Разобраться как получилось время окончания 20:33?»
//
// Реальные данные ateh (Станок 3, 22.07): задание 631233 — ЗАФИКСИРОВАНО (81530="X"), MW308 300×158,
// 158 проходов ≈ 506 мин, стоит 11:17–20:33 ОДНИМ куском, далеко за концом смены (16:30+нахлёст).
// Причина: зафиксированная резка клалась ЦЕЛИКОМ, без разбивки по дням (#3792/#3914 «замок на день»).
//
// Фикс #4304: зафиксированную резку ВСЁ РАВНО разрываем по потолку дня (cutEndMin + допустимый нахлёст),
// как обычную. Голова с влезающими проходами остаётся на ЗАФИКСИРОВАННОМ дне; остаток — продолжением
// на следующий день. Оператору — красное предупреждение на карточке (рендер: зафикс-резка с «→»).
//
// Run with: node experiments/atex-production-planning-4304.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

function cut(id, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'MW308', winding: 'OUT',
        knifeWidths: [110], knifeCount: 1, rollerWidth: 0, plannedRuns: runs };
}
function fixedCut(id, runs) { var c = cut(id, runs); c.fixed = true; return c; }
var TIMES = { BETWEEN_CUTS: 0 };   // без лидера; setup первой резки не задаём → 0

// ── 1) Реальный кейс 631233: зафикс-резка 158 проходов не влезает в смену → РАЗБИВАЕТСЯ по дням ──────
// Ёмкость дня 450 мин, проход 3.2 мин → влезает floor(450/3.2)=140 проходов; остаток 18 — на след. день.
(function () {
    var segs = planning.splitMachineQueue(
        [ fixedCut('F', 158) ],
        { dayStartMin: 0, dayEndMin: 450, times: TIMES,
          perPassByCut: { F: 3.2 }, runsByCut: { F: 158 }, dayAnchorByCut: { F: 0 }, gapFill: true });
    assertEqual(segs.map(function (s) { return { day: s.dayOffset, runs: s.runs, cont: !!s.isContinuation }; }),
        [ { day: 0, runs: 140, cont: false }, { day: 1, runs: 18, cont: true } ],
        '#4304: зафикс-резка 158 проходов разбита — 140 на фикс-дне 0 (голова), 18 продолжением на дне 1');
    // Голова НЕ выходит за конец смены: конец окна ≤ потолка дня 0 (450), а не 506 (было бы 20:33).
    var head = segs[0];
    var headEnd = head.windowStartMin + head.setupMin + head.durationMin;
    assert(headEnd <= 450 + 1e-6, '#4304: конец головы (' + Math.round(headEnd) + ') ≤ потолка смены 450 (не уезжает за смену)');
    // Сумма проходов сохранена.
    assertEqual(segs.reduce(function (a, s) { return a + s.runs; }, 0), 158, '#4304: суммарные проходы сохранены (140+18=158)');
})();

// ── 2) Контроль: зафикс-резка, ВЛЕЗАЮЩАЯ в смену, кладётся ЦЕЛИКОМ (без разрыва, #3792 сохранён) ──────
(function () {
    var segs = planning.splitMachineQueue(
        [ fixedCut('F', 100) ],
        { dayStartMin: 0, dayEndMin: 450, times: TIMES,
          perPassByCut: { F: 3.2 }, runsByCut: { F: 100 }, dayAnchorByCut: { F: 0 }, gapFill: true });
    assertEqual(segs.map(function (s) { return { day: s.dayOffset, runs: s.runs, cont: !!s.isContinuation }; }),
        [ { day: 0, runs: 100, cont: false } ],
        '#4304 контроль: влезающая зафикс-резка (100×3.2=320≤450) — один сегмент, без разрыва');
})();

// ── 3) Голова остаётся на ЗАФИКСИРОВАННОМ дне (не съезжает на день 0), продолжение — следующим днём ──
(function () {
    var segs = planning.splitMachineQueue(
        [ fixedCut('F', 158) ],
        { dayStartMin: 0, dayEndMin: 450, times: TIMES,
          perPassByCut: { F: 3.2 }, runsByCut: { F: 158 }, dayAnchorByCut: { F: 2 }, gapFill: true });   // зафиксирована на день 2
    var byDay = {}; segs.forEach(function (s) { byDay[s.dayOffset] = (byDay[s.dayOffset] || 0) + s.runs; });
    assert(!!byDay[2] && !byDay[0] && !byDay[1], '#4304: голова зафикс-резки — на зафиксированном дне 2 (не на дне 0)');
    assertEqual(segs.map(function (s) { return { day: s.dayOffset, cont: !!s.isContinuation }; }),
        [ { day: 2, cont: false }, { day: 3, cont: true } ],
        '#4304: голова на дне 2, продолжение — на дне 3');
    // Продолжение НЕ зафиксировано (создаётся как обычное), голова — на своём дне: инвариант фиксации сохранён.
    assert(segs[0].runs === 140 && segs[1].runs === 18, '#4304: 140 на фикс-дне + 18 продолжением');
})();

// ── 4) Нахлёст (#3847): потолок разрыва — cutEndMin + MAX_OVERWORK_CUTS (голова может чуть зайти за смену) ──
(function () {
    // dayEnd(cutEndMin)=100, нахлёст резки +10 → потолок 110. 15×10=150 → влезает floor((110)/10)=11.
    var segs = planning.splitMachineQueue(
        [ fixedCut('F', 15) ],
        { dayStartMin: 0, dayEndMin: 100, dayEndHourMin: 100, maxOverworkCutsMin: 10, times: TIMES,
          perPassByCut: { F: 10 }, runsByCut: { F: 15 }, dayAnchorByCut: { F: 0 }, gapFill: true });
    assertEqual(segs.map(function (s) { return { day: s.dayOffset, runs: s.runs }; }),
        [ { day: 0, runs: 11 }, { day: 1, runs: 4 } ],
        '#4304: разрыв учитывает нахлёст (#3847) — 11 проходов до потолка 110 на дне 0, 4 на дне 1');
})();

// ── 5) НЕ теряем задания: несколько зафикс-резок пере-подписали день, большая идёт ПЕРВОЙ ───────────
// F1(15,150) разрывается и уводит день 0 вперёд; F2/F3 (зафикс на день 0) НЕ должны пропасть из плана
// (их день переполнен → размещаем как обычные с текущего дня, а не бросаем).
(function () {
    var segs = planning.splitMachineQueue(
        [ fixedCut('F1', 15), fixedCut('F2', 5), fixedCut('F3', 5) ],
        { dayStartMin: 0, dayEndMin: 100, times: TIMES,
          perPassByCut: { F1: 10, F2: 10, F3: 10 }, runsByCut: { F1: 15, F2: 5, F3: 5 },
          dayAnchorByCut: { F1: 0, F2: 0, F3: 0 }, gapFill: true });
    var byCut = {}; segs.forEach(function (s) { byCut[s.cutId] = (byCut[s.cutId] || 0) + s.runs; });
    assertEqual(byCut, { F1: 15, F2: 5, F3: 5 },
        '#4304: пере-подписка дня зафикс-резками (большая первой) НЕ теряет F2/F3 из плана (все проходы размещены)');
})();

console.log('\n' + passed + ' assertions passed');
