// #4830 — «Урегулировать» и начатое с НЕИЗВЕСТНЫМ фактом проходов у станка с ЗАКРЫТОЙ сменой.
//
// ТЗ (issue #4830): «Если факт проходов неизвестен в РМ Планирование, а смена закрыта в РМ
// Слиттер — двигаем, считаем 0 проходов». Типичный случай заказчика: настройка выполнена
// («Начато» стоит), а резок до закрытия смены не было — прежнее «не двигаем» (#4381) оставляло
// работу в дне, которого у станка больше нет. У ПРОСРОЧЕННОГО при ещё открытых сменах работа
// может идти — неприкосновенность #4381 остаётся.
//
// Run with: node experiments/atex-production-planning-4830.test.js

process.env.TZ = 'UTC';

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
function tsAt(y, m, d, hh, mm) { return Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000); }
function ids(list) { return (list || []).map(function(c) { return c.id; }); }

var TODAY = 20260831;                  // понедельник 31.08.2026 (день из тикета)
var TOMORROW_MS = new Date(2026, 8, 1, 0, 0, 0, 0).getTime();
var SHIFT_START = 480;                 // 08:00

// Станок 1 сегодня закрыл смену (19:26 — как в тикете), станок 2 ещё работает.
var closed = { '1': tsAt(2026, 8, 31, 19, 26) };

var cuts = [
    // «Смена закрыта»: НАЧАТО (настройка выполнена), факта проходов НЕТ — колонки в отчёте нет.
    { id: 'blind', slitter: { id: '1' }, plannedRuns: 20,
      planDate: String(tsAt(2026, 8, 31, 15, 6)), startDate: String(tsAt(2026, 8, 31, 15, 6)), endDate: '' },
    // Следующее задание станка 1 — завтра 08:00: перед ним и встанет «blind».
    { id: 'next', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
      planDate: String(tsAt(2026, 9, 1, 8, 0)), startDate: '', endDate: '' },
    // Просрочка станка 2 (смена ОТКРЫТА), начато, факт неизвестен — прежнее правило #4381.
    { id: 'run', slitter: { id: '2' },
      planDate: String(tsAt(2026, 8, 28, 8, 0)), startDate: String(tsAt(2026, 8, 28, 8, 10)), endDate: '' },
    // Просрочка станка 2 без «Начато» — едет; у станка 2 нет следующего, значит свободный день.
    { id: 'late', slitter: { id: '2' }, plannedRuns: 5, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 29, 8, 0)), startDate: '', endDate: '' }
];

// ── 1) группы отклонений ──────────────────────────────────────────────────────
var groups = planning.deviationGroups(cuts, TODAY, { shiftClosedSlitters: closed });
assertEqual(ids(groups.shiftClosed), ['blind'],
    'начатое без факта у станка с закрытой сменой — в группе «Смена закрыта» (#4596)');
assertEqual(ids(groups.overdue), ['run', 'late'], 'просрочка прежняя — сегодняшнее в неё не попадает');

// ── 2) «Урегулировать»: неизвестный факт при закрытой смене едет, при открытой — нет ──
var settle = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    shiftClosedSlitters: closed,
    freeDayMsFor: function() { return TOMORROW_MS; }
});
var moveById = {};
settle.moves.forEach(function(m) { moveById[m.id] = m; });

assertEqual(settle.splits.length, 0, 'факт неизвестен — делить нечем: разделений нет');
assertEqual(moveById['blind'], { id: 'blind', planStart: tsAt(2026, 9, 1, 8, 0), reason: 'before-next' },
    '#4830 начатое с неизвестным фактом у станка с ЗАКРЫТОЙ сменой едет перед следующим — считаем 0 проходов');
assertEqual(moveById['next'], { id: 'next', planStart: tsAt(2026, 9, 1, 8, 0) + 60, reason: 'shift-next' },
    '#4574 следующее задание станка отходит на минуту — за приезжими');
assertEqual(moveById['run'], undefined,
    '#4381 у просроченного при ОТКРЫТЫХ сменах работа может идти — не двигаем');
assertEqual(moveById['late'], { id: 'late', planStart: TOMORROW_MS / 1000 + SHIFT_START * 60, reason: 'free-day' },
    'незанятая просрочка едет на ближайший свободный день — как прежде');

// ── 3) известный факт ведёт по-прежнему: ноль — двигаем, часть — разделяем ────
var known = cuts.map(function(c) {
    if (c.id === 'blind') return Object.assign({}, c, { actualRuns: 0 });
    return c;
});
var kGroups = planning.deviationGroups(known, TODAY, { shiftClosedSlitters: closed });
var kSettle = planning.deviationSettlePlan(known, kGroups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    shiftClosedSlitters: closed,
    freeDayMsFor: function() { return TOMORROW_MS; }
});
var kMoves = {};
kSettle.moves.forEach(function(m) { kMoves[m.id] = m; });
assertEqual(kMoves['blind'], { id: 'blind', planStart: tsAt(2026, 9, 1, 8, 0), reason: 'before-next' },
    '#4564 известный НОЛЬ при закрытой смене — двигается как и прежде');

var partial = cuts.map(function(c) {
    if (c.id === 'blind') return Object.assign({}, c, { actualRuns: 7 });
    return c;
});
var pGroups = planning.deviationGroups(partial, TODAY, { shiftClosedSlitters: closed });
var pSettle = planning.deviationSettlePlan(partial, pGroups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    shiftClosedSlitters: closed,
    freeDayMsFor: function() { return TOMORROW_MS; }
});
assertEqual(pSettle.splits.length, 1,
    '#4596 известная ЧАСТЬ при закрытой смене — разделяется, как и прежде');
var pSp = pSettle.splits[0] || {};
assertEqual([pSp.id, pSp.doneRuns, pSp.restRuns], ['blind', 7, 13],
    'сделано 7 из 20 → выполненная часть 7, остаток 13');

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
