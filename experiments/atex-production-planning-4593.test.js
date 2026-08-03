// #4593 — досрочность меряется ПЛАНОВЫМ днём задания, а не сегодняшним.
//
// Боевое 03.08.2026 (база ateh): форма «Отклонения от плана» показывала «Просрочено — 0,
// Выполнено досрочно — 0, Делается раньше плана — 2», и оба числа были неверны:
//   • задание 658857 (Станок 2, план 04.08 08:00, «Закончено» 03.08 17:15, 2 прохода из 2)
//     выполнено РАНЬШЕ СВОЕГО планового дня, а в «Выполнено досрочно» его не было вовсе:
//     группа требовала «Закончено» раньше СЕГОДНЯ;
//   • два задания с планом на СЕГОДНЯ (03.08 09:35 и 03.08 12:26), по которым идут проходы,
//     значились «делается раньше плана»: группе хватало «плановый день ≥ сегодня».
// Мерка одна на обе группы: расхождение факта с планом — это отношение «Закончено»/«Начато»
// к ПЛАНОВОМУ дню самого задания. Сегодняшний день оставлен только как рамка показа
// (плановый день ещё не прошёл), чтобы форма не превращалась в архив.
//
// Run with: node experiments/atex-production-planning-4593.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}
function tsAt(y, m, d, hh, mm) { return Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000); }
function ids(list) { return list.map(function(c) { return c.id; }); }

var TODAY = 20260803;   // 03.08.2026 — день боевого случая

// ── 1) боевой состав очереди ──────────────────────────────────────────────────
var cuts = [
    // Задание 658857: план на ЗАВТРА, закончено СЕГОДНЯ — выполнено досрочно.
    { id: '658857', slitter: { id: '1279' }, plannedRuns: 2, actualRuns: 2,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: String(tsAt(2026, 8, 3, 17, 15)),
      endDate: String(tsAt(2026, 8, 3, 17, 15)) },
    // Два задания СВОЕГО планового дня, по которым идут проходы, — не отклонение.
    { id: 'today1', slitter: { id: '1' }, plannedRuns: 82, actualRuns: 6,
      planDate: String(tsAt(2026, 8, 3, 9, 35)), startDate: String(tsAt(2026, 8, 3, 9, 40)), endDate: '' },
    { id: 'today3', slitter: { id: '3' }, plannedRuns: 45, actualRuns: 25,
      planDate: String(tsAt(2026, 8, 3, 12, 26)), startDate: String(tsAt(2026, 8, 3, 12, 30)), endDate: '' },
    // Начато вчера, план на завтра, проходы есть — делается раньше плана (#4584).
    { id: 'running', slitter: { id: '1' }, plannedRuns: 45, actualRuns: 5,
      planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: String(tsAt(2026, 8, 2, 18, 33)), endDate: '' },
    // Просрочено: плановый день прошёл, «Закончено» пусто.
    { id: 'late', slitter: { id: '1' }, plannedRuns: 10, actualRuns: 0,
      planDate: String(tsAt(2026, 8, 1, 8, 0)), startDate: '', endDate: '' }
];

var g = planning.deviationGroups(cuts, TODAY);
assertEqual(ids(g.early), ['658857'],
    '#4593 закончено СЕГОДНЯ при плане на ЗАВТРА — «выполнено досрочно»');
assertEqual(ids(g.earlyRun), ['running'],
    '#4593 «делается раньше плана» — только начатое РАНЬШЕ своего планового дня');
assertEqual(ids(g.overdue), ['late'], 'просроченное на месте — правило не тронуто');
assertEqual([g.overdue.length, g.early.length, g.earlyRun.length], [1, 1, 1],
    'подпись кнопки «Отклонения 1/1/1»');

// ── 2) работа в свой плановый день отклонением не считается ───────────────────
// Ни выполненное в свой день, ни делающееся в свой день: расхождения с планом нет.
(function() {
    var sameDay = [
        { id: 'doneToday', slitter: { id: '1' }, plannedRuns: 4, actualRuns: 4,
          planDate: String(tsAt(2026, 8, 3, 8, 0)), startDate: String(tsAt(2026, 8, 3, 8, 5)),
          endDate: String(tsAt(2026, 8, 3, 11, 0)) },
        { id: 'doneFuture', slitter: { id: '1' }, plannedRuns: 4, actualRuns: 4,
          planDate: String(tsAt(2026, 8, 6, 8, 0)), startDate: String(tsAt(2026, 8, 6, 8, 5)),
          endDate: String(tsAt(2026, 8, 6, 11, 0)) }
    ];
    var s = planning.deviationGroups(sameDay, TODAY);
    assertEqual([ids(s.overdue), ids(s.early), ids(s.earlyRun)], [[], [], []],
        '#4593 сделанное в СВОЙ плановый день — не отклонение (ни сегодня, ни в будущем)');
})();

// ── 3) прошлое в форму не тянем ───────────────────────────────────────────────
// Плановый день прошёл — расхождение показывать нечего: урегулировать его уже нечем.
(function() {
    var past = [
        { id: 'oldEarly', slitter: { id: '1' }, plannedRuns: 4, actualRuns: 4,
          planDate: String(tsAt(2026, 7, 30, 8, 0)), startDate: String(tsAt(2026, 7, 28, 8, 0)),
          endDate: String(tsAt(2026, 7, 28, 11, 0)) }
    ];
    var p = planning.deviationGroups(past, TODAY);
    assertEqual([ids(p.overdue), ids(p.early), ids(p.earlyRun)], [[], [], []],
        '#4593 давняя досрочность (плановый день прошёл) форму не засоряет');
})();

// ── 4) без «Начато» день факта неизвестен ─────────────────────────────────────
// Отметка прохода проставляет «Начато» тем же нажатием (пульт, markPassDone). Его нет —
// в каком дне шла работа, мы не знаем и не выдумываем: разделить такое задание всё равно
// нечем (deviationSettlePlan режет по «Начато»).
(function() {
    var noStart = [
        { id: 'noStart', slitter: { id: '1' }, plannedRuns: 45, actualRuns: 5,
          planDate: String(tsAt(2026, 8, 4, 8, 0)), startDate: '', endDate: '' }
    ];
    var n = planning.deviationGroups(noStart, TODAY);
    assertEqual(ids(n.earlyRun), [],
        '#4593 проходы есть, «Начато» пусто — день факта неизвестен, в отклонения не берём');
})();

// ── 5) урегулирование досрочного — в день фактического выполнения ─────────────
// Правило «Дата план» = момент «Закончено» (#4346) не изменилось: задание уезжает в тот день,
// в котором его реально сделали.
(function() {
    var s = planning.deviationSettlePlan(cuts, { early: g.early, overdue: [], earlyRun: [] },
        { todayKey: TODAY, shiftStartMin: 480 });
    assertEqual(s.moves, [{ id: '658857', planStart: tsAt(2026, 8, 3, 17, 15), reason: 'early' }],
        '#4346 досрочное уезжает в день фактического выполнения (03.08 17:15)');
})();

console.log('\n' + passed + '/' + total + ' passed');
