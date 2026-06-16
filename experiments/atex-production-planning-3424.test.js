// Unit tests for #3424 — look-ahead с несогласованными позициями.
// Проверяет чистые хелперы метрик сценариев планирования:
//   • layoutsScenarioMetrics — удельные метрики набора раскладок (доля отхода, переналадки/резку);
//   • scenarioIsParetoBetter — критерий «сценарий с несогласованными лучше по Парето».
//
// Run with: node experiments/atex-production-planning-3424.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// ── scenarioIsParetoBetter ──
var pareto = planning.scenarioIsParetoBetter;
var base = { wasteRatio: 0.10, changeoverPerCut: 5 };
assert(pareto(base, { wasteRatio: 0.08, changeoverPerCut: 5 }) === true, 'меньше отхода, равные переналадки → лучше');
assert(pareto(base, { wasteRatio: 0.10, changeoverPerCut: 4 }) === true, 'равный отход, меньше переналадок → лучше');
assert(pareto(base, { wasteRatio: 0.07, changeoverPerCut: 3 }) === true, 'лучше обе → лучше');
assert(pareto(base, { wasteRatio: 0.08, changeoverPerCut: 6 }) === false, 'меньше отхода, но больше переналадок → не Парето');
assert(pareto(base, { wasteRatio: 0.12, changeoverPerCut: 4 }) === false, 'больше отхода, меньше переналадок → не Парето');
assert(pareto(base, { wasteRatio: 0.10, changeoverPerCut: 5 }) === false, 'идентичны → не лучше');
assert(pareto(null, base) === false, 'нет базы → false');

// ── layoutsScenarioMetrics ──
var metrics = planning.layoutsScenarioMetrics;
var layouts = [
    { mat: 'M1', windDir: 'нар', remainder: 100, plannedRuns: 2, strips: [{ width: 450, qty: 2 }], isFoil: false },
    { mat: 'M1', windDir: 'нар', remainder: 50,  plannedRuns: 1, strips: [{ width: 475, qty: 2 }], isFoil: false }
];
var deps = { jumboWidthByMaterial: { M1: 1000 }, positions: [], weights: {} };
var m = metrics(layouts, deps);
// totalRemainder = 100×2 + 50×1 = 250; totalJumbo = 1000×2 + 1000×1 = 3000.
assert(m.nCuts === 2, 'nCuts = 2');
assert(approx(m.totalWasteMm, 250), 'totalWasteMm = 250');
assert(approx(m.wasteRatio, 250 / 3000), 'wasteRatio = 250/3000');
assert(isFinite(m.changeoverMin) && m.changeoverMin >= 0, 'changeoverMin — конечное ≥ 0');
assert(isFinite(m.changeoverPerCut) && m.changeoverPerCut >= 0, 'changeoverPerCut — конечное ≥ 0');

// Отрицательный остаток (overflow в пределах допуска) не уменьшает отход (clamp ≥ 0).
var negLay = [{ mat: 'M1', windDir: 'нар', remainder: -20, plannedRuns: 1, strips: [{ width: 500, qty: 2 }], isFoil: false }];
assert(metrics(negLay, deps).totalWasteMm === 0, 'отрицательный остаток → отход 0 (clamp)');

// Пустой набор → нули, без деления на ноль.
var me = metrics([], deps);
assert(me.nCuts === 0 && me.wasteRatio === 0 && me.changeoverPerCut === 0, 'пустой набор → нули');

console.log('\n' + passed + ' passed');
