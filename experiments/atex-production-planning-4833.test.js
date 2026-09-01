// #4833 — «Урегулировать» и начатое с НЕИЗВЕСТНЫМ фактом проходов у ПРОСРОЧЕННЫХ заданий.
//
// ТЗ (issue #4833): «То же самое, что чинили здесь #4831, но для просроченных» — если факт
// проходов неизвестен, а смена станка ЗАКРЫТА (последнее событие журнала — «Конец смены»,
// хоть вчера вечером), просроченное двигаем, считая 0 проходов. Мерка «в смене ли станок» —
// та же, что видит оператор в РМ Слиттер (#4332 п.2): последнее событие станка, дата не важна.
// У станка с ИДУЩЕЙ сменой работа может идти — неприкосновенность #4381 остаётся.
//
// Run with: node experiments/atex-production-planning-4833.test.js

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

var TODAY = 20260901;                  // вторник 01.09.2026 (разбор просрочки за 31.08)
var TOMORROW_MS = new Date(2026, 8, 2, 0, 0, 0, 0).getTime();
var SHIFT_START = 480;                 // 08:00

// ── 1) «в смене ли станок» — последнее событие, дата не важна (#4332 п.2) ─────
// Станок 1 закрылся ВЧЕРА 19:26 (сценарий тикета) и сегодня ещё не открывался.
// Станок 2 открыл смену сегодня 08:00 — работает. Станок 3 закрылся сегодня 19:10.
// Станок 4: открыл вчера, закрыл сегодня, снова открыл — последнее = открытие.
// Станок 5: событий нет вовсе. Станок 6: события только без станка.
var eventRows = [
    { event_id: '1', event_when: String(tsAt(2026, 8, 31, 19, 26)), event_type: 'Конец смены', slitter_id: '1' },
    { event_id: '2', event_when: String(tsAt(2026, 9, 1, 8, 0)), event_type: 'Начало смены', slitter_id: '2' },
    { event_id: '3', event_when: String(tsAt(2026, 9, 1, 19, 10)), event_type: 'Конец смены', slitter_id: '3' },
    { event_id: '4', event_when: String(tsAt(2026, 8, 31, 8, 0)), event_type: 'Начало смены', slitter_id: '4' },
    { event_id: '5', event_when: String(tsAt(2026, 9, 1, 12, 0)), event_type: 'Конец смены', slitter_id: '4' },
    { event_id: '6', event_when: String(tsAt(2026, 9, 1, 12, 30)), event_type: 'Начало смены', slitter_id: '4' },
    { event_id: '7', event_when: String(tsAt(2026, 9, 1, 9, 0)), event_type: 'Конец смены',
      event_notes: 'Станок 6 · 01.09.2026' }
];
var events = planning.rowsToShiftEvents(eventRows);
var BY_LABEL = { 'Станок 6': '6' };
var notOpen = planning.shiftNotOpenSlitters(events, { slitterIdByLabel: BY_LABEL });
assertEqual(Object.keys(notOpen).sort(), ['1', '3', '6'],
    '#4833 не в смене: закрылся вчера (1), закрылся сегодня (3), закрыл по метке «Примечаний» (6)');
assertEqual(notOpen['1'], tsAt(2026, 8, 31, 19, 26), 'штамп последнего закрытия запомнен');
assertEqual(planning.shiftNotOpenSlitters(events)['2'], undefined,
    'смена идёт (открыта сегодня, не закрыта) — станок в смене');
assertEqual(planning.shiftNotOpenSlitters(events)['4'], undefined,
    'закрылся и снова открылся — в смене (#4332: последнее событие решает)');
assertEqual(planning.shiftNotOpenSlitters([], { slitterIdByLabel: BY_LABEL }), {},
    'журнала нет — карта пуста, вслепую не двигаем');
// Сегодняшняя карта #4596 при том же журнале — прежняя: только закрывшие СЕГОДНЯ.
var closedToday = planning.shiftClosedSlitters(events, TODAY, { slitterIdByLabel: BY_LABEL });
assertEqual(Object.keys(closedToday).sort(), ['3', '6'],
    '#4596 не сломан: «день кончился» — только у закрывших смену СЕГОДНЯ');

