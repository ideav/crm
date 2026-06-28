// Unit tests for #3815 — «Планирование по срокам изготовления» (EDD).
// Симптом (боевой скрин): на 23.06 стоит позиция со сроком 24.06, а на 24.06 — позиция со
// сроком 23.06. Это неправильно: задание с более ранним «Сроком изготовления» должно стоять
// на более раннем дне. Раньше по-дневная раскладка (splitMachineQueue/selectByConfig) выбирала
// следующее задание ТОЛЬКО по непрерывности конфигурации (минимум переналадки) и исходному
// порядку очереди — срок не учитывался, поэтому задание с поздним сроком могло занять ранний
// день. Фикс: срок (c.dueKey) — приоритетный ключ (после «фольга в конец дня») и в orderCuts,
// и в selectByConfig; переналадка остаётся вторичным критерием ВНУТРИ одного срока.
//
// Run with: node experiments/atex-production-planning-3815.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// База — полночь 23.06.2026 UTC. День 0 = 23.06, день 1 = 24.06.
var BASE_MS = Date.UTC(2026, 5, 23, 0, 0, 0);   // 2026-06-23 00:00 UTC
var DUE_23 = 20260623, DUE_24 = 20260624;

function cut(id, mat, runs) {
    // planDate = база (день 0) → у всех заданий одинаковый якорь, splitMachineQueue свободно
    // раскладывает их по дням в порядке EDD.
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'IN',
        knifeWidths: [59], knifeCount: 1, plannedRuns: runs, planDate: String(Math.floor(BASE_MS / 1000)),
        sequence: null, isFoil: false };
}
// runs=2, perPass=60, окно дня 100 мин, BETWEEN_CUTS=0 → каждое задание занимает ровно один
// день (первый проход влезает, второй уходит нахлёстом и «закрывает» день).
function baseOpts(extra) {
    var o = { perPassByCut: { A: 60, B: 60 }, dayStartMin: 0, dayEndMin: 100,
        times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: BASE_MS, preserveOrder: false, gapFill: true };
    for (var k in (extra || {})) o[k] = extra[k];
    return o;
}
// День (0,1,…) каждого задания из planStartTs (секунды) относительно базы.
function dayOf(u) { return Math.round((Number(u.planStartTs) - Math.floor(BASE_MS / 1000)) / 86400); }
function dayByCut(ops) {
    var m = {};
    ops.updates.forEach(function(u) { m[u.cutId] = dayOf(u); });
    return m;
}

// ── 1) Срок определяет день: задание с ранним сроком — на ранний день ──
// Вход [A(срок 24.06), B(срок 23.06)]; без фикса A (первое в очереди) встаёт на день 0 (23.06),
// B — на день 1 (24.06) — ровно баг скрина. С фиксом: B(23.06)→день 0, A(24.06)→день 1.
var cuts1 = [ cut('A', 'matA', 2), cut('B', 'matB', 2) ];
var ops1 = planning.planCutOperations(cuts1, baseOpts({ dueKeyByCut: { A: DUE_24, B: DUE_23 } }));
assertEqual(dayByCut(ops1), { B: 0, A: 1 },
    '#3815: срок раньше → день раньше (B 23.06 на день 0, A 24.06 на день 1)');

// ── 2) Срок важнее переналадки: ранний срок берётся раньше, даже если это лишняя переналадка ──
// Текущая заправка станка = конфигурация A (matA). Без срока splitMachineQueue взял бы A первым
// (нулевая переналадка), отправив B (срок 23.06) на день 1. EDD ставит B первым, несмотря на
// смену сырья, — задание со сроком 23.06 не должно ехать на 24.06 ради экономии переналадки.
var carryA = { materialId: 'matA', winding: 'IN', knifeWidths: [59], knifeCount: 1, isFoil: false };
var ops2 = planning.planCutOperations([ cut('A', 'matA', 2), cut('B', 'matB', 2) ],
    baseOpts({ dueKeyByCut: { A: DUE_24, B: DUE_23 }, carryPrevCut: carryA,
        times: { BETWEEN_CUTS: 0, MATERIAL_WINDING: 15, KNIFE: 30 } }));
assertEqual(dayByCut(ops2), { B: 0, A: 1 },
    '#3815: срок 23.06 (B) на день 0, хотя заправка станка совпадает с A (24.06) — EDD важнее переналадки');

