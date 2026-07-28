// Unit tests for #4462 — «Правила подсчёта веса должны быть доступны для анализа».
// Слой размещения (#4085) перебирает все точки вставки и выбирает минимальный штраф, но ИСТОРИЮ
// решения не хранил: в трассе были только «первый рассмотренный» и «выбранный» (#4095), а
// проигравшие варианты схлопывались в betterCand без следа. Оператор, увидев задание в разрыве
// между двумя чужими, не мог узнать, ЧТО с ним сравнивали и насколько дешевле оно оказалось.
//
// Проверяем: (1) placeSlot запоминает ДВЕ ближайшие альтернативы среди ВСЕХ просмотренных точек
// (включая другие станки), с Δ веса и разбором по факторам; (2) чистый форматтер подсказки печатает
// применённые веса и НЕ печатает аннигилированные (нулевые); (3) planCutOperations отдаёт разбор
// наружу (ops.placement) и по нему строятся подсказки ТОЛЬКО для тронутых планом заданий.
//
// Run with: node experiments/atex-production-planning-4462.test.js

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

// ── Часть 1: две ближайшие альтернативы среди ВСЕХ просмотренных точек ────────────────────────────
console.log('\n== trace.tasks[*].alternatives: две ближайшие альтернативы с Δ веса и факторами ==');
var trace = planning.computeSlotPlacement(
    [cut('A', { mat: 'M1' }), cut('B', { mat: 'M2', kw: [40, 40, 40] }), cut('C', { mat: 'M1' })],
    { settings: {}, times: TIMES, capacityMin: 1000, baseMidnightMs: 0,
      perPassByCut: { A: 30, B: 30, C: 30 }, slitterIds: ['m1', 'm2'], trace: true, relocate: false }).trace;
var tC = (trace.tasks || []).filter(function (t) { return t.id === 'C'; })[0] || {};
var altC = tC.alternatives || [];   // ещё не реализовано → пустой список, тест краснеет проверками, а не падением
assert(!!tC && tC.variants >= 3, 'задание C: рассмотрено ≥3 вариантов вставки (' + (tC && tC.variants) + ')');
assert(!!tC && Array.isArray(tC.alternatives), 'у задания есть список alternatives (история решения)');
assert(altC.length === 2, 'альтернатив ровно две — «две ближайшие» (' + altC.length + ')');
var altOk = altC.length > 0 && altC.every(function (a) {
    return a && a.machineId != null && a.index != null && typeof a.weight === 'number'
        && typeof a.delta === 'number' && a.byFactor && typeof a.byFactor === 'object';
});
assert(altOk, 'каждая альтернатива несёт станок, позицию, вес, Δ к выбранному и разбор по факторам');
var chosenC = tC.chosen || {};
var notChosen = altC.length > 0 && altC.every(function (a) {
    return !(String(a.machineId) === String(chosenC.machineId) && Number(a.index) === Number(chosenC.index));
});
assert(notChosen, 'выбранный вариант в альтернативы не попадает (это именно проигравшие)');
var sortedByCloseness = altC.length === 2 && altC[0].delta <= altC[1].delta;
assert(sortedByCloseness, 'альтернативы идут по близости: Δ первой ≤ Δ второй');
var crossMachine = altC.some(function (a) { return String(a.machineId) !== String(chosenC.machineId); });
assert(crossMachine, 'альтернативы ищутся среди ВСЕХ просмотренных точек — есть вариант с другого станка');

