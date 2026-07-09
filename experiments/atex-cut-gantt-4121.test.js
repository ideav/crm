// Unit tests for ideav/crm#4121 — обед «сквозной» (не зашитый в planStart) должен двигать
// последующие задания дня, как перерыв.
//
// Симптом (скрин issue, Станок 2, 02.07.2026 с «Отпуском» 08:00–10:00 «ТО»): бар №2 растянут
// обедом до 13:46, а следующий бар №3 начинается в 13:06 — на 40 минут РАНЬШЕ конца соседа.
//
// Причина: обед генерация ЗАШИВАЕТ в planStart зазором, и Гант поэтому его не считал сдвигом
// (только растяжка несущего). Но на дне после «Отпуска» станка зазора нет: сдвиг за простой
// (#3764 shiftPlacementsPastDowntime) пакует резки встык и обеденный зазор схлопывается. Гант
// рисует такой обед carrier-фолбэком (#4035) — растягивает несущий бар на 40 мин, а соседей не
// двигает → нахлёст ровно на длительность обеда.
//
// Фикс: обед-фолбэк (fallback=true, в planStart его нет) двигает все задания дня после несущего —
// как перерыв (#4114 п.1: обед/перерыв = реальный простой станка). Обед-зазор (fallback≠true) по-
// прежнему не двигает никого — он уже учтён в сохранённых стартах.
//
// Run with: node experiments/atex-cut-gantt-4121.test.js

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
function assert(cond, name) { assertEqual(!!cond, true, name); }

var PPM = 2;                       // px на минуту
var LUNCH_START = 12 * 60 + 20;    // 12:20
var LUNCH_DUR = 40;
var BREAKS = [
    { startMin: 600, durationMin: 10, label: 'Перерыв' },   // 10:00
    { startMin: 900, durationMin: 10, label: 'Перерыв' }    // 15:00
];
var ms = function(iso) { return g.parseDateTimeMs(iso); };
function cut(id, planIso, cutTimeMin) {
    return { id: id, planDate: planIso, cutTimeMin: cutTimeMin,
             slitter: { id: '2', label: 'Станок 2' } };
}
function scaleFor(cuts, range) {
    return g.ganttScale(g.workingSegments(cuts, range, { breakBufferMin: 20 }), PPM);
}

// ── Данные со скрина #4121: день после «Отпуска» 08:00–10:00 — цуг встык от 10:00, обеда в
//    сохранённых стартах НЕТ (зазора между окнами нет ни одного). ──
var DAY = '2026-07-02';
var afterVacation = [
    cut('4008', DAY + ' 10:00', 120),   // 10:00–12:00, накрывает перерыв 10:00
    cut('3948', DAY + ' 12:00', 56),    // 12:00–12:56, накрывает обед 12:20
    cut('3992', DAY + ' 12:56', 4),
    cut('3941', DAY + ' 13:00', 37),
    cut('3968', DAY + ' 13:37', 31),
    cut('3997', DAY + ' 14:08', 38),
    cut('3971', DAY + ' 14:46', 23),    // 14:46–15:09, накрывает перерыв 15:00
    cut('4023', DAY + ' 15:09', 17),
    cut('3972', DAY + ' 15:26', 15)
];
var range = g.ganttRange(DAY, 'day');
var NOW = ms(DAY + ' 20:00');
var scale = scaleFor(afterVacation, range);

// ── Обед на таком дне — carrier-фолбэк (#4035): зазора нет, несущая — резка, накрывшая 12:20 ──
var lunches = g.ganttLunchMarkers(afterVacation, scale, LUNCH_DUR, LUNCH_START);
assertEqual(lunches.length, 1, '#4121: на дне после отпуска один обед-маркер');
assertEqual(lunches[0].fallback, true, '#4121: обеда нет в planStart → carrier-фолбэк');
assertEqual(lunches[0].carrierIndex, 1, '#4121: несущая обеда — 3948 (её окно накрывает 12:20)');

