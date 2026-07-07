// Unit tests for #4095 — «Почему допущена просрочка?»: (1) трассировка выбора слота (первый/выбранный
// вариант, reasoning, число вариантов) + дамп переменных с пометкой «Настройка/дефолт»; (2) фикс §12 —
// СРОК держат РЕАЛЬНЫЕ дни splitMachineQueue, а не ёмкость-оценка размещения (capacityMin — лишь
// эвристика порядка). Проверяем чистое ядро: computeSlotPlacement(trace), formatSlotPlacementTrace,
// relocatePass по реальным дням, planCutOperations end-to-end.
//
// Run with: node experiments/atex-production-planning-4095.test.js

process.env.TZ = 'UTC';
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) { total++; console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };
function cut(id, o) {
    o = o || {};
    return { id: id, slitter: { id: o.m || 'm1' }, materialId: o.mat || 'M1', winding: 'OUT',
             knifeWidths: o.kw || [50, 50], knifeCount: (o.kw || [50, 50]).length, rollerWidth: 0,
             plannedRuns: o.runs == null ? 3 : o.runs, isFoil: !!o.foil, fixed: !!o.fixed };
}

// ── Часть 1: трассировка — структура (переменные + по-задачам первый/выбранный/варианты) ──────────
console.log('\n== trace: дамп переменных с источником + по-задачам первый/выбранный/число вариантов ==');
var tr = planning.computeSlotPlacement(
    [cut('A', { mat: 'M1' }), cut('B', { mat: 'M2' })],
    { settings: { DEADLINE_COST_MN: '120', KNIVES_CHANGE_COST_MN: 'abc' /* нечисло → дефолт */ },
      times: TIMES, capacityMin: 100, baseMidnightMs: 0, perPassByCut: { A: 30, B: 30 },
      dueKeyByCut: {}, slitterIds: ['m1'], trace: true, relocate: false }).trace;
assert(!!tr && tr.variables.length >= 12, 'trace.variables непуст (веса штрафов)');
var vDead = tr.variables.filter(function (v) { return v.key === 'DEADLINE_COST_MN'; })[0];
assert(vDead && vDead.value === 120 && vDead.source === 'Настройка', 'DEADLINE_COST_MN=120 помечен «Настройка» (задан в settings)');
var vKn = tr.variables.filter(function (v) { return v.key === 'KNIVES_CHANGE_COST_MN'; })[0];
assert(vKn && vKn.value === 30 && vKn.source === 'дефолт', 'KNIVES_CHANGE_COST_MN=«abc» (нечисло) → дефолт 30, помечен «дефолт»');
var vExact = tr.variables.filter(function (v) { return v.key === 'EXACT_DEADLINE_COST_MN'; })[0];
assert(vExact && vExact.value === 33 && vExact.source === 'дефолт', 'EXACT_DEADLINE_COST_MN отсутствует в «Настройке» → дефолт 33, «дефолт»');
assert(tr.tasks.length === 2, 'trace.tasks — по задаче на каждую резку');
var tA = tr.tasks[0];
assert(tA.id === 'A' && tA.variants >= 1 && tA.first && tA.chosen, 'задача A: есть число вариантов, первый и выбранный');
assert(typeof tA.chosen.weight === 'number' && tA.chosen.byFactor, 'выбранный вариант несёт вес и разбор по факторам (reasoning)');

// ── Часть 2: формат лога — строки читаемы, есть переменные и разбор задач ──────────────────────────
console.log('\n== formatSlotPlacementTrace: строки лога ==');
var lines = planning.formatSlotPlacementTrace(tr);
function hasLine(sub) { return lines.some(function (l) { return l.indexOf(sub) >= 0; }); }
assert(hasLine('ПЕРЕМЕННЫЕ'), 'лог начинается с дампа ПЕРЕМЕННЫХ');
assert(hasLine('⚙ DEADLINE_COST_MN = 120'), 'весом из «Настройки» помечен ⚙');
assert(hasLine('▫ EXACT_DEADLINE_COST_MN = 33'), 'дефолтный вес помечен ▫');
assert(hasLine('ПЕРВЫЙ рассмотренный') && hasLine('ВЫБРАН'), 'по задаче печатаются первый и выбранный вариант');
assert(planning.formatSlotPlacementTrace(null).length === 0, 'formatSlotPlacementTrace(null) → пусто (без падения)');