// ── Часть 1б: РУЧНОЙ ПЕРЕНОС (замок дня) — репро из issue: задание вклинивается в разрыв ───────────
// «Переношу задание в другой день, оно вклинивается в разрыв с существующими заданиями, нарушая
// ожидаемую математику весов». Ожидаемая математика не нарушена — просто самый дешёвый вариант лежал
// ВНЕ выбранного дня и отклонён замком переноса, а не ценой. Подсказка обязана это показать.
console.log('\n== ручной перенос: альтернативы видны и ПОМЕЧЕНЫ как отклонённые замком дня ==');
var lockTrace = planning.computeSlotPlacement(
    [cut('A', { fixed: true }), cut('B', { fixed: true }), cut('D', { fixed: true, mat: 'M2' }),
     cut('C', { mat: 'M3', kw: [70, 30] })],
    { settings: {}, times: TIMES, capacityMin: 200, baseMidnightMs: Date.parse('2026-07-28T00:00:00Z'),
      perPassByCut: { A: 30, B: 30, D: 30, C: 30 }, slitterIds: ['m1'],
      dayLockByCut: { C: 1 }, trace: true, relocate: false }).trace;
var tL = (lockTrace.tasks || []).filter(function (t) { return t.id === 'C'; })[0] || {};
assert(tL.lockSkipped > 0, 'точки вне выбранного дня посчитаны отдельно (lockSkipped=' + tL.lockSkipped + ')');
assert((tL.alternatives || []).length > 0, 'при замке дня альтернативы всё равно показаны (перебор шёл по всем дням)');
assert((tL.alternatives || []).some(function (a) { return a.outOfLock; }),
    'альтернатива вне замкового дня помечена outOfLock — отклонил замок, а не вес');
var lockTitle = planning.formatPlacementDecisionTitle(tL);
assert(lockTitle.indexOf('вне выбранного дня') >= 0, 'в подсказке сказано, сколько точек отсёк замок дня');
assert(lockTitle.indexOf('отклонён замком переноса, не весом') >= 0,
    'подсказка объясняет, почему более дешёвый вариант не выбран');

// ── Часть 2: форматтер подсказки — применённые веса без аннигилированных ──────────────────────────
console.log('\n== formatPlacementDecisionTitle: печатаются применённые веса, нулевые — нет ==');
var synthetic = {
    id: '777', dueKey: 20260801, isFoil: false, workMin: 120, variants: 9, skipped: 2, lockSkipped: 3,
    chosen: { machineId: 'Станок 1', index: 3, weight: 245, dayOffset: 1, placementDayKey: 20260802,
              byFactor: { knife: 30, material: 0, deadline: 200, order: -10, leader: 0, breakKnives: 25 } },
    alternatives: [
        { machineId: 'Станок 1', index: 4, weight: 250, delta: 5, placementDayKey: 20260802, byFactor: { knife: 50, material: 0 } },
        // Ни у выбранного, ни у альтернатив нет НЕнулевого «сырья»/«лидера» — по ним и проверяем,
        // что аннигилированные слагаемые в подсказку не попадают.
        { machineId: 'Станок 2', index: 0, weight: 275, delta: 30, placementDayKey: 20260803, byFactor: { knife: 30, distance: 25, material: 0 } }
    ]
};
var title = (typeof planning.formatPlacementDecisionTitle === 'function')
    ? planning.formatPlacementDecisionTitle(synthetic) : '';
assert(typeof title === 'string' && title.length > 0, 'форматтер отдаёт непустой текст подсказки');
assert(title.indexOf('рассмотрено вариантов 9') >= 0, 'в подсказке — сколько вариантов просмотрено');
assert(title.indexOf('245') >= 0 && title.indexOf('Станок 1') >= 0, 'в подсказке — выбранная позиция и её вес');
assert(/ножи \+30/.test(title), 'применённый вес печатается с величиной (ножи +30)');
assert(/просрочка \+200/.test(title), 'штраф срока печатается (просрочка +200)');
assert(/-10/.test(title) || /−10/.test(title), 'бонус соседства заказа печатается со знаком минус');
assert(title.indexOf('сырьё') < 0 && title.indexOf('лидер') < 0, 'аннигилированные (нулевые) веса НЕ печатаются');
assert(title.indexOf('+0') < 0, 'нулевых слагаемых «+0» в подсказке нет');
assert(/\+5/.test(title) && /\+30/.test(title), 'у альтернатив показана Δ веса к выбранному');
assert(title.split('\n').length >= 4, 'подсказка многострочная (выбор + две альтернативы)');
assert(typeof planning.formatPlacementDecisionTitle === 'function' && planning.formatPlacementDecisionTitle(null) === '', 'formatPlacementDecisionTitle(null) → пусто (без падения)');

