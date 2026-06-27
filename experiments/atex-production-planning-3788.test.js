// Unit tests for #3788 — пропуск выходных/праздничных дней при планировании по «Календарю».
// «Праздничный день» делает дату нерабочей (даже будни), «Рабочий день» — рабочей (даже Сб/Вс);
// иначе обычное правило (Сб/Вс — выходные). Нерабочие дни → блокированные интервалы расписания
// (как окна «Отпуска» #3764), и тот же свип shiftPlacementsPastDowntime выталкивает задания на
// ближайший рабочий день. Берём реальные данные ateh (январские праздники + рабочая суббота 10.01).
//
// Run with: node experiments/atex-production-planning-3788.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Реальный фрагмент календаря ateh (январь 2026): праздники + рабочая суббота 10.01.
var CAL = {};
[20260101,20260102,20260105,20260106,20260107,20260108,20260109,20260223,20260309,20260501,20260509,20260612,20261104]
    .forEach(function(k){ CAL[k] = 'Праздничный день'; });
CAL[20260110] = 'Рабочий день';   // суббота, сделана рабочей

// ── 1) parseDmyKey ──
assertEqual(planning.parseDmyKey('01.01.2026'), 20260101, '#3788: «01.01.2026» → 20260101');
assertEqual(planning.parseDmyKey('10.01.2026'), 20260110, '#3788: «10.01.2026» → 20260110');
assertEqual(planning.parseDmyKey('  bad  '), null, '#3788: мусор → null');

// ── 2) dayTypeWorking: исключения и обычные выходные ──
assertEqual(planning.dayTypeWorking(20260101, 4, CAL), false, '#3788: праздник в будни (Чт) — нерабочий');
assertEqual(planning.dayTypeWorking(20260110, 6, CAL), true, '#3788: «Рабочий день» в субботу — рабочий');
assertEqual(planning.dayTypeWorking(20260111, 0, CAL), false, '#3788: обычное воскресенье — нерабочий');
assertEqual(planning.dayTypeWorking(20260112, 1, CAL), true, '#3788: обычный понедельник — рабочий');
assertEqual(planning.dayTypeWorking(20260613, 6, {}), false, '#3788: суббота без исключений — нерабочий');

// База: 08.01.2026 (Чт, праздник). getDay контроль.
var BASE = Date.UTC(2026, 0, 8, 0, 0, 0);
assertEqual(new Date(BASE).getDay(), 4, '#3788: контроль — 08.01.2026 это четверг (getDay 4)');

// ── 3) calendarBlockedRanges: горизонт 5 дней от 08.01 ──
// d0=08(Чт,праздник)✗ d1=09(Пт,праздник)✗ d2=10(Сб,РАБОЧИЙ)✓ d3=11(Вс)✗ d4=12(Пн)✓ d5=13(Вт)✓
// Нерабочие смещения [0,1,3] → слитые сутки [[0,2880],[4320,5760]]; рабочая суббота 10.01 — «дыра».
assertEqual(planning.calendarBlockedRanges(CAL, BASE, 5), [[0, 2880], [4320, 5760]],
    '#3788: выходные/праздники → блоки суток; рабочая суббота 10.01 не блокируется (дыра между блоками)');

// Пустой календарь → блокируются только Сб/Вс (d2=10.01 как обычная суббота тоже ✗).
assertEqual(planning.calendarBlockedRanges({}, BASE, 5), [[2880, 5760]],
    '#3788: без исключений — блок выходных Сб+Вс (10–11.01) слит в [2880,5760]');

// ── 4) mergeBlockedRanges: конкат + сортировка ──
assertEqual(planning.mergeBlockedRanges([[4320, 5760]], [[0, 2880]]), [[0, 2880], [4320, 5760]],
    '#3788: слияние блоков отпуска и календаря — отсортировано по началу');

// ── 5) Интеграция: splitMachineQueue выталкивает задание с праздника на рабочую субботу ──
function cut(id) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [59, 59], knifeCount: 2, plannedRuns: 4 };
}
var DS = 480, DE = 990;   // 08:00–16:30
var blocks = planning.calendarBlockedRanges(CAL, BASE, 10);
var opts = { dayStartMin: DS, dayEndMin: DE, times: { BETWEEN_CUTS: 0 },
    perPassByCut: { A: 10 }, runsByCut: { A: 4 }, dayAnchorByCut: { A: 0 } };

var noCal = planning.splitMachineQueue([cut('A')], opts);
assertEqual(noCal[0].windowStartMin, DS, '#3788: без календаря — задание стартует в день 0 (08:00)');

var withCal = planning.splitMachineQueue([cut('A')], Object.assign({}, opts, { blockedRanges: blocks }));
assertEqual(withCal[0].windowStartMin, 2 * 1440 + DS,
    '#3788: с календарём — задание с праздника 08.01 уехало на рабочую субботу 10.01 (день 2, 08:00)');

console.log('\n' + passed + ' assertions passed');
