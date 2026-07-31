// Unit-тесты для режима «Резка под одну позицию» (форма «Новая производственная резка»).
// Проверяют чистую логику, на которую опирается computeCutPlan/createCutForPosition:
//   • связку qty → проходы → состав/склад через существующие хелперы
//     plannedRunsForLayout / producedBatchesForLayout (как считает computeCutPlan).
//
// Run with: node experiments/test-atex-pp-cut-for-position.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// Общие опции расписания: окно 08:00–16:30 (480–990), нормы намотки заданы явно,
// times не передаём → BETWEEN_CUTS=2 (лидер) из DEFAULT_OP_TIMES, переналадка между
// резками одинаковой сигнатуры = 0.
var WIND = [{ m: 100, min: 10 }, { m: 1000, min: 100 }];
var OPTS = { windPoints: WIND, shiftStartMin: 480, shiftEndMin: 990, runLengthByCut: {} };

// Проспект: 100 м/проход × 2 прохода → 10×2 = 20 мин резки.
function prospect(over) {
    var p = { id: '__new__', plannedRuns: 2, materialId: 'm1', winding: 'нар', knifeWidths: [100], runLength: 100 };
    if (over) Object.keys(over).forEach(function(k) { p[k] = over[k]; });
    return p;
}
function cut(id, runs, runLength, knives) {
    return { id: id, plannedRuns: runs, materialId: 'm1', winding: 'нар', knifeWidths: knives || [100], runLength: runLength };
}

// Пункты 1–3 (ближайшее свободное окно станка) убраны вместе с функцией freeSlotForQueue:
// пересчёт очереди от дня 0 удалён как мёртвый код, окно считает freeSlotFromStoredQueue по
// СОХРАНЁННОМУ плану (#4416) — оно покрыто experiments/atex-4416-free-slot-stored.test.js
// (пустой станок, хвост очереди, перенос на следующий рабочий день, нерабочие дни).

// 4) qty → проходы → состав/склад (как в computeCutPlan): позиция 330 мм, qty 5,
//    раскладка 3 полосы/проход. Проходов = ceil(5/3)=2; произведём 3×2=6; склад 6−5=1.
var lay = { positionsCovered: ['p1'], strips: [{ width: 330, qty: 3 }] };
var posForCalc = [{ id: 'p1', width: 330, qty: 5, length: 1000 }];
var plannedRuns = planning.plannedRunsForLayout(lay, posForCalc);
assertEqual(plannedRuns, 2, 'plannedRunsForLayout: ceil(qty/полос за проход) = ceil(5/3) = 2');

var batches = planning.producedBatchesForLayout(lay, 1000);
assertEqual(batches, [{ width: 330, strips: 3, length: 1000 }], 'producedBatchesForLayout: Партия ГП 330 мм, 3 полосы/проход');

var producedPosRolls = batches[0].strips * plannedRuns;   // 6
assertEqual({ produced: producedPosRolls, supply: 5, stock: producedPosRolls - 5 },
    { produced: 6, supply: 5, stock: 1 },
    'обеспечение = qty (5), излишек 330 мм → склад (1)');

// 5) formatFreeSlot: «<дата ЧЧ:ММ> (старт–финиш)» — парентеза по startMin/finishMin.
var slotLabel = planning.formatFreeSlot({ startTs: 0, startMin: 747, finishMin: 894 });
assertEqual(slotLabel.indexOf('(12:27–14:54)') >= 0, true, 'formatFreeSlot: парентеза (старт–финиш) = (12:27–14:54)');
assertEqual(planning.formatFreeSlot(null), 'нет данных', 'formatFreeSlot: null → «нет данных»');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