// ── Часть 3: подсказка навешивается ТОЛЬКО на тронутые планом задания ─────────────────────────────
console.log('\n== placementTitlesByCut: только задания, которые план реально тронул ==');
var titlesFn = planning.placementTitlesByCut || function () { return {}; };
var titles = titlesFn({ tasks: [synthetic, { id: '888', variants: 4, chosen: { machineId: 'Станок 2', index: 0, weight: 10, byFactor: {} }, alternatives: [] }] }, ['777']);
assert(titles && typeof titles === 'object', 'placementTitlesByCut отдаёт карту cutId → подсказка');
assert(typeof titles['777'] === 'string' && titles['777'].length > 0, 'тронутое задание получило подсказку');
assert(titles['888'] == null, 'нетронутое задание подсказки не получает');
assert(typeof planning.placementTitlesByCut === 'function' && Object.keys(titlesFn(null, ['777'])).length === 0, 'нет разбора → пустая карта (без падения)');

// ── Часть 4: end-to-end — planCutOperations отдаёт разбор наружу ──────────────────────────────────
console.log('\n== planCutOperations: ops.placement — разбор выбора наружу (для подсказки в очереди) ==');
var BASE = new Date('2026-06-23T00:00:00').getTime();
function ecut(id, o) {
    o = o || {};
    return { id: id, slitter: { id: o.m || 'm1' }, materialId: o.mat || 'M1', winding: 'OUT', knifeWidths: [50, 50],
             knifeCount: 2, rollerWidth: 0, plannedRuns: o.runs == null ? 1 : o.runs, isFoil: false,
             length: 100, planDate: '', status: '', fixed: false };
}
function ymdB(off) { var d = new Date(BASE + off * 86400000); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
var cutsE = [ecut('B1'), ecut('B2', { mat: 'M2' }), ecut('U')];
var perPass = {}; cutsE.forEach(function (c) { perPass[c.id] = 100; });
var due = { U: 1, B1: 8, B2: 8 }, dk = {}; Object.keys(due).forEach(function (id) { dk[id] = ymdB(due[id]); });
var ops = planning.planCutOperations(cutsE, {
    weights: planning.makePlanningOptions('SETUP', { BETWEEN_CUTS: 0 }),
    times: { BETWEEN_CUTS: 0 }, dayStartMin: 0, dayEndMin: 120, dayEndHourMin: 120, lunchDurationMin: 0,
    perPassByCut: perPass, planBaseMidnightMs: BASE, preserveOrder: false, dayAnchorByCut: {},
    dueDayByCut: due, dueKeyByCut: dk, gapFill: true, slotPlacement: true, slitterIds: ['m1']
});
assert(!!ops.placement && Array.isArray(ops.placement.tasks) && ops.placement.tasks.length > 0,
    'planCutOperations возвращает ops.placement с разбором по заданиям');
var anyAlt = (ops.placement && ops.placement.tasks || []).some(function (t) { return (t.alternatives || []).length > 0; });
assert(anyAlt, 'в разборе есть задания с альтернативами (перебор был не из одной точки)');
var e2eTitles = titlesFn(ops.placement, ['U']);
assert(typeof e2eTitles['U'] === 'string' && e2eTitles['U'].indexOf('рассмотрено вариантов') >= 0,
    'по ops.placement строится подсказка для конкретного задания');
// Разбор обязан быть честным: если задание после §8-размещения переносил другой проход, подсказка
// не имеет права выдавать выбор §8 за окончательный.
var hasMovedFlag = (ops.placement && ops.placement.tasks || []).every(function (t) { return 'movedAfter' in t; });
assert(hasMovedFlag, 'у каждого задания есть признак «переносил ли место последующий проход»');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
