// Unit tests for #3783/#3785 — порядок очереди станка.
// #3783: сырьё шло вперемешку (MWR118, MWR113L, MWR118, …) — лишние переналадки.
// #3785: «при прочих равных — число полос по убыванию».
// Фикс: SETUP-стратегия sequenceForStrategy = greedySequence (минимум переналадки —
// ПЕРВИЧНО, группирует сырьё/набор ножей), startKey тай-брейк = число полос по
// убыванию. Убран глобальный byKnifeCountDesc (#3568), который пересортировывал всю
// цепочку по ножам, разбивая группы сырья.
//
// Run with: node experiments/atex-production-planning-3783.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function mk(id, mat, wind, rollerWidth, knifeCount, widthVal) {
    var kw = []; for (var i = 0; i < knifeCount; i++) kw.push(widthVal);
    return { id: id, materialId: mat, winding: wind, batchId: '', rollerWidth: rollerWidth,
        knifeCount: knifeCount, knifeWidths: kw, isFoil: false };
}
function mats(seq) { return seq.map(function(c) { return c.materialId + '/' + c.winding; }); }
function boundaries(seq) { var b = 0; for (var i = 1; i < seq.length; i++) if (seq[i].materialId !== seq[i-1].materialId) b++; return b; }
function chainCost(seq) { var t = 0; for (var i = 1; i < seq.length; i++) t += planning.changeoverCost(seq[i-1], seq[i], null); return t; }

// ── #3783: все резки с одним набором ножей (27×32.5), сырьё MWR118/MWR113L вперемешку ──
var cuts3783 = [
    mk('1', 'MWR118',  'OUT', 900, 27, 32.5),
    mk('2', 'MWR113L', 'OUT', 600, 27, 32.5),
    mk('3', 'MWR118',  'OUT', 900, 27, 32.5),
    mk('4', 'MWR113L', 'OUT', 600, 27, 32.5),
    mk('5', 'MWR118',  'IN',  650, 27, 32.5),
    mk('6', 'MWR118',  'OUT', 900, 21, 32.5)
];
var o3783 = planning.orderCuts(cuts3783, 'setup');
// MWR113L (2 шт) и MWR118 (4 шт) → ровно 1 граница смены сырья (сгруппировано), а не 4 как в исходном
assertEqual(boundaries(o3783), 1, '#3783: сырьё сгруппировано — одна граница смены сырья (было вперемешку)');
// переналадка упорядоченной не больше исходной (creation order)
assertEqual(chainCost(o3783) <= chainCost(cuts3783), true, '#3783: переналадка после упорядочивания не выросла');

// ── #3785: одно сырьё/намотка (MW308 IN), число полос 9/7/15 → по убыванию 15,9,7 ──
var cuts3785 = [
    mk('3', 'MW308', 'IN', 540, 9,  98),
    mk('4', 'MW308', 'IN', 600, 7,  150),
    mk('5', 'MW308', 'IN', 281, 15, 59)
];
assertEqual(planning.orderCuts(cuts3785, 'setup').map(function(c) { return c.knifeCount; }), [15, 9, 7],
    '#3785: внутри одного сырья полосы строго по убыванию (15,9,7)');

// ── straddle: число полос пересекает границу сырья (MW308:15,7 vs MR194:10) ──
// byKnifeCountDesc дал бы 15(MW308),10(MR194),7(MW308) — сырьё вперемешку. Группировка
// сырья (минимум переналадки) держит MW308 вместе и снижает переналадку.
var straddle = [
    mk('A', 'MW308', 'IN', 540, 15, 59),
    mk('B', 'MR194', 'IN', 450, 10, 40),
    mk('C', 'MW308', 'IN', 600, 7,  59)
];
var oStr = planning.orderCuts(straddle, 'setup');
assertEqual(boundaries(oStr), 1, 'straddle: сырьё не разбито числом ножей (1 граница, не 2)');
assertEqual(chainCost(oStr) < chainCost(straddle), true, 'straddle: переналадка снижена группировкой сырья');

// ── startKey тай-брейк: при равной стоимости (одно сырьё, набор ножей одинаков) больше полос раньше ──
var sameAll = [
    mk('p5',  'MW', 'IN', 500, 5,  30),
    mk('p20', 'MW', 'IN', 500, 20, 30),
    mk('p12', 'MW', 'IN', 500, 12, 30),
    mk('p8',  'MW', 'IN', 500, 8,  30)
];
assertEqual(planning.orderCuts(sameAll, 'setup').map(function(c) { return c.knifeCount; }), [20, 12, 8, 5],
    '#3785 тай-брейк: при прочих равных полосы по убыванию (20,12,8,5)');

// ── FATIGUE-стратегия не затронута (остаётся «сложные раньше») ──
var fat = [ mk('a', 'M', 'IN', 500, 6, 30), mk('b', 'M', 'IN', 500, 16, 30), mk('c', 'M', 'IN', 500, 16, 30) ];
assertEqual(planning.orderCuts(fat, { strategy: planning.PLANNING_STRATEGY_FATIGUE }).map(function(c) { return c.knifeCount; }), [6, 16, 16],
    'FATIGUE не затронута: остаётся прежний порядок (6,16,16)');

console.log('\n' + passed + ' assertions passed');
