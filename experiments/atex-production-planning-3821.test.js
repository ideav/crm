// Unit tests for #3821 — «Почему 483 опять? 479 может быть максимум».
//
// Диаграмма Ганта (cut-gantt) суммирует минуты заданий станка за день и показывала 483 при
// рабочей ёмкости 450 (окно резки ATEH 08:00–16:10 = 490 − обед 40). Причина — «нахлёстный»
// проход (#3739/#3760): splitMachineQueue клал в хвост дня проходы, влезающие в ёмкость, ПЛЮС
// один нахлёстный (первый, пересекающий конец смены). Для длинного прохода этот нахлёстный
// добавлял ~50 мин сверх ёмкости → день 483 при максимуме ~480.
//
// Фикс (#3821, выбран вариант «дробить последнюю резку»): в хвост дня кладём только проходы,
// ЦЕЛИКОМ влезающие в рабочую ёмкость; остаток (включая бывший нахлёстный) — на следующий день
// (как дневное дробление #3280). Нахлёстный проход сохраняется ТОЛЬКО в вырожденном случае —
// одиночный проход длиннее целого окна (разбить нельзя).
//
// Run with: node experiments/atex-production-planning-3821.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
var TIMES = { BETWEEN_CUTS: 0 };   // KNIFE 30 / MATERIAL_WINDING 15 (дефолт)
function cut(id, material, kw, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs };
}
function dayWork(segs) {
    var m = {};
    segs.forEach(function(s){ m[s.dayOffset] = round1((m[s.dayOffset] || 0) + (s.setupMin || 0) + (s.durationMin || 0)); });
    return m;
}
function round1(x){ return Math.round(x * 1000) / 1000; }

// ── 1) Длинная резка дробится по ёмкости БЕЗ нахлёстного прохода ───────────────────────────
// Окно 450 (без обеда), один проход 52 мин, 10 проходов (итого 520 > 450). Влезает 8 проходов
// (416 ≤ 450); остаток 2 — на следующий день. Раньше клали 9 (8 + нахлёстный) = 468 > 450.
var s1 = planning.splitMachineQueue([ cut('A', 'M1', [59, 59], 10) ],
    { dayStartMin: 0, dayEndMin: 450, times: TIMES, perPassByCut: { A: 52 }, runsByCut: { A: 10 },
      dayAnchorByCut: { A: 0 }, gapFill: true });
assertEqual(s1.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }),
    [ { day: 0, runs: 8 }, { day: 1, runs: 2 } ],
    '#3821: 10 проходов × 52 в окне 450 → 8 сегодня (416 ≤ 450, БЕЗ нахлёстного), 2 на завтра');
assertEqual(dayWork(s1)[0] <= 450, true, '#3821: работа дня 0 не превышает ёмкость 450 (нахлёста нет)');

// ── 2) Реальный ATEH: короткие задания + длинная резка через обед — день ≤ ёмкость+наладка ──
// Окно резки 0..490, обед на 300 длиной 40 → рабочая ёмкость 450. Заполняем день короткими
// задачами (одно сырьё, переналадки нет), затем длинная резка: день не должен вылетать за ~480.
var cuts2 = [ cut('A', 'M1', [59, 59], 4), cut('B', 'M1', [59, 59], 30) ];
var s2 = planning.splitMachineQueue(cuts2,
    { dayStartMin: 0, dayEndMin: 490, times: TIMES, perPassByCut: { A: 20, B: 20 }, runsByCut: { A: 4, B: 30 },
      lunchStartMin: 300, lunchDurationMin: 40, dayAnchorByCut: { A: 0, B: 0 }, gapFill: true });
assertEqual(dayWork(s2)[0] <= 450, true,
    '#3821: с обедом работа дня 0 ≤ ёмкость 450 (раньше нахлёстный проход давал 450+проход)');

// ── 3) Одиночный проход длиннее окна — РАЗБИТЬ НЕЛЬЗЯ, нахлёст сохраняется ────────────────
// Один проход 500 мин в окне 450: дробить нечего, кладём 1 проход с нахлёстом (иначе резка
// не разместится никогда). Это единственный случай, где нахлёстный проход остаётся.
var s3 = planning.splitMachineQueue([ cut('A', 'M1', [59, 59], 1) ],
    { dayStartMin: 0, dayEndMin: 450, times: TIMES, perPassByCut: { A: 500 }, runsByCut: { A: 1 },
      dayAnchorByCut: { A: 0 }, gapFill: true });
assertEqual(s3.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }), [ { day: 0, runs: 1 } ],
    '#3821: одиночный проход длиннее окна — кладётся с нахлёстом (разбить нельзя)');

// ── 4) Та же конфигурация, день заполнен ровно — БЕЗ пустого setup-only сегмента ────────────
// Два задания одного сырья (переналадки нет), первое заполняет окно ровно (5×90=450). Второе не
// влезает: ни одного прохода, настройки нет → НИЧЕГО в хвост (не пустой сегмент), целиком на завтра.
var s4 = planning.splitMachineQueue([ cut('A', 'M1', [59, 59], 5), cut('B', 'M1', [59, 59], 5) ],
    { dayStartMin: 0, dayEndMin: 450, times: TIMES, perPassByCut: { A: 90, B: 90 }, runsByCut: { A: 5, B: 5 },
      dayAnchorByCut: { A: 0, B: 0 }, gapFill: true });
assertEqual(s4.map(function(s){ return { day: s.dayOffset, cut: s.cutId, runs: s.runs, setup: s.setupMin }; }),
    [ { day: 0, cut: 'A', runs: 5, setup: 0 }, { day: 1, cut: 'B', runs: 5, setup: 0 } ],
    '#3821: A заполняет день 0 ровно, B целиком на день 1 — без пустого setup-only сегмента');

console.log('\n' + passed + ' passed');
