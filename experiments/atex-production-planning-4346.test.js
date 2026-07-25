// Unit tests for #4346 — кнопка «Отклонения N/M» в форме оперативного управления.
// Покрываем две чистые функции, на которых стоит вся кнопка:
//   • deviationGroups(cuts, todayKey) — классификация отклонений факта от плана:
//       N (overdue) — плановый день РАНЬШЕ текущего, «Закончено» пусто (не выполнено);
//       M (early)   — плановый день СЕГОДНЯ или позже, «Закончено» РАНЬШЕ текущего дня.
//   • deviationSettlePlan(cuts, groups, opts) — что «Урегулировать» пишет в «Дату план»:
//       досрочные → момент фактического выполнения;
//       просроченные → ПЕРЕД следующим заданием своего станка (в какой бы день оно ни стояло),
//                      взаимный порядок сохраняется;
//       нет следующего → ближайший рабочий незамороженный день (колбэк freeDayMsFor).
//
// Run with: node experiments/atex-production-planning-4346.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

function ts(day, hour, min) { return Math.floor(Date.UTC(2026, 6, day, hour || 0, min || 0) / 1000); }
function ids(list) { return list.map(function(c) { return c.id; }); }

var TODAY = 20260724;   // 24.07.2026 — «текущая дата»

// Станок 1: два просроченных, одно выполненное сегодня (не отклонение и НЕ «следующее»),
//           одно ожидающее на 25.07 — вот оно и есть «следующее задание».
// Станок 2: просроченное, после которого на станке ничего нет → ближайший рабочий день.
// Станок 3: два выполненных досрочно + краевые случаи.
var cuts = [
    { id: 'o1', slitter: { id: '1' }, planDate: String(ts(22, 8)), endDate: '' },
    { id: 'o2', slitter: { id: '1' }, planDate: String(ts(23, 8)), endDate: '' },
    { id: 'done1', slitter: { id: '1' }, planDate: String(ts(21, 8)), endDate: String(ts(21, 15)) },
    { id: 'donetoday', slitter: { id: '1' }, planDate: String(ts(24, 10)), endDate: String(ts(24, 12)) },
    { id: 'next1', slitter: { id: '1' }, planDate: String(ts(25, 8)), endDate: '' },
    { id: 'later1', slitter: { id: '1' }, planDate: String(ts(28, 8)), endDate: '' },
    { id: 'o3', slitter: { id: '2' }, planDate: String(ts(20, 8)), endDate: '' },
    { id: 'e1', slitter: { id: '3' }, planDate: String(ts(27, 8)), endDate: String(ts(23, 14)) },
    { id: 'e2', slitter: { id: '3' }, planDate: String(ts(24, 8)), endDate: String(ts(23, 9)) },
    { id: 'wait3', slitter: { id: '3' }, planDate: String(ts(24, 8)), endDate: '' },
    { id: 'future3', slitter: { id: '3' }, planDate: String(ts(26, 8)), endDate: String(ts(26, 12)) },
    { id: 'noplan', slitter: { id: '3' }, planDate: '', endDate: '' }
];

// ── deviationGroups ───────────────────────────────────────────────────────────
var groups = planning.deviationGroups(cuts, TODAY);

// Просрочено — по возрастанию планового времени (20.07 → 22.07 → 23.07).
assertEqual(ids(groups.overdue), ['o3', 'o1', 'o2'], 'N: просрочено — план в прошлом и «Закончено» пусто');
// Выполнено досрочно — план сегодня-и-позже, факт раньше сегодня.
assertEqual(ids(groups.early), ['e2', 'e1'], 'M: выполнено досрочно — факт раньше текущего дня');
assertEqual([groups.overdue.length, groups.early.length], [3, 2], 'подпись кнопки «Отклонения 3/2»');
// Краевые: выполнено в свой день (done1, donetoday, future3), ждёт сегодня (wait3),
// стоит в будущем (next1, later1), без «Даты план» (noplan) — не отклонения.
assertEqual(
    ids(groups.overdue.concat(groups.early)).sort(),
    ['e1', 'e2', 'o1', 'o2', 'o3'],
    'в отклонения не попали выполненные в срок, ожидающие сегодня, будущие и незапланированные'
);
assertEqual(planning.deviationGroups(cuts, Infinity).overdue.length, 0, 'без текущей даты групп нет');
assertEqual(planning.deviationGroups([], TODAY), { overdue: [], early: [] }, 'пустая очередь — пустые группы');

