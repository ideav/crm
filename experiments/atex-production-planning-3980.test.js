// Unit tests for #3980 — просроченная резка (красный) не должна стоять ПОСЛЕ дальней
// (оранжевой) при ОДИНАКОВОЙ конфигурации ножей.
//
// Модель (issue #3980, уточняет #3974):
//   • #3974 убрал «Срок изготовления» (dueKey) из раскладки: он не привязывает день (day-anchor
//     #3658 снят) и не фильтрует вход (scope #3660 снят). Это остаётся.
//   • #3980 возвращает срок ТОЛЬКО как тай-брейк ПОРЯДКА резки (orderCuts), подчинённый минимуму
//     переналадки: при РАВНОЙ стоимости перехода раньше идёт резка с более ранним сроком.
//     Так просроченная резка той же конфигурации ножей (переналадка та же) не встаёт после дальней.
//   • Группировку сырья/ножей (#3783/#3974), ёмкость дня, фольгу-в-конец (#3717) НЕ трогаем.
//
// Run with: node experiments/atex-production-planning-3980.test.js

process.env.TZ = 'Europe/Moscow';

var planning = require('../download/atex/js/production-planning.js').planning;

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

// Времена переналадки как в ATEH: смена сырья 15, смена ножей 30, лидер 0.
var TIMES = { BETWEEN_CUTS: 0, MATERIAL_WINDING: 15, KNIFE: 30 };

// Резка станка m1. Все с ОДНИМ набором ножей (63.5×14 полос) → knifeWidthSig одинаков,
// переход между ними = только смена сырья (15), без смены ножей. mat — «Вид сырья».
function cut(id, mat, dueKey, runs) {
    return {
        id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'OUT',
        knifeWidths: [63.5], knifeCount: 14, rollerWidth: 0,
        plannedRuns: runs == null ? 2 : runs, isFoil: false,
        dueKey: dueKey == null ? Infinity : dueKey
    };
}

// ── 1) orderCuts: при равной переналадке раньше идёт более ранний срок ──
// «far» (MWR200, срок 12.07) и «overdue» (MW401, срок 24.06). Разное сырьё, ОДНИ ножи →
// переход 15 в любом порядке (стоимость равна) → решает срок: overdue раньше far.
var far = cut('far', 'matMWR200', 20260712);
var overdue = cut('overdue', 'matMW401', 20260624);
var seq1 = planning.orderCuts([far, overdue], TIMES).map(function(c) { return c.id; });
assertEqual(seq1, ['overdue', 'far'],
    '#3980: при одинаковых ножах просроченная (срок 24.06) идёт раньше дальней (срок 12.07)');

// Контроль: без сроков (Infinity) порядок прежний — тай-брейк по id/полосам (#3785), не по сроку.
var seq1c = planning.orderCuts([cut('far', 'matMWR200'), cut('overdue', 'matMW401')], TIMES)
    .map(function(c) { return c.id; });
assertEqual(seq1c, ['far', 'overdue'],
    '#3980: без сроков порядок не меняется (обратная совместимость, тай-брейк по id)');

// ── 2) Срок НЕ ломает группировку сырья (переналадка первична) ──
// Два сырья по две резки. matA срок поздний, matB срок ранний. Группировка должна держать
// одинаковое сырьё подряд (иначе лишняя смена сырья), а срок лишь решает, какой БЛОК раньше.
var seq2 = planning.orderCuts([
    cut('a2', 'matA', 20260720), cut('b1', 'matB', 20260610),
    cut('a1', 'matA', 20260715), cut('b2', 'matB', 20260612)
], TIMES).map(function(c) { return c.id; });
// Блок matB (ранний срок) раньше блока matA; внутри блока — по сроку возрастанию.
assertEqual(seq2, ['b1', 'b2', 'a1', 'a2'],
    '#3980: блоки сырья целы; более ранний по сроку блок — раньше, внутри блока — по сроку');

// ── 3) Фольга остаётся в конец, срок её не вытаскивает вперёд (#3717) ──
var foilEarly = cut('foilEarly', 'matA', 20260601); foilEarly.isFoil = true;
var normLate = cut('normLate', 'matA', 20260901);
var seq3 = planning.orderCuts([foilEarly, normLate], TIMES).map(function(c) { return c.id; });
assertEqual(seq3, ['normLate', 'foilEarly'],
    '#3980: фольга (даже с ранним сроком) — в конец дня; срок не нарушает #3717');

// ── 4) planCutOperations end-to-end: просроченная попадает на РАННИЙ день ──
// Две резки по 400 мин намотки, ёмкость 450 → в день влезает одна (30/15 настройка + 400).
// Разное сырьё, одни ножи. dueKeyByCut даёт overdue ранний срок → overdue день 0, far день 1.
var BASE_MS = new Date(2026, 6, 1, 0, 0, 0).getTime();   // 01.07.2026 = день 0
var BASE_SEC = Math.floor(BASE_MS / 1000);
var DAY_START = 480, CAP = 450;

function plan(cuts, dueKeyByCut) {
    var opts = {
        weights: TIMES,
        times: TIMES,
        perPassByCut: cuts.reduce(function(o, c) { o[c.id] = 400; return o; }, {}),
        dayStartMin: DAY_START, dayEndMin: DAY_START + CAP,
        planBaseMidnightMs: BASE_MS, preserveOrder: false, gapFill: true,
        firstCutSetup: true
    };
    if (dueKeyByCut) opts.dueKeyByCut = dueKeyByCut;
    var ops = planning.planCutOperations(cuts, opts);
    var day = {}, order = [];
    ops.updates.slice()
        .sort(function(a, b) { return Number(a.planStartTs) - Number(b.planStartTs); })
        .forEach(function(u) {
            day[u.cutId] = Math.floor((Number(u.planStartTs) - BASE_SEC) / 86400);
            order.push(u.cutId);
        });
    return { day: day, order: order };
}

// Одна резка = 1 проход × 400 мин намотки. В день (ёмкость 450) влезает одна: 30/15 настройка +
// 400 = 430/415; вторая (+15+400) переливается на следующий день.
// Одна резка = 1 проход × 400 мин намотки. По planStartTs (возрастание) видно, кто раньше в
// смене: с dueKeyByCut просроченная overdue получает более раннее время старта, чем дальняя far.
var e2eCuts = [ cut('far', 'matMWR200', null, 1), cut('overdue', 'matMW401', null, 1) ];
var rNoDue = plan(e2eCuts);
var rDue = plan(e2eCuts, { far: 20260712, overdue: 20260624 });
assertEqual(rDue.order, ['overdue', 'far'],
    '#3980 e2e: с dueKeyByCut просроченная (overdue) стартует РАНЬШЕ дальней (far)');
assertEqual(rDue.day.overdue <= rDue.day.far, true,
    '#3980 e2e: день просроченной не позже дня дальней');
// Контроль: без сроков порядок по id (far раньше) — поведение #3974 сохранено.
assertEqual(rNoDue.order, ['far', 'overdue'],
    '#3980 e2e: без сроков порядок по id — far стартует раньше (поведение #3974 сохранено)');

console.log('\n' + passed + ' passed');
