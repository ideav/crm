// Unit tests for #3760 — «Время за пределами рабочего дня»: нахлёст ограничен ОДНИМ шагом,
// резку разбиваем на границе дня.
//   1) minOverlapTailSetupMinutes (используется в НЕ-gapFill ветке) — подмножество с суммой ≥
//      остатка дня и МИНИМАЛЬНЫМ нахлёстом. #3939: в ветке gapFill (запись плана) хвост настройки
//      с нахлёстом ОТМЕНЁН — настройка кладётся только если влезает целиком, иначе вся резка назавтра.
//   2) Проходы: #3821 ОТМЕНИЛ нахлёстный проход — сегодня только ЦЕЛИКОМ влезающие в ёмкость,
//      остальное на завтра (раньше клали + один нахлёстный, выводивший день за ёмкость).
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

// ── 2) #3939: настройка (45) не влезает в остаток 8 → вся резка B на следующий день (без нахлёста) ──
// Раньше в хвост клали сырьё 15 с нахлёстом; #3939 отменил нахлёст настройки — день не должен
// вылезать за ёмкость. B уходит на день 1 и дальше дробится по проходам (68−45=23 → 2 прохода в день1).
var sp = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 6), cut('B', 'M2', [30, 30], 3) ],
    { dayStartMin: 0, dayEndMin: 68, times: TIMES,
      perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 6, B: 3 },
      dayAnchorByCut: { A: 0, B: 0 }, gapFill: true });
assertEqual(sp.filter(function(s){ return s.cutId === 'B'; })
        .map(function(s){ return { day: s.dayOffset, setup: s.setupMin, runs: s.runs, setupOnly: !!s.setupOnly }; }),
    [{ day: 1, setup: 45, runs: 2, setupOnly: false }, { day: 2, setup: 0, runs: 1, setupOnly: false }],
    '#3760/#3939: настройка 45 не влезает в остаток дня0 (8) → вся резка B с дня1 (без хвоста настройки в дне0)');

// ── 3) Проходы: только ЦЕЛИКОМ влезающие сегодня, остальное на завтра (#3821: без нахлёста) ──
var pp = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 15) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10 }, runsByCut: { A: 15 }, dayAnchorByCut: { A: 0 }, gapFill: true });
assertEqual(pp.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }),
    [ { day: 0, runs: 10 }, { day: 1, runs: 5 } ],
    '#3821: день 0 — 10 влезших проходов (БЕЗ нахлёстного, отменён #3760); остаток 5 — на завтра');

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
