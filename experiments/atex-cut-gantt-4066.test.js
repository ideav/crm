// Unit tests for #4066 (ревизия #4110/#4114) — перерыв растягивает свой несущий бар И сдвигает
// последующие задания дня.
//
// Перерыв — накладка ПОВЕРХ несущего бара, а несущий бар РАСШИРЯЕТСЯ на его длительность (#4110:
// чтобы накладка легла на бар, а не «висела в конце»). Станок в перерыв стоит, поэтому все
// ПОСЛЕДУЮЩИЕ задания дня уезжают вправо на ту же длительность (#4114 п.1, решение заказчика:
// «задание с началом в 10:34 должно быть в 10:44, как заканчивается предыдущее»). СТАРТ самого
// несущего не двигается, рабочие минуты (barMin) перерыв не включает.
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
     '11:10-12:10 (60 мин)',
     '13:10-16:20 (180 мин)'],
    '#4110/#4114: несущий растянут (C1→11:10), последующие сдвинуты на перерыв (C2, C3), '
    + 'в скобках рабочие мин');

// ── #4110: НЕ-несущий бар (C2) перерыв не трогает — с перерывами и без совпадает ──
assertEqual([baseT[2].barText, wbT[2].barText],
    ['11:00-12:00 (60 мин)', '11:10-12:10 (60 мин)'],
    '#4114: бар без СВОЕГО перерыва не растягивается, но уезжает целиком (C2 11:00→11:10)');

// ── Последний бар дня растянут ТОЛЬКО на СВОЙ перерыв (15:00, +10 мин), а СДВИНУТ — на чужой
// (10:00, +10 мин): 13:00→13:10, конец 16:00→16:20. Двойного счёта нет — растяжка и сдвиг
// приходят от РАЗНЫХ перерывов. ──
assertEqual([baseT[3].barText, wbT[3].barText],
    ['13:00-16:00 (180 мин)', '13:10-16:20 (180 мин)'],
    '#4110/#4114: свой перерыв растягивает бар, чужой — сдвигает его целиком');

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

// ── #4114: СТАРТ (leftPx) сдвинут ровно у баров ПОСЛЕ несущего (2 px/мин × 10 мин = 20px):
// C0/C1 на месте, C2 360→380, C3 600→620. ──
assertEqual(wbT.map(function(t, i){ return Math.round(t.leftPx - baseT[i].leftPx); }),
    [0, 0, 20, 20],
    '#4114: сдвинуты только задания ПОСЛЕ несущего, сам несущий и предшественники — на месте');
// ── #4110: несущий перерыв бар шире на длительность перерыва (2 px/мин): C1 240→260, C3 360→380;
// C0/C2 без своего перерыва — прежней ширины. ──
assertEqual(wbT.map(function(t){ return [t.leftPx, t.widthPx]; }),
    [[0, 120], [120, 260], [380, 120], [620, 380]],
    '#4110/#4114: несущий удлинён на свой перерыв (C1, C3), последующие сдвинуты, ширина цела');

// ── Перерывы добавляют только серые накладки-маркеры ──
assertEqual(wb.groups[0].breaks.length, 2, '#4099: два маркера перерыва (накладки) в группе');
assertEqual(base.groups[0].breaks == null || base.groups[0].breaks.length === 0, true,
    '#4099: без настройки перерывов маркеров нет');

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
