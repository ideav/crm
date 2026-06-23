// Unit tests for the «Расчёт оптимальной резки» core (ideav/crm#3465, #3474).
// Verifies the optimal-cutting calculator the workplace is built around
// (см. docs/atex_workplaces.md §3.12):
//   • расчёт идёт по ФАКТИЧЕСКОЙ ширине: справочник «Фактическая ширина резки»
//     (table 66190) переводит номинал в факт с учётом условия по ширине джамбо;
//   • в идеале — по одной карте раскроя на ширину; ширины объединяются в одну
//     карту только если это снижает суммарный отход; потолок — 3 карты;
//   • НИЧЕГО НА СКЛАД: каждая карта режет только заказанные ширины, остаток
//     джамбо — это «Отход»;
//   • «Отход, мм» карты = ширина входа − Σ(ширина × ножей);
//   • ширины шире джамбо — overflow, не отбрасываются молча;
//   • канонический пример (вход 880 → 60×14 + 40×1, отход 0) держится.
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

// ── #3474: фактическая ширина резки (table 66190) ──
assertEqual(core.parseActualWidthCode(''), { key: '', op: '', val: 0 }, 'parseActualWidthCode empty → unconditional');
assertEqual(core.parseActualWidthCode('j=910'), { key: 'j', op: '=', val: 910 }, 'parseActualWidthCode j=910');
assertEqual(core.parseActualWidthCode('j>1000'), { key: 'j', op: '>', val: 1000 }, 'parseActualWidthCode j>1000');
assertEqual(core.parseActualWidthCode('???'), { key: '?', op: '', val: 0 }, 'parseActualWidthCode garbage → never matches');
assertEqual(core.actualWidthCodeMatches({ key: '', op: '', val: 0 }, {}), true, 'unconditional rule always matches');
assertEqual(core.actualWidthCodeMatches({ key: 'j', op: '=', val: 910 }, { jumbo: 910 }), true, 'j=910 matches jumbo 910');
assertEqual(core.actualWidthCodeMatches({ key: 'j', op: '=', val: 910 }, { jumbo: 880 }), false, 'j=910 does not match jumbo 880');
assertEqual(core.actualWidthCodeMatches({ key: 's', op: '=', val: 1 }, { jumbo: 910 }), false, 's-rule without inches context never matches');

var awIndex = core.buildActualWidthIndex([
    { actual: 59, order: 60, code: '' },
    { actual: 58, order: 60, code: 'j=910' }
]);
assertEqual(core.resolveCutWidth(60, { jumbo: 910 }, awIndex), 58, 'resolveCutWidth prefers conditional rule (jumbo 910 → 58)');
assertEqual(core.resolveCutWidth(60, { jumbo: 880 }, awIndex), 59, 'resolveCutWidth falls back to unconditional (jumbo 880 → 59)');
assertEqual(core.resolveCutWidth(60, { jumbo: 880 }, {}), 60, 'resolveCutWidth with no rule keeps the nominal');

// ── normalizeItems: числа, отбрасывание пустых ширин, qty ≥ 1 ──
assertEqual(core.normalizeItems([{ width: '60', qty: '14' }, { width: '', qty: '3' }, { width: '40', qty: '0' }]),
    [{ width: 60, qty: 14 }, { width: 40, qty: 1 }],
    'normalizeItems coerces numbers, drops empty width, floors qty to ≥ 1');

// ── packGroup: раскладка одной карты ──
var pg = core.packGroup(880, [60, 40], [14, 1]);
assertEqual({ knives: pg.knives, passes: pg.passes, used: pg.usedWidth, trim: pg.trimWidth },
    { knives: [14, 1], passes: 1, used: 880, trim: 0 },
    'packGroup packs the proportional set 60×14 + 40×1 with no trim');
var pg2 = core.packGroup(910, [100], [4]);
assertEqual({ knives: pg2.knives, passes: pg2.passes, trim: pg2.trimWidth, fits: pg2.fits },
    { knives: [9], passes: 1, trim: 10, fits: true },
    'packGroup fills a single width to minimise trim (9×100, trim 10)');
// набор шире джамбо — одной картой группу не нарезать (её надо разбить).
assertEqual(core.packGroup(880, [59, 39, 100], [14, 1, 4]).fits, false,
    'packGroup reports fits=false when the proportional set is wider than the джамбо');

// ── partitionsAtMost ──
assertEqual(core.partitionsAtMost(1, 3), [[[0]]], 'partitionsAtMost(1) → single block');
assertEqual(core.partitionsAtMost(2, 3), [[[0, 1]], [[0], [1]]], 'partitionsAtMost(2) → joined and split');

// ── expandSegments: один сегмент на каждый нож, со смещением слева ──
var segs = core.expandSegments([{ width: 60, knives: 2 }, { width: 40, knives: 1 }]);
assertEqual(segs.length, 3, 'expandSegments expands knives into individual segments (2+1)');
assertEqual(segs.map(function(s) { return s.offset; }), [0, 60, 120], 'expandSegments accumulates left offset per knife');
assertEqual(segs.map(function(s) { return s.width; }), [60, 60, 40], 'expandSegments keeps each knife width');

// ── computePlan: канонический пример (одна карта, отход 0) ──
var plan = core.computePlan(880, [{ width: 60, qty: 14 }, { width: 40, qty: 1 }], { rollLength: 4000 });
assertEqual({
    feasible: plan.feasible,
    maps: plan.mapCount,
    passes: plan.totalPasses,
    waste: plan.totalWasteWidth,
    produced: plan.results.map(function(r) { return r.produced; }),
    deviation: plan.results.map(function(r) { return r.deviation; })
}, {
    feasible: true, maps: 1, passes: 1, waste: 0,
    produced: [14, 1], deviation: [0, 0]
}, 'computePlan reproduces canonical вход 880 → 60×14 + 40×1, one map, отход 0');

