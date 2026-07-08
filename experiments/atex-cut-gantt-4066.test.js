// Unit tests for #4066 (ревизия #4099) — перерывы на Ганте НЕ двигают бары.
//
// #4007/#4066 когда-то сдвигали бары за перерывы (10:00/15:00) и правили подпись под сдвиг.
// #4099 «рисуй как есть»: перерыв — накладка ПОВЕРХ бара по его реальному времени; бары НЕ
// сдвигаются и не удлиняются. Значит раскладка с перерывами полностью совпадает с раскладкой без
// них (позиции, ширины, подписи), а перерывы добавляют лишь серые накладки-маркеры.
//
// Run with: node experiments/atex-cut-gantt-4066.test.js

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

var PPM = 2;
function cut(id, iso, cutTimeMin) {
    return { id: id, planDate: '2026-06-29 ' + iso, cutTimeMin: cutTimeMin,
             slitter: { id: '1', label: 'Станок 1' } };
}
var BREAKS = [
    { startMin: 600, durationMin: 10, label: 'Перерыв' },   // 10:00
    { startMin: 900, durationMin: 10, label: 'Перерыв' }    // 15:00
];
var range = g.ganttRange('2026-06-29', 'day');
var NOW = g.parseDateTimeMs('2026-06-29 20:00');
// C0 08:00-09:00, C1 09:00-11:00 (накрывает перерыв 10:00), C2 11:00-12:00, C3 13:00-16:00 (15:00).
var dayCuts = [ cut('C0', '08:00', 60), cut('C1', '09:00', 120), cut('C2', '11:00', 60), cut('C3', '13:00', 180) ];

var base = g.layoutGroups(dayCuts, range, NOW, {}, { pxPerMin: PPM });
var wb   = g.layoutGroups(dayCuts, range, NOW, {}, { pxPerMin: PPM, breaks: BREAKS });
var baseT = base.groups[0].tasks, wbT = wb.groups[0].tasks;

// ── #4099: подписи баров с перерывами = сохранённое время (перерыв не двигает бар) ──
assertEqual(wbT.map(function(t){ return t.barText; }),
    ['08:00-09:00 (60 мин)',
     '09:00-11:00 (120 мин)',
     '11:00-12:00 (60 мин)',
     '13:00-16:00 (180 мин)'],
    '#4099: подписи баров — реальное сохранённое время (перерыв не сдвигает)');

// ── #4099: бар после перерыва НЕ сдвинут — с перерывами и без совпадает ──
assertEqual([baseT[2].barText, wbT[2].barText],
    ['11:00-12:00 (60 мин)', '11:00-12:00 (60 мин)'],
    '#4099: бар после перерыва не сдвигается (11:00 остаётся 11:00)');

// ── #4099: последнее задание дня НЕ уезжает за перерывы (16:00 остаётся 16:00) ──
assertEqual([baseT[3].barText, wbT[3].barText],
    ['13:00-16:00 (180 мин)', '13:00-16:00 (180 мин)'],
    '#4099: конец дня не уезжает за перерывы (16:00, а не 16:20)');

// ── Подпись СОВПАДАЕТ с позицией бара: старт подписи → leftPx (ось линейна в пределах дня) ──
function labelStartMs(barText) {
    var hm = String(barText).split('-')[0];   // «13:00»
    return g.parseDateTimeMs('2026-06-29 ' + hm);
}
wbT.forEach(function(t, i) {
    assertEqual(Math.round(wb.scale.toPx(labelStartMs(t.barText))), Math.round(t.leftPx),
        '#4066: подпись бара[' + i + '] совпадает с его позицией (toPx(старт подписи) == leftPx)');
});

// ── Рабочие минуты (сумма «N (Σ мин)») от перерывов НЕ меняются ──
assertEqual([base.groups[0].tasksMin, wb.groups[0].tasksMin], [420, 420],
    '#4066: сумма рабочих минут станка не включает перерывы (420 в обоих)');
assertEqual(wbT.map(function(t){ return t.barMin; }), baseT.map(function(t){ return t.barMin; }),
    '#4066: barMin каждого бара — рабочие минуты, перерыв в них не входит');

// ── #4099: геометрия баров с перерывами = без перерывов (перерыв ничего не двигает) ──
assertEqual(wbT.map(function(t){ return [t.leftPx, t.widthPx]; }),
    baseT.map(function(t){ return [t.leftPx, t.widthPx]; }),
    '#4099: позиции/ширины баров с перерывами совпадают с раскладкой без них');
assertEqual(wbT.map(function(t){ return [t.leftPx, t.widthPx]; }),
    [[0, 120], [120, 240], [360, 120], [600, 360]],
    '#4099: бары стоят на реальном времени без сдвига/удлинения');

// ── Перерывы добавляют только серые накладки-маркеры ──
assertEqual(wb.groups[0].breaks.length, 2, '#4099: два маркера перерыва (накладки) в группе');
assertEqual(base.groups[0].breaks == null || base.groups[0].breaks.length === 0, true,
    '#4099: без настройки перерывов маркеров нет');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
