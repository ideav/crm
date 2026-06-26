// Unit tests for #3760 — «Время за пределами рабочего дня»: нахлёст ограничен ОДНИМ шагом,
// резку разбиваем на границе дня.
//   1) Настройка в хвост: подмножество компонентов с суммой ≥ остатка дня и МИНИМАЛЬНЫМ
//      нахлёстом; остальное — на завтра. Реконсиляция #3739/#3760:
//        хвост 20 (ножи 30, сырьё 15) → ножи 30 (сырьё не дотягивает);
//        хвост 8  (ножи 30, сырьё 15) → сырьё 15 (оба дотягивают, берём меньший).
//   2) Проходы: влезающие + ОДИН нахлёстный сохраняем сегодня, после первого нахлёста —
//      остальное на завтра.
//   3) buildSchedule: тайминг не накапливается в ночь — резка, чьё окно начинается за концом
//      смены, уходит на следующий день (один нахлёст на день, не до 23:00).
//
// Run with: node experiments/atex-production-planning-3760.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function cut(id, material, kw, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
        knifeWidths: kw, knifeCount: kw.length, rollerWidth: 0, plannedRuns: runs };
}
var TIMES = { BETWEEN_CUTS: 0 };   // KNIFE 30 / MATERIAL_WINDING 15 (дефолт)

// ── 1) minOverlapTailSetupMinutes: подмножество, дотягивающее до границы, мин. нахлёст ──
assertEqual(planning.minOverlapTailSetupMinutes([{minutes:30},{minutes:15}], 8, 45), 15,
    '#3760: хвост 8 — сырьё 15 (оба компонента дотягивают, берём меньший, нахлёст 7)');
assertEqual(planning.minOverlapTailSetupMinutes([{minutes:30},{minutes:15}], 20, 45), 30,
    '#3739: хвост 20 — ножи 30 (сырьё 15 < 20 не дотягивает, оставило бы простой)');
assertEqual(planning.minOverlapTailSetupMinutes([{minutes:30},{minutes:15}], 35, 45), 45,
    '#3760: хвост 35 — оба компонента (45), иначе простой');
assertEqual(planning.minOverlapTailSetupMinutes([{minutes:30}], 5, 30), 30,
    '#3760: один компонент — он и идёт в хвост');

// ── 2) Настройка на границе (канон #3760): хвост 8 → сырьё 15, ножи + проходы на завтра ──
var sp = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 6), cut('B', 'M2', [30, 30], 3) ],
    { dayStartMin: 0, dayEndMin: 68, times: TIMES,
      perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 6, B: 3 },
      dayAnchorByCut: { A: 0, B: 0 }, gapFill: true });
var bSet = sp.filter(function(s){ return s.cutId === 'B' && s.setupOnly; })[0];
var bPas = sp.filter(function(s){ return s.cutId === 'B' && !s.setupOnly; })[0];
assertEqual(bSet && { day: bSet.dayOffset, setup: bSet.setupMin, runs: bSet.runs }, { day: 0, setup: 15, runs: 0 },
    '#3760: в хвост дня 0 — сырьё 15 (нахлёст), не ножи');
assertEqual(bPas && { day: bPas.dayOffset, setup: bPas.setupMin, runs: bPas.runs }, { day: 1, setup: 30, runs: 3 },
    '#3760: ножи 30 + проходы B — на следующий день');

// ── 3) Проходы: влезающие + один нахлёстный сегодня, остальное на завтра ──
var pp = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 15) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10 }, runsByCut: { A: 15 }, dayAnchorByCut: { A: 0 }, gapFill: true });
assertEqual(pp.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }),
    [ { day: 0, runs: 11 }, { day: 1, runs: 4 } ],
    '#3760: день 0 — 10 влезших + 1 нахлёстный = 11 проходов; остаток 4 — на завтра');

// ── 4) buildSchedule: один нахлёст на день, без накопления в ночь ──
// Три резки одной конфигурации (setup 0) по 60 мин, окно 100. C1 (0–60), C2 нахлёстом
// (60–120, один нахлёст), C3 — окно за концом смены → на следующий день (а не 120–180 в ночь).
function dcut(id, dur) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [59, 59], knifeCount: 2, rollerWidth: 0, plannedRuns: 0, duration: dur };
}
var sched = planning.buildSchedule([ dcut('C1', 60), dcut('C2', 60), dcut('C3', 60) ],
    { shiftStartMin: 0, shiftEndMin: 100, times: TIMES, runLengthByCut: {}, windPoints: [],
      dayAnchorByCut: { C1: 0, C2: 0, C3: 0 }, gapFill: true });
function dayOf(sc) { return Math.floor((Number(sc.startMin) || 0) / 1440); }
var byId = {}; sched.forEach(function(s){ byId[s.cutId] = s; });
assertEqual([dayOf(byId.C1), dayOf(byId.C2), dayOf(byId.C3)], [0, 0, 1],
    '#3760: C1,C2 на дне 0 (C2 — один нахлёст), C3 уходит на день 1 (не копится в ночь)');

console.log('\n' + passed + ' passed');