// ── computePlan: объединение карт только если снижает отход ──
// 60×14 + 40×1: раздельные карты дают отход 40, объединённая — 0 → одна карта.
assertEqual(core.computePlan(880, [{ width: 60, qty: 14 }, { width: 40, qty: 1 }]).mapCount, 1,
    'computePlan merges widths into one map when it removes waste');

// ── computePlan: считает по ФАКТИЧЕСКОЙ ширине (66190) ──
// номинал 60 → факт 59 (безусловное правило); раскрой идёт по 59.
var planAW = core.computePlan(880, [{ width: 60, qty: 14 }, { width: 40, qty: 1 }],
    { actualWidthIndex: core.buildActualWidthIndex([{ actual: 59, order: 60, code: '' }]) });
assertEqual(planAW.results.map(function(r) { return r.actualWidth; }), [59, 40],
    'computePlan resolves nominal 60 → actual 59 before layout');
assertEqual(planAW.results[0].nominalWidth, 60, 'computePlan keeps the nominal width for display');

// ── computePlan: ближе к желаемому важнее отхода — ширину нельзя выкидывать ──
// 59×14 + 39×1 ложатся в пару (карта 1), 100×4 — отдельная карта; ни одна ширина
// не теряется ради нулевого отхода (регресс ideav/crm#3474).
var planMix = core.computePlan(880, [{ width: 60, qty: 14 }, { width: 40, qty: 1 }, { width: 100, qty: 4 }],
    { actualWidthIndex: core.buildActualWidthIndex([{ actual: 59, order: 60, code: '' }, { actual: 39, order: 40, code: 'j=880' }]) });
assertEqual({
    maps: planMix.mapCount,
    got: planMix.results.map(function(r) { return r.produced; }),
    allWidthsCut: planMix.results.every(function(r) { return r.produced > 0; })
}, { maps: 2, got: [14, 1, 8], allWidthsCut: true },
    'computePlan keeps every width (demand-first), never drops one to chase zero waste');

// ── computePlan: одиночная ширина заполняет джамбо, лишнее — это Δ (не склад) ──
var plan4 = core.computePlan(910, [{ width: 100, qty: 4 }]);
assertEqual({ maps: plan4.mapCount, produced: plan4.results[0].produced, waste: plan4.totalWasteWidth, dev: plan4.results[0].deviation },
    { maps: 1, produced: 9, waste: 10, dev: 5 },
    'computePlan fills the width (9×100), reports the surplus as Δ, no Склад');

// ── computePlan: НИЧЕГО НА СКЛАД — в плане нет складских полос ──
assertEqual(JSON.stringify(plan4).toLowerCase().indexOf('склад') < 0 &&
    JSON.stringify(plan4).toLowerCase().indexOf('stock') < 0, true,
    'computePlan never produces Склад/stock segments (#3474)');

// ── computePlan: потолок 3 карты при многих ширинах ──
var plan5 = core.computePlan(2000, [
    { width: 100, qty: 1 }, { width: 200, qty: 1 }, { width: 300, qty: 1 }, { width: 400, qty: 1 }
]);
assertEqual(plan5.mapCount <= 3, true, 'computePlan caps the number of maps at 3');

// ── computePlan: ширина шире джамбо → overflow, не молча отброшена ──
var plan6 = core.computePlan(500, [{ width: 800, qty: 1 }]);
assertEqual({ feasible: plan6.feasible, overflow: plan6.overflow.length },
    { feasible: false, overflow: 1 }, 'computePlan flags a width wider than the джамбо as overflow');
var plan7 = core.computePlan(500, [{ width: 800, qty: 1 }, { width: 200, qty: 1 }]);
assertEqual({ feasible: plan7.feasible, overflow: plan7.overflow.length, fits: plan7.results.length },
    { feasible: true, overflow: 1, fits: 1 }, 'computePlan keeps fitting widths and still reports overflow ones');

// ── computePlan: некорректный ввод ──
assertEqual(core.computePlan(0, [{ width: 60, qty: 1 }]).feasible, false, 'computePlan infeasible when input width is 0');
assertEqual(core.computePlan(880, []).feasible, false, 'computePlan infeasible with no strips');

// ── computePlan: площадь отхода (м²) по картам, проходам и длине рулона ──
// одна карта 100×9, отход 10 мм, 1 проход, длина 4000 → 0.01 м × 4000 = 40 м².
var plan8 = core.computePlan(910, [{ width: 100, qty: 4 }], { rollLength: 4000 });
assertEqual(plan8.totalWasteAreaM2, 40, 'computePlan computes total waste area from trim, passes and roll length');
// масштабирование с числом проходов: 110×8 (отход 11) × 10 резок × 4000 м = 4.4 м²/резку × 10.
var plan9 = core.computePlan(891, [{ width: 110, qty: 80 }], { rollLength: 4000 });
assertEqual({ passes: plan9.totalPasses, wasteMm: plan9.totalWasteWidth, areaM2: plan9.totalWasteAreaM2 },
    { passes: 10, wasteMm: 110, areaM2: 440 },
    'computePlan total waste area scales with passes (110×8 × 10 резок → 440 м²)');

// ── widthPercent: масштаб по max(вход, занято) ──
assertEqual(core.widthPercent(60, 880, 880), 6.818, 'widthPercent scales to input width');
assertEqual(core.widthPercent(50, 0, 0), 0, 'widthPercent is 0 when scale is 0');

console.log('\n' + passed + ' assertions passed');
