// Unit tests for #4066 — подпись времени бара на Ганте должна учитывать сдвиг за перерывы.
//
// Перерывы (#4007, FIRST_INTERVAL 10:00 / SECCOND_INTERVAL 15:00, ТЗ §5) прозрачны планированию:
// их нет в сохранённых стартах. Гант рисует их сам — несущий перерыв бар удлиняется, а ВСЕ
// последующие бары дня сдвигаются вправо (leftPx += breakShift). Но подпись времени бара (barText)
// бралась от СОХРАНЁННОГО старта, поэтому бар, отрисованный со сдвигом, показывал дообеденное время:
// последнее задание станка рисовалось до 16:39, а подпись — 15:38-16:19 (issue #4066: «начало
// следующего бара после перерыва не сдвинуто», «на гантте 16:19 вместо 16:39»).
//
// Фикс: barText/barMin считаем от СДВИНУТОГО за перерывы старта (как leftPx), поэтому подпись
// совпадает с позицией бара. Рабочие минуты (barMin, сумма «N (Σ мин)») не меняются — перерыв в
// сумму не входит, только двигает бар и его время.
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
// C0 08:00-09:00, C1 09:00-11:00 (несёт перерыв 10:00), C2 11:00-12:00 (после перерыва),
// C3 13:00-16:00 (несёт перерыв 15:00; сдвинут утренним перерывом).
var dayCuts = [ cut('C0', '08:00', 60), cut('C1', '09:00', 120), cut('C2', '11:00', 60), cut('C3', '13:00', 180) ];

var base = g.layoutGroups(dayCuts, range, NOW, {}, { pxPerMin: PPM });
var wb   = g.layoutGroups(dayCuts, range, NOW, {}, { pxPerMin: PPM, breaks: BREAKS });
var baseT = base.groups[0].tasks, wbT = wb.groups[0].tasks;

// ── Подпись каждого бара учитывает сдвиг/удлинение за перерывы ──
assertEqual(wbT.map(function(t){ return t.barText; }),
    ['08:00-09:00 (60 мин)',   // до перерыва — без сдвига
     '09:00-11:10 (120 мин)',  // несущий 10:00 — удлинён на перерыв (конец 11:00→11:10)
     '11:10-12:10 (60 мин)',   // после перерыва — старт сдвинут 11:00→11:10 (issue #4066)
     '13:10-16:20 (180 мин)'], // сдвиг утренним перерывом (13:00→13:10) + несёт 15:00 (конец +10)
    '#4066: подписи баров учитывают сдвиг и удлинение за перерывы');

// ── Ключевой симптом issue: старт бара ПОСЛЕ перерыва сдвинут ──
assertEqual([baseT[2].barText, wbT[2].barText],
    ['11:00-12:00 (60 мин)', '11:10-12:10 (60 мин)'],
    '#4066: начало бара после перерыва сдвинуто (11:00→11:10)');

// ── Последнее задание дня «уезжает» на суммарные перерывы (16:00→16:20) ──
assertEqual([baseT[3].barText, wbT[3].barText],
    ['13:00-16:00 (180 мин)', '13:10-16:20 (180 мин)'],
    '#4066: конец дня учитывает оба перерыва (последний бар до 16:20, а не 16:00)');

// ── Подпись СОВПАДАЕТ с позицией бара: старт подписи → leftPx (ось линейна в пределах дня) ──
var day0 = g.parseDateTimeMs('2026-06-29 00:00');
function labelStartMs(barText) {
    var hm = String(barText).split('-')[0];   // «13:10»
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

// ── Геометрия баров (leftPx/widthPx) фиксом не тронута — менялась только подпись ──
assertEqual(wbT.map(function(t){ return [t.leftPx, t.widthPx]; }),
    [[0, 120], [120, 260], [380, 120], [620, 380]],
    '#4066: позиции/ширины баров прежние (фикс только в подписи времени)');

// ── Без настройки перерывов подписи не меняются ──
assertEqual(baseT.map(function(t){ return t.barText; }),
    ['08:00-09:00 (60 мин)', '09:00-11:00 (120 мин)', '11:00-12:00 (60 мин)', '13:00-16:00 (180 мин)'],
    '#4066: без перерывов подпись = сохранённое время (регрессия не задета)');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
