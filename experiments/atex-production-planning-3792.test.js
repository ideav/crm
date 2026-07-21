// Unit tests for #3792 — генерация пересобирает очередь; «Зафиксировано» = замок на ДЕНЬ.
//
// Поведение зафиксированной резки (флаг c.fixed + якорь дня dayAnchorByCut) в splitMachineQueue
// (путь записи planCutOperations, gapFill):
//   1) #4304: РАЗБИВАЕТСЯ по дням по потолку смены (как обычная) — голова на зафиксированном дне,
//      остаток продолжением на следующий день (раньше клалась целиком за смену — issue #4304);
//   2) остаётся на своём дне — gapFill (#3739) её не тянет в хвост более раннего дня;
//   3) переполнение фиксом выталкивает СВОБОДНЫЕ резки на следующий день;
//   4) на своём дне берётся раньше свободных (перёд дня), внутри дня двигаться можно;
//   5) свободные (без флага) — как прежде: пересобираются и перетекают между днями.
//
// Run with: node experiments/atex-production-planning-3792.test.js

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
function fixedCut(id, material, kw, runs) {
    var c = cut(id, material, kw, runs); c.fixed = true; return c;
}
function bySlitterCutId(segs) {
    var by = {}; segs.forEach(function(s){ (by[s.cutId] = by[s.cutId] || []).push(s); });
    return by;
}
var TIMES = { BETWEEN_CUTS: 0 };   // KNIFE 30 / MATERIAL_WINDING 15 (дефолт)

// ── 1) Зафиксированная резка НЕ разбивается: 15 проходов × 10 мин = 150 > окно 100, но один сегмент ──
var split = planning.splitMachineQueue(
    [ fixedCut('F', 'M1', [59, 59], 15) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { F: 10 }, runsByCut: { F: 15 }, dayAnchorByCut: { F: 0 }, gapFill: true });
assertEqual(split.map(function(s){ return { day: s.dayOffset, runs: s.runs, cont: !!s.isContinuation }; }),
    [ { day: 0, runs: 10, cont: false }, { day: 1, runs: 5, cont: true } ],
    '#4304: зафиксированная резка РАЗБИВАЕТСЯ по потолку дня (150>100 → 10 на фикс-дне 0 + 5 продолжением на день 1)');

// контроль: ТА ЖЕ резка без фиксации разбивается по дням (#3821: 10 сегодня + 5 завтра, без нахлёста)
var splitFree = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 15) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10 }, runsByCut: { A: 15 }, dayAnchorByCut: { A: 0 }, gapFill: true });
assertEqual(splitFree.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }),
    [ { day: 0, runs: 10 }, { day: 1, runs: 5 } ],
    '#3792 контроль: незафиксированная резка разбивается по дням (10+5, #3821 без нахлёста)');

// ── 2) Зафиксированная остаётся на своём дне: gapFill НЕ тянет её в хвост более раннего дня ──
// A (свободная, день 0, 5 проходов = 50 мин) + B (день 1). Свободную B (#3739) тянет в хвост
// дня 0 (50+30≤100); зафиксированную B — нет, она ждёт свой день 1.
var ctrl = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 5), cut('B', 'M1', [59, 59], 3) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 5, B: 3 }, dayAnchorByCut: { A: 0, B: 1 }, gapFill: true });
assertEqual(bySlitterCutId(ctrl).B.map(function(s){ return s.dayOffset; }), [ 0 ],
    '#3792 контроль: свободную B (день 1) gapFill тянет в хвост дня 0');

var fx = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 5), fixedCut('B', 'M1', [59, 59], 3) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10, B: 10 }, runsByCut: { A: 5, B: 3 }, dayAnchorByCut: { A: 0, B: 1 }, gapFill: true });
var fxBy = bySlitterCutId(fx);
assertEqual(fxBy.B.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }), [ { day: 1, runs: 3 } ],
    '#3792: зафиксированную B держим на её дне 1 (gapFill не тянет вперёд)');
assertEqual(fxBy.A.map(function(s){ return s.dayOffset; }), [ 0 ],
    '#3792: свободная A — на своём дне 0');

// ── 3) Переполнение фиксом выталкивает свободную на следующий день ──
// F (фикс, день 0, 15 проходов = 150 > 100) переполняет день 0; свободная A (день 0) → день 1.
var ovf = planning.splitMachineQueue(
    [ fixedCut('F', 'M1', [59, 59], 15), cut('A', 'M1', [59, 59], 3) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { F: 10, A: 10 }, runsByCut: { F: 15, A: 3 }, dayAnchorByCut: { F: 0, A: 0 }, gapFill: true });
var ovfBy = bySlitterCutId(ovf);
assertEqual(ovfBy.F.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }), [ { day: 0, runs: 10 }, { day: 1, runs: 5 } ],
    '#4304: фикс F разбит по потолку дня — 10 на дне 0, 5 продолжением на дне 1 (не целиком за смену)');
assertEqual(ovfBy.A.map(function(s){ return s.dayOffset; }), [ 1 ],
    '#3792: после заполнения дня 0 фиксом свободная A уходит на день 1');

// ── 4) На своём дне зафиксированная берётся раньше свободных (перёд дня); обе на дне 0 ──
var sameDay = planning.splitMachineQueue(
    [ cut('A', 'M1', [59, 59], 2), fixedCut('F', 'M2', [30, 30], 2) ],
    { dayStartMin: 0, dayEndMin: 200, times: TIMES,
      perPassByCut: { A: 10, F: 10 }, runsByCut: { A: 2, F: 2 }, dayAnchorByCut: { A: 0, F: 0 }, gapFill: true });
assertEqual(sameDay.map(function(s){ return s.cutId; }), [ 'F', 'A' ],
    '#3792: на своём дне фикс берётся раньше свободной (перёд дня)');
assertEqual(sameDay.every(function(s){ return s.dayOffset === 0; }), true,
    '#3792: обе резки — на дне 0 (внутри дня свободная пакуется после фикса)');

// ── 5) Фикс без якоря дня (нет «Даты план») трактуется как свободная (закрепить день нельзя) ──
var noAnchor = planning.splitMachineQueue(
    [ fixedCut('A', 'M1', [59, 59], 15) ],
    { dayStartMin: 0, dayEndMin: 100, times: TIMES,
      perPassByCut: { A: 10 }, runsByCut: { A: 15 }, dayAnchorByCut: {}, gapFill: true });
assertEqual(noAnchor.map(function(s){ return { day: s.dayOffset, runs: s.runs }; }),
    [ { day: 0, runs: 10 }, { day: 1, runs: 5 } ],
    '#3792: фикс без якоря дня — как свободная (день закрепить нечем, разбивается 10+5, #3821 без нахлёста)');

console.log('\n' + passed + ' assertions passed');
