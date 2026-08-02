// #4566 — «Урегулировать» не кладёт работу в ЗАМОРОЖЕННЫЙ день.
//
// Боевое (ateh, 02.08.2026): после разделения частично выполненного задания (#4564) остаток встал
// на 03.08 07:59 — в ЗАМОРОЖЕННЫЙ день, поверх двух 🔒-заданий 08:00–16:32. День показал
// **521 мин при потолке 455** (+66 сверх смены), и пересборка сдвинуть остаток уже не могла.
//
// КОРЕНЬ. Задание, чья «Дата план» попала в замороженный день, планировщик пришпиливает временным
// `c.fixed` и все операции по нему отбрасывает («#4436: замороженные дни не трогаем — отброшено
// записей плана: 14»). То есть место, выбранное «Урегулировать», становится ОКОНЧАТЕЛЬНЫМ. А место
// выбиралось правилом «перед следующим заданием своего станка» (#4346) — без вопроса, можно ли в
// тот день вообще что-то класть.
//
// ПРАВИЛО. Якорь ищем только среди заданий, стоящих в НЕзамороженных днях; нет такого — ближайший
// свободный день (он уже пропускает замороженные). Разделение, чей ФАКТИЧЕСКИЙ день заморожен, не
// делаем вовсе и называем задание вызывающему: половинчатое разделение оставило бы остаток без
// выполненной части.
//
// Run with: node experiments/atex-production-planning-4566.test.js

process.env.TZ = 'Europe/Moscow';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

function tsAt(y, m, d, hh, mm) { return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000); }
function dayKey(y, m, d) { return y * 10000 + m * 100 + d; }
var TODAY = dayKey(2026, 8, 2);
var SHIFT_START = 480;   // 08:00

// Заморожен 03.08 — как в боевой ateh (запись «Заморозки» 656165).
function frozenAt(ts) { return planning.planDateDayKey(ts) === dayKey(2026, 8, 3); }

// ── 1) боевой случай: следующее задание станка стои́т в ЗАМОРОЖЕННОМ дне ───────
// Станок 1: частично выполненное 25 из 43 (просрочено, «Начато» 01.08), а ближайшее задание
// станка — 🔒 03.08 08:00 в замороженном дне. Остаток обязан уехать МИМО 03.08.
var cuts = [
    { id: 'part', slitter: { id: '1' }, plannedRuns: 43, actualRuns: 25,
      planDate: String(tsAt(2026, 7, 31, 9, 6)), startDate: String(tsAt(2026, 8, 1, 20, 30)), endDate: '' },
    { id: 'frozenday', slitter: { id: '1' }, plannedRuns: 100, actualRuns: 0, fixed: true,
      planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: '', endDate: '' },
    { id: 'openday', slitter: { id: '1' }, plannedRuns: 5, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
];
var groups = planning.deviationGroups(cuts, TODAY);
assertEqual(groups.overdue.map(function(c) { return c.id; }), ['part'], 'просрочено — частично выполненное');

var settle = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START, dayFrozenAt: frozenAt,
    freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
});
assertEqual(settle.splits.length, 1, 'разделение делаем — фактический день (01.08) не заморожен');
var sp = settle.splits[0];
assertEqual([sp.doneRuns, sp.restRuns], [25, 18], 'сделано 25 из 43 → выполненная часть 25, остаток 18');
assertEqual(planning.planDateDayKey(sp.restPlanStart) === dayKey(2026, 8, 3), false,
    '#4566: остаток НЕ встаёт в замороженный день (там он остался бы навсегда — 521 мин)');
assertEqual(sp.restPlanStart, tsAt(2026, 8, 4, 8, 0) - 60,
    'якорь — первое задание станка в НЕзамороженном дне (04.08), остаток встаёт перед ним');

// Без незамороженного якоря — ближайший свободный день (он замороженные уже пропускает).
var onlyFrozen = [cuts[0], cuts[1]];
var s2 = planning.deviationSettlePlan(onlyFrozen, planning.deviationGroups(onlyFrozen, TODAY), {
    todayKey: TODAY, shiftStartMin: SHIFT_START, dayFrozenAt: frozenAt,
    freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
});
assertEqual(s2.splits[0].restPlanStart, tsAt(2026, 8, 4, 8, 0),
    'все задания станка в замороженном дне → остаток на ближайший свободный день, 08:00');
assertEqual(s2.splits[0].restReason, 'free-day', 'причина места — «ближайший свободный день»');

// ── 2) то же правило для ОБЫЧНОГО просроченного (не разделяемого) ─────────────
var plainCuts = [
    { id: 'late', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
      planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: '', endDate: '' },
    { id: 'frozenday', slitter: { id: '1' }, plannedRuns: 100, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: '', endDate: '' },
    { id: 'openday', slitter: { id: '1' }, plannedRuns: 5, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
];
var s3 = planning.deviationSettlePlan(plainCuts, planning.deviationGroups(plainCuts, TODAY), {
    todayKey: TODAY, shiftStartMin: SHIFT_START, dayFrozenAt: frozenAt,
    freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
});
assertEqual(s3.moves, [{ id: 'late', planStart: tsAt(2026, 8, 4, 8, 0) - 60, reason: 'before-next' }],
    '#4566: просроченное тоже не встаёт в замороженный день — правило одно на оба пути');

// ── 3) ФАКТИЧЕСКИЙ день заморожен → не разделяем и называем задание ───────────
var factFrozen = [
    { id: 'partF', slitter: { id: '1' }, plannedRuns: 43, actualRuns: 25,
      planDate: String(tsAt(2026, 7, 31, 9, 6)), startDate: String(tsAt(2026, 8, 3, 10, 0)), endDate: '' },
    { id: 'openday', slitter: { id: '1' }, plannedRuns: 5, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
];
var s4 = planning.deviationSettlePlan(factFrozen, planning.deviationGroups(factFrozen, TODAY), {
    todayKey: TODAY, shiftStartMin: SHIFT_START, dayFrozenAt: frozenAt,
    freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
});
assertEqual(s4.splits, [], 'фактический день заморожен → разделение не делаем');
assertEqual(s4.skipped, [{ id: 'partF', reason: 'frozen-fact-day' }],
    'задание названо вызывающему — диспетчер снимет заморозку и повторит');
assertEqual(s4.moves.map(function(m) { return m.id; }), [],
    'и не двигаем его как обычное просроченное: выполненная часть осталась бы без своего дня');

// ── 4) без «Заморозки» в сборке поведение прежнее ────────────────────────────
var s5 = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    freeDayMsFor: function() { return new Date(2026, 7, 4, 0, 0, 0, 0).getTime(); }
});
assertEqual(s5.splits[0].restPlanStart, tsAt(2026, 8, 3, 8, 0) - 60,
    'предикат не передан → якорем берётся ближайшее задание станка, как и до #4566');

console.log('\n' + passed + '/' + total + ' passed');
if (passed !== total) process.exitCode = 1;