// ── planTsSeconds ─────────────────────────────────────────────────────────────
assertEqual(planning.planTsSeconds(String(ts(22, 8))), ts(22, 8), 'unix-штамп в секундах — как есть');
assertEqual(planning.planTsSeconds(String(ts(22, 8) * 1000)), ts(22, 8), 'unix-штамп в мс → секунды');
assertEqual(planning.planTsSeconds(''), null, 'пусто → null');
assertEqual(planning.planTsSeconds('—'), null, 'мусор → null');

// ── deviationSettlePlan ───────────────────────────────────────────────────────
var FREE_DAY_MS = Date.UTC(2026, 6, 27);   // 27.07 — «ближайший рабочий незамороженный» для станка 2
var freeAsked = [];
var plan = planning.deviationSettlePlan(cuts, groups, {
    todayKey: TODAY,
    shiftStartMin: 480,   // смена с 08:00
    freeDayMsFor: function(sid) { freeAsked.push(sid); return FREE_DAY_MS; }
});
var byId = {};
plan.forEach(function(p) { byId[p.id] = p; });

// Досрочные — на сам момент фактического выполнения (он же ставит их на место внутри дня).
assertEqual(byId.e1, { id: 'e1', planStart: ts(23, 14), reason: 'early' }, 'досрочное → момент «Закончено»');
assertEqual(byId.e2, { id: 'e2', planStart: ts(23, 9), reason: 'early' }, 'досрочное (план сегодня) → момент «Закончено»');

// Просроченные станка 1 — вплотную ПЕРЕД следующим заданием (25.07 08:00), порядок сохранён.
assertEqual(byId.o1, { id: 'o1', planStart: ts(25, 8) - 120, reason: 'before-next' }, 'просроченное → перед следующим заданием станка');
assertEqual(byId.o2, { id: 'o2', planStart: ts(25, 8) - 60, reason: 'before-next' }, 'второе просроченное — сразу за первым (порядок прежний)');
assertEqual(byId.o1.planStart < byId.o2.planStart, true, 'взаимный порядок просроченных не меняется');
assertEqual(byId.o2.planStart < ts(25, 8), true, 'оба встают раньше «следующего» задания');

// Станок 2: следующего задания нет → ближайший рабочий незамороженный день, старт смены.
assertEqual(byId.o3, { id: 'o3', planStart: Math.floor(FREE_DAY_MS / 1000) + 480 * 60, reason: 'free-day' },
    'нет следующего задания → ближайший рабочий незамороженный день, 08:00');
assertEqual(freeAsked, ['2'], 'ближайший день спрашиваем только у станка без следующего задания');

// Выполненное СЕГОДНЯ задание «следующим» не считается: якорь станка 1 — 25.07, а не 24.07.
assertEqual(byId.o2.planStart > ts(24, 12), true, 'выполненное задание не может быть «следующим»');
// Задания, которые никуда не двигаются, в план не попадают.
assertEqual(Object.keys(byId).sort(), ['e1', 'e2', 'o1', 'o2', 'o3'], 'план переносов — только отклонившиеся задания');

// Пустые группы → пустой план (повторное «Урегулировать» ничего не пишет).
assertEqual(planning.deviationSettlePlan(cuts, { overdue: [], early: [] }, { todayKey: TODAY, shiftStartMin: 480 }), [],
    'нет отклонений — переносить нечего');

console.log('\n' + passed + '/' + total + ' passed');
