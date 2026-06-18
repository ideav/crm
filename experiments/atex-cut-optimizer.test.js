// Unit tests for the «Расчёт оптимальной резки» core (ideav/crm#3465).
// Verifies the optimal-cutting calculator the workplace is built around
// (см. docs/atex_workplaces.md §3.12):
//   • computePlan reduces желаемые количества to their gcd ratio, packs as many
//     proportional sets as fit the джамбо width, then fills the remainder with
//     the same widths to minimise отход (surplus rolls → Склад);
//   • «Отход, мм» = ширина входа − Σ(ширина × количество);
//   • число резок (passes) ≈ g / sets so the итог по рулонам lands as close as
//     possible to the желаемому;
//   • widths wider than the джамбо are reported as overflow, not silently dropped;
//   • the canonical spec example (вход 880 → 60×14 + 40×1, отход 0) holds.
//
// Run with: node experiments/atex-cut-optimizer.test.js

var core = require('../download/atex/js/cut-optimizer.js').core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── toNumber / round3: терпимый разбор ──
assertEqual(core.toNumber('880'), 880, 'toNumber parses integer string');
assertEqual(core.toNumber('25,5'), 25.5, 'toNumber accepts comma decimal');
assertEqual(core.toNumber(' 1 200 '), 1200, 'toNumber strips spaces');
assertEqual(core.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(core.toNumber('abc'), 0, 'toNumber garbage → 0');
assertEqual(core.round3(1 / 3), 0.333, 'round3 trims float to 3 decimals');

// ── gcd helpers ──
assertEqual(core.gcd2(14, 1), 1, 'gcd2 of coprime is 1');
assertEqual(core.gcd2(28, 2), 2, 'gcd2 extracts common factor');
assertEqual(core.gcdAll([28, 2]), 2, 'gcdAll over a list');
assertEqual(core.gcdAll([]), 1, 'gcdAll of empty list → 1');
assertEqual(core.gcdAll([0, 0]), 1, 'gcdAll of zeros → 1');

// ── normalizeItems: числа, отбрасывание пустых ширин, qty ≥ 1 ──
assertEqual(core.normalizeItems([{ width: '60', qty: '14' }, { width: '', qty: '3' }, { width: '40', qty: '0' }]),
    [{ width: 60, qty: 14 }, { width: 40, qty: 1 }],
    'normalizeItems coerces numbers, drops empty width, floors qty to ≥ 1');

// ── fillRemainder: точный добор с минимальным остатком ──
var fill = core.fillRemainder(100, [60, 40]);
assertEqual({ counts: fill.counts, leftover: fill.leftover }, { counts: [1, 1], leftover: 0 },
    'fillRemainder fills 100 exactly with 60+40');
var fill2 = core.fillRemainder(90, [60, 40]);
assertEqual({ counts: fill2.counts, leftover: fill2.leftover }, { counts: [0, 2], leftover: 10 },
    'fillRemainder leaves the smallest leftover it can (2×40 → 10 beats 1×60 → 30)');

// ── expandSegments: один сегмент на каждый нож, со смещением слева ──
var segs = core.expandSegments([
    { width: 60, qty: 2, purpose: 'Заказ' },
    { width: 40, qty: 1, purpose: 'Склад' }
]);
assertEqual(segs.length, 3, 'expandSegments expands qty into individual knives (2+1)');
assertEqual(segs.map(function(s) { return s.offset; }), [0, 60, 120],
    'expandSegments accumulates left offset per knife');
assertEqual(segs.map(function(s) { return s.width; }), [60, 60, 40], 'expandSegments keeps each knife width');
assertEqual(segs[2].purpose, 'Склад', 'expandSegments carries purpose from its strip');

// ── computePlan: канонический пример из спецификации ──
// вход 880, цель 60×14 + 40×1 → отход 0, одна резка.
var plan = core.computePlan(880, [{ width: 60, qty: 14 }, { width: 40, qty: 1 }], { rollLength: 4000 });
assertEqual({
    feasible: plan.feasible,
    passes: plan.passes,
    used: plan.usedWidthPerPass,
    waste: plan.wastePerPass,
    strips: plan.stripsPerPass,
    produced: plan.results.map(function(r) { return r.produced; }),
    deviation: plan.results.map(function(r) { return r.deviation; })
}, {
    feasible: true,
    passes: 1,
    used: 880,
    waste: 0,
    strips: 15,
    produced: [14, 1],
    deviation: [0, 0]
}, 'computePlan reproduces canonical вход 880 → 60×14 + 40×1, отход 0');

// ── computePlan: несколько резок по пропорции ──
// цель 60×28 + 40×2 (та же пропорция 14:1) → 2 резки, точное попадание.
var plan2 = core.computePlan(880, [{ width: 60, qty: 28 }, { width: 40, qty: 2 }]);
assertEqual({ passes: plan2.passes, produced: plan2.results.map(function(r) { return r.produced; }), waste: plan2.totalWasteWidth },
    { passes: 2, produced: [28, 2], waste: 0 },
    'computePlan scales to 2 passes and hits the target exactly');

// ── computePlan: добор остатка в Склад ──
// вход 1000, цель 300×1 + 200×1: набор 500, sets=2 → план 2×300 + 2×200 = 1000,
// остаток 0; passes = round(1/2) → 1.
var plan3 = core.computePlan(1000, [{ width: 300, qty: 1 }, { width: 200, qty: 1 }]);
assertEqual({
    passes: plan3.passes,
    waste: plan3.wastePerPass,
    perPass: plan3.results.map(function(r) { return r.perPass; }),
    surplus: plan3.results.map(function(r) { return r.perPassSurplus; })
}, { passes: 1, waste: 0, perPass: [2, 2], surplus: [1, 1] },
    'computePlan packs 2 sets (waste 0) and labels the set beyond the order as Склад');

// ── computePlan: одиночная ширина заполняет джамбо (минимум отхода) ──
// вход 910, цель 100×4: влезает 9 полос (отход 10), 5 рулонов сверх плана → Склад.
var plan4 = core.computePlan(910, [{ width: 100, qty: 4 }]);
assertEqual({ perPass: plan4.results[0].perPass, waste: plan4.wastePerPass, deviation: plan4.results[0].deviation },
    { perPass: 9, waste: 10, deviation: 5 },
    'computePlan fills the width to minimise waste, reporting the surplus deviation');

// ── computePlan: ширина шире джамбо → overflow, не молча отброшена ──
var plan5 = core.computePlan(500, [{ width: 800, qty: 1 }]);
assertEqual({ feasible: plan5.feasible, overflow: plan5.overflow.length },
    { feasible: false, overflow: 1 }, 'computePlan flags a width wider than the джамбо as overflow');

// смешанный случай: часть ширин помещается, часть нет.
var plan6 = core.computePlan(500, [{ width: 800, qty: 1 }, { width: 200, qty: 1 }]);
assertEqual({ feasible: plan6.feasible, overflow: plan6.overflow.length, fits: plan6.results.length },
    { feasible: true, overflow: 1, fits: 1 }, 'computePlan keeps fitting widths and still reports overflow ones');

// ── computePlan: некорректный ввод ──
assertEqual(core.computePlan(0, [{ width: 60, qty: 1 }]).feasible, false, 'computePlan infeasible when input width is 0');
assertEqual(core.computePlan(880, []).feasible, false, 'computePlan infeasible with no strips');

// ── computePlan: площадь отхода учитывает длину рулона ──
// отход 10 мм × 1 проход × длина 4000 м = 0.01 м × 4000 = 40 м².
var plan7 = core.computePlan(910, [{ width: 100, qty: 4 }], { rollLength: 4000 });
assertEqual(plan7.totalWasteAreaM2, 40, 'computePlan computes total waste area from roll length');

// ── widthPercent: масштаб по max(вход, занято) ──
// вход 880 → 60/880*100 = 6.818
assertEqual(core.widthPercent(60, { inputWidth: 880, usedWidthPerPass: 880 }), 6.818,
    'widthPercent scales to input width');
assertEqual(core.widthPercent(50, { inputWidth: 0, usedWidthPerPass: 0 }), 0,
    'widthPercent is 0 when scale is 0');

console.log('\n' + passed + ' assertions passed');