// ── Сдвиг: перерыв 10:00 (+10), обед 12:20 (+40), перерыв 15:00 (+10) — накопительно по дню ──
var brk = g.ganttBreakMarkers(afterVacation, scale, BREAKS, { pxPerMin: PPM, lunches: lunches });
assertEqual(brk.shiftMinByIndex, [0, 10, 50, 50, 50, 50, 50, 60, 60],
    '#4121: обед-фолбэк двигает задания после несущей (10 → 50 → 60), как перерыв');
assertEqual(brk.markers.map(function(m) { return m.carrierIndex; }), [0, 6],
    '#4121: маркеры перерывов — на 4008 и 3971; обед идёт своим списком (g.lunches)');

// Без обеда в opts (обед выключен настройкой) — сдвиг только за перерывы, как было до #4121.
assertEqual(g.ganttBreakMarkers(afterVacation, scale, BREAKS, { pxPerMin: PPM }).shiftMinByIndex,
    [0, 10, 10, 10, 10, 10, 10, 20, 20],
    '#4121: без обеда сдвиг прежний (только перерывы)');

// ── layoutGroups: подписи баров идут ВСТЫК, нахлёста «№3 раньше конца №2» больше нет ──
var groups = g.layoutGroups(afterVacation, range, NOW, {}, {
    pxPerMin: PPM, lunchDurationMin: LUNCH_DUR, lunchStartMin: LUNCH_START, breaks: BREAKS
}).groups;
var tasks = groups[0].tasks;
assertEqual(tasks.map(function(t) { return t.barText; }), [
    '10:00-12:10 (120 мин)',   // +10 перерыв 10:00 (несущая)
    '12:10-13:46 (56 мин)',    // старт +10; окно +40 обеда (несущая обеда)
    '13:46-13:50 (4 мин)',     // ← было 13:06 (наезд на 40 мин): теперь встык за обедом
    '13:50-14:27 (37 мин)',
    '14:27-14:58 (31 мин)',
    '14:58-15:36 (38 мин)',
    '15:36-16:09 (23 мин)',    // +50; окно +10 перерыва 15:00 (несущая)
    '16:09-16:26 (17 мин)',
    '16:26-16:41 (15 мин)'
], '#4121: времена карточек дня — встык, обед сдвигает всё после несущей');

var overlaps = [];
for (var i = 0; i + 1 < tasks.length; i++) {
    if (tasks[i].leftPx + tasks[i].widthPx > tasks[i + 1].leftPx + 0.5) overlaps.push(tasks[i].cut.id);
}
assertEqual(overlaps, [], '#4121: ни один бар не наезжает на следующий');

// ── Накладка обеда лежит НА своём (сдвинутом) баре, а не левее него ──
var lunchBand = groups[0].lunches[0];
var carrier = tasks[1];
assert(lunchBand.leftPx >= carrier.leftPx - 0.001, '#4121: обед-накладка не вылезает левее несущего бара');
assert(lunchBand.leftPx + lunchBand.widthPx <= carrier.leftPx + carrier.widthPx + 0.001,
    '#4121: обед-накладка не вылезает правее несущего бара');
// Несущая сдвинута на +10 (перерыв 10:00) → обед 12:20 рисуется в 12:30 по оси Ганта.
assertEqual(lunchBand.leftPx, g.ganttScale(g.workingSegments(afterVacation, range, { breakBufferMin: 20 }), PPM)
    .toPx(ms(DAY + ' 12:20')) + 10 * PPM, '#4121: обед на баре смещён вместе с несущей (12:20 + 10 мин)');
// Перерыв 15:00 — на несущей 3971, сдвинутой на +50; накладка обязана остаться внутри бара.
var brk15 = groups[0].breaks[1];
var carrier15 = tasks[6];
assert(brk15.leftPx >= carrier15.leftPx - 0.001, '#4121: перерыв 15:00 не вылезает левее своего бара');
assert(brk15.leftPx + brk15.widthPx <= carrier15.leftPx + carrier15.widthPx + 0.001,
    '#4121: перерыв 15:00 не вылезает правее своего бара');