// ── 2) просроченные начатые с неизвестным фактом ──────────────────────────────
// Все задания спланированы на 31.08 (вчера) → просрочены. У станков 1 и 3 смена закрыта —
// работа не идёт, двигаем. У станков 2, 4 (смена идёт) и 5 (событий нет) — не трогаем (#4381).
var cuts = [
    { id: 'c1', slitter: { id: '1' }, plannedRuns: 20,
      planDate: String(tsAt(2026, 8, 31, 15, 6)), startDate: String(tsAt(2026, 8, 31, 15, 6)), endDate: '' },
    { id: 'c2', slitter: { id: '2' }, plannedRuns: 10,
      planDate: String(tsAt(2026, 8, 31, 8, 0)), startDate: String(tsAt(2026, 8, 31, 8, 10)), endDate: '' },
    { id: 'c3', slitter: { id: '3' }, plannedRuns: 12,
      planDate: String(tsAt(2026, 8, 31, 9, 0)), startDate: String(tsAt(2026, 8, 31, 9, 5)), endDate: '' },
    { id: 'c4', slitter: { id: '4' }, plannedRuns: 8,
      planDate: String(tsAt(2026, 8, 31, 10, 0)), startDate: String(tsAt(2026, 8, 31, 10, 5)), endDate: '' },
    { id: 'c5', slitter: { id: '5' }, plannedRuns: 6,
      planDate: String(tsAt(2026, 8, 31, 11, 0)), startDate: String(tsAt(2026, 8, 31, 11, 5)), endDate: '' },
    // Сегодняшнее начатое станка 3 (смена закрыта сегодня) — группа «Смена закрыта» (#4830).
    { id: 't3', slitter: { id: '3' }, plannedRuns: 15,
      planDate: String(tsAt(2026, 9, 1, 8, 0)), startDate: String(tsAt(2026, 9, 1, 8, 5)), endDate: '' },
    // Следующее задание станка 3 — завтра: перед ним встанут c3 и t3.
    { id: 'next3', slitter: { id: '3' }, plannedRuns: 30, actualRuns: 0,
      planDate: String(tsAt(2026, 9, 2, 8, 0)), startDate: '', endDate: '' }
];
var groups = planning.deviationGroups(cuts, TODAY, { shiftClosedSlitters: closedToday });
assertEqual(ids(groups.overdue), ['c2', 'c3', 'c4', 'c5', 'c1'], 'просрочены все вчерашние (по плановому времени)');
assertEqual(ids(groups.shiftClosed), ['t3'], '#4830 сегодняшнее у закрывшего смену — в отдельной группе');

var settle = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    shiftClosedSlitters: closedToday,
    shiftNotOpenSlitters: notOpen,
    freeDayMsFor: function() { return TOMORROW_MS; }
});
var moveById = {};
settle.moves.forEach(function(m) { moveById[m.id] = m; });

assertEqual(settle.splits.length, 0, 'факт неизвестен — делить нечего: разделений нет');
assertEqual(moveById['c1'], { id: 'c1', planStart: TOMORROW_MS / 1000 + SHIFT_START * 60, reason: 'free-day' },
    '#4833 просроченное начатое с неизвестным фактом у станка, закрывшего смену ВЧЕРА, — едет (0 проходов)');
assertEqual(moveById['c3'], { id: 'c3', planStart: tsAt(2026, 9, 2, 8, 0), reason: 'before-next' },
    '#4833 просроченное у станка, закрывшего смену СЕГОДНЯ, — едет перед следующим');
assertEqual(moveById['t3'], { id: 't3', planStart: tsAt(2026, 9, 2, 8, 0) + 60, reason: 'before-next' },
    '#4830 сегодняшнее у станка вне смены — едет следом за просроченным');
assertEqual(moveById['next3'], { id: 'next3', planStart: tsAt(2026, 9, 2, 8, 0) + 120, reason: 'shift-next' },
    '#4574 следующее задание станка 3 отходит на две минуты');
assertEqual(moveById['c2'], undefined, '#4381 смена станка ИДЁТ — работа может идти, не двигаем');
assertEqual(moveById['c4'], undefined, '#4381 закрылся и снова открылся — в смене, не двигаем');
assertEqual(moveById['c5'], undefined, '#4381 событий смены нет — про станок ничего не знаем, не двигаем');

// ── 3) известный факт ведёт по-прежнему ────────────────────────────────────────
var known = cuts.map(function(c) {
    if (c.id === 'c1') return Object.assign({}, c, { actualRuns: 0 });
    if (c.id === 'c3') return Object.assign({}, c, { actualRuns: 5 });
    return c;
});
var kGroups = planning.deviationGroups(known, TODAY, { shiftClosedSlitters: closedToday });
var kSettle = planning.deviationSettlePlan(known, kGroups, {
    todayKey: TODAY, shiftStartMin: SHIFT_START,
    shiftClosedSlitters: closedToday,
    shiftNotOpenSlitters: notOpen,
    freeDayMsFor: function() { return TOMORROW_MS; }
});
var kMoves = {};
kSettle.moves.forEach(function(m) { kMoves[m.id] = m; });
assertEqual(kMoves['c1'], { id: 'c1', planStart: TOMORROW_MS / 1000 + SHIFT_START * 60, reason: 'free-day' },
    '#4564 известный НОЛЬ — двигается как и прежде');
assertEqual(kSettle.splits.map(function(sp) { return [sp.id, sp.doneRuns, sp.restRuns]; }),
    [['c3', 5, 7]], '#4596 известная ЧАСТЬ у станка вне смены — разделяется, остаток 5+7');

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
