// Unit-тесты для режима «Резка под одну позицию» (форма «Новая производственная резка»).
// Проверяют чистую логику, на которую опирается computeCutPlan/createCutForPosition:
//   • freeSlotForQueue — ближайшее свободное окно станка (проспект в конец очереди,
//     рабочее окно дня, перенос на след. день при нехватке);
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

// 1) Пустой станок: резка стартует в начале смены (08:00), setup = лидер 2 мин.
assertEqual(
    planning.freeSlotForQueue([], prospect(), OPTS),
    { windowStartMin: 480, startMin: 482, finishMin: 502, durationMin: 20, setupMin: 2, day: 0 },
    'freeSlotForQueue: пустой станок → старт 08:00'
);

// 2) Одна резка в очереди (10 мин): проспект встаёт сразу после неё (та же сигнатура → переналадка 0).
var one = [cut('c1', 1, 100)];
var optsOne = { windPoints: WIND, shiftStartMin: 480, shiftEndMin: 990, runLengthByCut: { c1: 100 } };
//   c1: setup 2, 482–492. Проспект: setup 2, 494–514, окно с 492.
assertEqual(
    planning.freeSlotForQueue(one, prospect(), optsOne),
    { windowStartMin: 492, startMin: 494, finishMin: 514, durationMin: 20, setupMin: 2, day: 0 },
    'freeSlotForQueue: после существующей резки в тот же день'
);

// 3) День занят почти полностью: проспект не влезает до 16:30 → переносится на 08:00 след. дня.
//   c1: 1000 м × 5 проходов = 500 мин; setup 2 → 482–982. Проспект 20 мин: 984+20=1004 > 990
//   → день 1, старт 1922 (1440+480+2), окно с 1920.
var full = [cut('c1', 5, 1000)];
var optsFull = { windPoints: WIND, shiftStartMin: 480, shiftEndMin: 990, runLengthByCut: { c1: 1000 } };
assertEqual(
    planning.freeSlotForQueue(full, prospect(), optsFull),
    { windowStartMin: 1920, startMin: 1922, finishMin: 1942, durationMin: 20, setupMin: 2, day: 1 },
    'freeSlotForQueue: нет места сегодня → перенос на след. рабочий день'
);

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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