// ── 3) Несколько дней: все задания со сроком 23.06 идут РАНЬШЕ всех со сроком 24.06 ──
// 4 задания, каждое занимает день: A,C — срок 23.06; B,D — срок 24.06. EDD раскладывает оба
// «23.06» на первые дни (0,1), оба «24.06» — на следующие (2,3), несмотря на исходный порядок
// очереди [A,B,C,D] (вперемешку по сроку).
// #3821: 2 прохода по 50 = 100 = окно дня → задание заполняет день РОВНО (без нахлёстного
// прохода, который отменён #3821, и без разбивки). Одно сырьё у всех → переналадки между
// заданиями нет (иначе её хвост-сегмент сел бы на предыдущий день и сдвинул нумерацию).
var due3 = { A: DUE_23, B: DUE_24, C: DUE_23, D: DUE_24 };
var ops3 = planning.planCutOperations(
    [ cut('A', 'mat1', 2), cut('B', 'mat1', 2), cut('C', 'mat1', 2), cut('D', 'mat1', 2) ],
    { perPassByCut: { A: 50, B: 50, C: 50, D: 50 }, dayStartMin: 0, dayEndMin: 100,
      times: { BETWEEN_CUTS: 0 }, planBaseMidnightMs: BASE_MS, preserveOrder: false, gapFill: true,
      dueKeyByCut: due3 });
// Срок задания, попавшего на каждый день: дни 0–1 должны нести срок 23.06, дни 2–3 — 24.06
// (внутри одного срока порядок — по переналадке, здесь нам важна только привязка срок↔день).
var dueByDay3 = {};
Object.keys(dayByCut(ops3)).forEach(function(id) { dueByDay3[dayByCut(ops3)[id]] = due3[id]; });
assertEqual(dueByDay3, { 0: DUE_23, 1: DUE_23, 2: DUE_24, 3: DUE_24 },
    '#3815: все «23.06» — на ранние дни 0–1, все «24.06» — на дни 2–3 (EDD по дням, не вперемешку)');

// ── 4) Обратная совместимость: нет сроков → прежнее поведение (порядок очереди/переналадка) ──
// Без dueKeyByCut оба dueKey = Infinity, EDD-группировка вырождается в одну группу.
var ops4 = planning.planCutOperations([ cut('A', 'matA', 2), cut('B', 'matB', 2) ], baseOpts({}));
assertEqual(dayByCut(ops4), { A: 0, B: 1 },
    '#3815: нет сроков → исходный порядок очереди (A раньше B) сохранён');

// ── 5) orderCuts напрямую: задания упорядочены по сроку (EDD), фольга — всегда в конец ──
function ocCut(id, mat, due, foil) {
    return { id: id, materialId: mat, winding: 'IN', knifeWidths: [59], knifeCount: 1,
        plannedRuns: 1, isFoil: !!foil, dueKey: due };
}
var ordered = planning.orderCuts([
    ocCut('A', 'matA', DUE_24, false),
    ocCut('B', 'matB', DUE_23, false),
    ocCut('F', 'FOIL', DUE_23, true)    // фольга со сроком 23.06 — всё равно в конец
], { BETWEEN_CUTS: 0 }).map(function(c) { return c.id; });
assertEqual(ordered, ['B', 'A', 'F'],
    '#3815: orderCuts — раньше срок раньше (B 23 < A 24), фольга в конец несмотря на ранний срок');

// ── 6) Уже размещённые данные (баг скрина): якорь дня ослабляется до дня срока ──
// Прежняя (до #3815) раскладка поставила A(срок 24.06) на день 0, B(срок 23.06) на день 1 →
// их «Дата план» даёт якоря {A:0, B:1}. При повторной раскладке («Упорядочить»/генерация) старый
// якорь B (день 1) держал бы B на 24.06. Ослабление якоря до дня срока (день 0 для B) позволяет
// EDD подтянуть B на день 0, A уезжает на день 1 — баг исправляется и на существующих данных.
function cutAt(id, mat, planDateDay) {
    var ms = BASE_MS + planDateDay * 86400000;
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'IN', knifeWidths: [59],
        knifeCount: 1, plannedRuns: 2, planDate: String(Math.floor(ms / 1000)), sequence: null, isFoil: false };
}
var ops6 = planning.planCutOperations([ cutAt('A', 'matA', 0), cutAt('B', 'matB', 1) ],
    baseOpts({ dayAnchorByCut: { A: 0, B: 1 }, dueKeyByCut: { A: DUE_24, B: DUE_23 } }));
assertEqual(dayByCut(ops6), { B: 0, A: 1 },
    '#3815: ослабление якоря до дня срока — B(23.06) подтянут на день 0 на УЖЕ размещённых данных');

// ── 7) Зафиксированное задание (#3508) НЕ подтягивается — остаётся на своём дне ──
// B(срок 23.06) зафиксировано на дне 1: оператор закрепил день вручную, EDD его не двигает.
var bFixed = cutAt('B', 'matB', 1); bFixed.fixed = true;
var ops7 = planning.planCutOperations([ cutAt('A', 'matA', 0), bFixed ],
    baseOpts({ dayAnchorByCut: { A: 0, B: 1 }, dueKeyByCut: { A: DUE_24, B: DUE_23 } }));
assertEqual(dayByCut(ops7), { A: 0, B: 1 },
    '#3815: зафиксированное задание остаётся на своём дне (фикс важнее EDD)');

console.log('\n' + passed + ' passed');