// ── Ось дня вмещает сдвиг: на ПЕРЕПОЛНЕННОМ дне (бар за смену, #4099) правый край окна дня
//    равен концу последнего бара; без запаса сдвинутый обедом бар уехал бы в следующий день ──
var overbooked = [
    cut('X1', DAY + ' 08:00', 300),    // 08:00–13:00, накрывает и 10:00, и 12:20
    cut('X2', DAY + ' 13:00', 330)     // 13:00–18:30 — бар кончается на правом краю окна дня
];
var overSegs = g.workingSegments(overbooked, range, { breakBufferMin: 20 + LUNCH_DUR });
var lastBarEndMs = ms(DAY + ' 18:30');
assert(overSegs[0].endMs >= lastBarEndMs + (20 + LUNCH_DUR) * 60000,
    '#4121: окно дня шире конца последнего бара на буфер перерывов + обеда');
var overGroups = g.layoutGroups(overbooked, range, NOW, {}, {
    pxPerMin: PPM, lunchDurationMin: LUNCH_DUR, lunchStartMin: LUNCH_START, breaks: BREAKS
});
var overTasks = overGroups.groups[0].tasks;
var lastTask = overTasks[overTasks.length - 1];
assert(lastTask.leftPx + lastTask.widthPx <= overGroups.trackPx + 0.001,
    '#4121: сдвинутый обедом последний бар остаётся внутри дорожки (не наезжает на следующий день)');

// ── Контроль: обед-ЗАЗОР (генерация вписала обед в planStart) никого не двигает ──
// День 01.07 со скрина: 3973 12:19–12:46, дальше зазор 40 мин, 3978 стартует в 13:26.
var gapDay = [
    cut('3998', '2026-07-01 09:50', 139),   // 09:50–12:09
    cut('3973', '2026-07-01 12:19', 27),    // 12:19–12:46 (накрывает 12:20), далее обеденный зазор
    cut('3978', '2026-07-01 13:26', 33)     // 13:26 — обед уже зашит в planStart
];
var gapRange = g.ganttRange('2026-07-01', 'day');
var gapScale = scaleFor(gapDay, gapRange);
var gapLunches = g.ganttLunchMarkers(gapDay, gapScale, LUNCH_DUR, LUNCH_START);
assertEqual(gapLunches.length, 1, '#4121 контроль: обед-зазор найден');
assert(!gapLunches[0].fallback, '#4121 контроль: это обед-зазор (не фолбэк)');
assertEqual(g.ganttBreakMarkers(gapDay, gapScale, [], { pxPerMin: PPM, lunches: gapLunches }).shiftMinByIndex,
    [0, 0, 0], '#4121 контроль: обед-зазор НЕ сдвигает бары (иначе двойной учёт)');

// ── Сквозной обед + ПОЗДНИЙ простой того же дня (второй «Отпуск» 15:00–16:00) ──
// Поздний зазор не имеет права стать «обедом дня»: иначе бары после обеда снова не сдвинутся.
var lateGapDay = [
    cut('L1', DAY + ' 10:00', 120),   // 10:00–12:00
    cut('L2', DAY + ' 12:00', 60),    // 12:00–13:00 — накрывает 12:20
    cut('L3', DAY + ' 13:00', 120),   // 13:00–15:00
    cut('L4', DAY + ' 16:00', 30)     // перед ним зазор 60 мин (ТО), старт ≥ 12:20
];
var lateScale = scaleFor(lateGapDay, range);
var lateLunches = g.ganttLunchMarkers(lateGapDay, lateScale, LUNCH_DUR, LUNCH_START);
assertEqual(lateLunches.length, 1, '#4121: на дне один обед-маркер');
assertEqual(lateLunches[0].fallback, true,
    '#4121: поздний простой (ТО) — не обед; обед остаётся сквозным (фолбэк)');
assertEqual(lateLunches[0].carrierIndex, 1, '#4121: несущая обеда — L2 (накрывает 12:20)');
assertEqual(g.ganttBreakMarkers(lateGapDay, lateScale, [], { pxPerMin: PPM, lunches: lateLunches }).shiftMinByIndex,
    [0, 0, 40, 40], '#4121: сквозной обед двигает L3 и L4, несмотря на поздний зазор');

console.log('');
console.log(passed + '/' + total + ' проверок прошло' + (passed === total ? '. Все проверки #4121 зелёные.' : ''));