// ── Часть 3: причина просрочки в ОЦЕНКЕ — есть/нет варианта «в срок» ───────────────────────────────
console.log('\n== trace: причина просрочки (оценка) — был ли вариант в срок ==');
// U срочная (срок day0), ёмкость мала → любой поздний вариант оценивается за срок. Один станок, один
// сосед B — некуда встать в срок дешевле. overdue + bestInDue помечаются.
function ymd(off) { var d = new Date(off * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
var trO = planning.computeSlotPlacement(
    [cut('B', { mat: 'M1', runs: 3 }), cut('U', { mat: 'M1', runs: 3 })],
    { settings: {}, times: TIMES, capacityMin: 100, baseMidnightMs: 0, perPassByCut: { B: 90, U: 90 },
      dueKeyByCut: { U: ymd(0), B: ymd(8) }, slitterIds: ['m1'], trace: true, relocate: false }).trace;
var tU = trO.tasks.filter(function (t) { return t.id === 'U'; })[0];
assert(tU != null, 'задача U в трассировке');
// U влезает в день0 первой (bestInDue найдётся) — проверяем, что поле overdue корректно (bool) и dueKey проброшен.
assert(tU.dueKey === ymd(0), 'U несёт срок (dueKey) в трассировке');
assert(typeof tU.overdue === 'boolean', 'U: overdue вычислен (bool)');

// ── Часть 4: АРБИТР срока — РЕАЛЬНЫЕ дни (relocatePass), а не ёмкость-оценка ───────────────────────
console.log('\n== relocatePass: срок держат РЕАЛЬНЫЕ дни (не оценка) ==');
function seed2(dueU) {
    var sB = planning.slotFromCut(cut('B', { mat: 'M2' }), ymd(8)); sB.workMin = 90;
    var sU = planning.slotFromCut(cut('U', { mat: 'M1' }), ymd(dueU)); sU.workMin = 90;
    return planning.seedOccupancy([sB, sU], [], ['m1']);   // порядок [B, U]
}
function relCtxFor(dueU) {
    return { settings: {}, times: TIMES, capacityMin: 100, baseMidnightMs: 0,
             perPassByCut: { B: 30, U: 30 }, dueDayByCut: { U: dueU, B: 8 } };
}
// (а) U срочная (срок 0), реальный день 2 > срок → релокация тянет её вперёд, в срок.
var occA = seed2(0);
var relA = planning.relocatePass(occA, { B: 0, U: 2 }, relCtxFor(0));
var orderA = occA.byMachine.m1.map(function (s) { return s.id; });
assert(relA.moves.length > 0 && orderA[0] === 'U', 'реальный день U=2 > срок 0 → U перенесён вперёд в срок; порядок ' + JSON.stringify(orderA));
// (б) реальный день U = 0 ≤ срок 9 → триггера нет (арбитр — РЕАЛЬНЫЙ день); порядок не тронут.
var occB = seed2(9);
var relB = planning.relocatePass(occB, { B: 0, U: 0 }, relCtxFor(9));
var orderB = occB.byMachine.m1.map(function (s) { return s.id; });
assert(relB.moves.length === 0 && orderB[0] === 'B', 'реальный день U=0 ≤ срок 9 → релокации нет (арбитр — реальный день); порядок ' + JSON.stringify(orderB));

// ── Часть 5: end-to-end planCutOperations — срочное в срок; §12-цикл активен ───────────────────────
console.log('\n== planCutOperations (slotPlacement): срочное задание встаёт в срок ==');
var BASE = new Date('2026-06-23T00:00:00').getTime();
function ecut(id, o) {
    o = o || {};
    return { id: id, slitter: { id: 'm1' }, materialId: o.mat || 'M1', winding: 'OUT', knifeWidths: [50, 50],
             knifeCount: 2, rollerWidth: 0, plannedRuns: o.runs == null ? 1 : o.runs, isFoil: false,
             length: 100, planDate: '', status: '', fixed: false };
}
function ymdB(off) { var d = new Date(BASE + off * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function runPCO(cuts, due) {
    var perPass = {}; cuts.forEach(function (c) { perPass[c.id] = 100; });
    var dk = {}; Object.keys(due).forEach(function (id) { dk[id] = ymdB(due[id]); });
    return planning.planCutOperations(cuts, {
        weights: planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }),
        times: { BETWEEN_CUTS: 0 }, dayStartMin: 0, dayEndMin: 120, dayEndHourMin: 120, lunchDurationMin: 0,
        perPassByCut: perPass, planBaseMidnightMs: BASE, preserveOrder: false, dayAnchorByCut: {},
        dueDayByCut: due, dueKeyByCut: dk, gapFill: true, slotPlacement: true, slitterIds: ['m1']
    });
}
function opDay(ops, id) {
    var u = (ops.updates || []).filter(function (x) { return String(x.cutId) === id; })[0];
    return u ? Math.round((Number(u.planStartTs) * 1000 - BASE) / 86400000) : null;
}
// U срочное (срок day1), в очереди ПОСЛЕДНЕЕ; B1/B2 поздние (срок day8). 120 мин/день → одна резка/день.
var out = runPCO([ecut('B1'), ecut('B2'), ecut('U')], { U: 1, B1: 8, B2: 8 });
assert(opDay(out, 'U') <= 1, '#4095: срочное U встаёт в срок (день ' + opDay(out, 'U') + ' ≤ 1)');

// ── Часть 6: трассировка end-to-end печатается (реальные дни, §12) при включённом slotTrace ────────
console.log('\n== planCutOperations печатает trace (реальные дни + §12) когда slotTrace ВКЛ ==');
var log = []; var realLog = console.log;
globalThis.PP_TRACE_PLACEMENT = true;
console.log = function () { log.push([].slice.call(arguments).join(' ')); };
try { runPCO([ecut('B1'), ecut('U')], { U: 1, B1: 8 }); } finally { console.log = realLog; delete globalThis.PP_TRACE_PLACEMENT; }
var blob = log.join('\n');
assert(blob.indexOf('РАЗМЕЩЕНИЕ #3985') >= 0, 'trace напечатан (заголовок размещения)');
assert(blob.indexOf('РЕАЛЬНЫЙ день') >= 0, 'trace показывает РЕАЛЬНЫЙ день (арбитр §12)');
assert(blob.indexOf('§12 релокация') >= 0, 'trace показывает итог §12-релокации');
assert(planning.slotTraceOn() === false, 'slotTraceOn: в Node без форса и без window → false (тесты молчат)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
