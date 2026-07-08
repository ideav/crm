// Unit tests for #4066 (ревизия #4110) — перерыв РАСТЯГИВАЕТ свой несущий бар, но не двигает соседей.
//
// #4007/#4066 когда-то сдвигали ВСЕ последующие бары за перерывы (10:00/15:00). #4099 «рисуй как
// есть» снял и сдвиг, и растяжку. #4110: перерыв — накладка ПОВЕРХ несущего бара, а несущий бар
// РАСШИРЯЕТСЯ на длительность перерыва (чтобы накладка легла на бар, а не «висела в конце»). При
// этом СТАРТ бара и соседние бары не двигаются, рабочие минуты (barMin) перерыв не включает.
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

// ── #4110: подпись несущего перерыв бара — на удлинённое окно; НЕ-несущие (C0, C2) без изменений.
// C1 (несёт перерыв 10:00) → +10 мин, C3 (несёт 15:00) → +10 мин; старт у всех сохранён. ──
assertEqual(wbT.map(function(t){ return t.barText; }),
    ['08:00-09:00 (60 мин)',
     '09:00-11:10 (120 мин)',
     '11:00-12:00 (60 мин)',
     '13:00-16:10 (180 мин)'],
    '#4110: несущий перерыв бар растянут на перерыв (C1→11:10, C3→16:10), в скобках рабочие мин');

// ── #4110: НЕ-несущий бар (C2) перерыв не трогает — с перерывами и без совпадает ──
assertEqual([baseT[2].barText, wbT[2].barText],
    ['11:00-12:00 (60 мин)', '11:00-12:00 (60 мин)'],
    '#4110: бар без своего перерыва не меняется (C2 11:00-12:00)');

// ── #4110: последний бар дня растянут ТОЛЬКО на СВОЙ перерыв (15:00) — 16:10, а не 16:20 (второй
// перерыв 10:00 несёт C1, к C3 он не относится → двойного счёта нет). ──
assertEqual([baseT[3].barText, wbT[3].barText],
    ['13:00-16:00 (180 мин)', '13:00-16:10 (180 мин)'],
    '#4110: конец дня уезжает только на СВОЙ перерыв (16:10, не 16:20)');

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

// ── #4110: СТАРТ (leftPx) каждого бара не меняется от перерывов — сдвига соседей нет ──
assertEqual(wbT.map(function(t){ return t.leftPx; }),
    baseT.map(function(t){ return t.leftPx; }),
    '#4110: старты баров с перерывами и без совпадают (перерыв не двигает соседей)');
// ── #4110: несущий перерыв бар шире на длительность перерыва (2 px/мин): C1 240→260, C3 360→380;
// C0/C2 без своего перерыва — без изменений. ──
assertEqual(wbT.map(function(t){ return [t.leftPx, t.widthPx]; }),
    [[0, 120], [120, 260], [360, 120], [600, 380]],
    '#4110: несущий бар удлинён на свой перерыв (C1 +10 мин, C3 +10 мин), остальные без изменений');

// ── Перерывы добавляют только серые накладки-маркеры ──
assertEqual(wb.groups[0].breaks.length, 2, '#4099: два маркера перерыва (накладки) в группе');
assertEqual(base.groups[0].breaks == null || base.groups[0].breaks.length === 0, true,
    '#4099: без настройки перерывов маркеров нет');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
