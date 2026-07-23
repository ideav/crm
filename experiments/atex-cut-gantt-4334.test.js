// Regression test for ideav/crm#4334 — Гант для ПЛАНИРОВАНИЯ: фактические старт/финиш не
// двигают и не растягивают бар (геометрия = план), а только красят его (cutStatus).
// «Если оператор начал позже или выполнил завтрашнее — план не съезжает автоматически».
//
// Run with: node experiments/atex-cut-gantt-4334.test.js

process.env.TZ = 'Europe/Moscow';
var g = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var ms = function(iso) { return g.parseDateTimeMs(iso); };
var PLAN = '2026-06-10 10:00';
var PLANMS = ms(PLAN);

// Один и тот же ПЛАН (10:00, «Резка и Лидер» 60 мин, наладка 30+15), три судьбы факта.
function base() {
    return { planDate: PLAN, cutTimeMin: 60, setupKnifeMin: 30, setupMaterialMin: 15,
             slitter: { id: '1', label: 'Станок 1' } };
}
var planned      = Object.assign(base(), { id: 'P' });                                                   // ещё не начата
var startedEarly = Object.assign(base(), { id: 'S', startDate: '2026-06-10 08:00' });                    // начата на 2 ч раньше
var doneLate     = Object.assign(base(), { id: 'D', startDate: '2026-06-10 12:00', endDate: '2026-06-10 13:30' }); // сделана позже
var doneTomorrowsToday = Object.assign(base(), { id: 'T', planDate: '2026-06-11 08:00',                   // «завтрашнее» сделано сегодня
             startDate: '2026-06-10 08:00', endDate: '2026-06-10 09:30' });

// ── cutTimeRange: старт бара привязан к плану, факт только в actual* (для окраски/тултипа) ──
assertEqual(g.cutTimeRange(planned).startMs, PLANMS, 'cutTimeRange: незапущенная — старт = план');
assertEqual(g.cutTimeRange(startedEarly).startMs, PLANMS, 'cutTimeRange #4334: начата раньше — старт всё равно план (не 08:00)');
assertEqual(g.cutTimeRange(doneLate).startMs, PLANMS, 'cutTimeRange #4334: сделана позже — старт всё равно план (не 12:00)');
assertEqual(g.cutTimeRange(doneTomorrowsToday).startMs, ms('2026-06-11 08:00'),
    'cutTimeRange #4334: «завтрашнее» сделано сегодня — бар на плановом завтра, не на факт. сегодня');
// факт сохранён отдельно — им красят и показывают в тултипе
assertEqual(g.cutTimeRange(startedEarly).actualStartMs, ms('2026-06-10 08:00'), 'cutTimeRange: факт. старт сохранён в actualStartMs');
assertEqual(g.cutTimeRange(doneLate).actualEndMs, ms('2026-06-10 13:30'), 'cutTimeRange: факт. финиш сохранён в actualEndMs');

// ── подпись бара — плановое окно (наладка 45 + резка 60 = 105 мин от 10:00), факт не влияет ──
var plannedText = g.cutBarTime(planned, g.cutSetupMin(planned).total);
assertEqual(plannedText, '10:00-11:45 (105 мин)', 'cutBarTime: плановое окно наладка+резка');
assertEqual(g.cutBarTime(startedEarly, g.cutSetupMin(startedEarly).total), plannedText,
    'cutBarTime #4334: у начатой раньше подпись = плановая (не 08:00)');
assertEqual(g.cutBarTime(doneLate, g.cutSetupMin(doneLate).total), plannedText,
    'cutBarTime #4334: у сделанной позже подпись = плановая (не 12:00)');

// ── геометрия бара в layoutGroups одинакова для всех трёх судеб факта (bar = план) ──
var RANGE = g.ganttRange('2026-06-10', 'day');
var NOW = ms('2026-06-10 20:00');
function geom(cut) {
    var laid = g.layoutGroups([cut], RANGE, NOW, {}, { pxPerMin: 2 });
    var t = laid.groups[0].tasks[0];
    return { leftPx: t.leftPx, widthPx: t.widthPx, segments: t.segments };
}
var gp = geom(planned);
assertEqual(geom(startedEarly), gp, 'layoutGroups #4334: начата раньше — тот же left/width/сегменты, что у плана');
assertEqual(geom(doneLate), gp, 'layoutGroups #4334: сделана позже — тот же left/width/сегменты, что у плана');
// у бара есть плановая наладка (сегменты не нулевые) даже когда факт есть
assertEqual(gp.segments.setupMin, 45, 'layoutGroups #4334: плановая наладка на баре есть и у начатой/завершённой');

// ── а вот ОКРАСКА (cutStatus) по-прежнему отражает факт ──
assertEqual(g.cutStatus(planned, NOW).key, 'late-start', 'cutStatus: план прошёл, не начата → late-start (факт красит)');
assertEqual(g.cutStatus(startedEarly, NOW).key, 'running', 'cutStatus: есть факт. старт → running');
assertEqual(g.cutStatus(doneLate, NOW).key, 'done', 'cutStatus: есть факт. финиш → done');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
