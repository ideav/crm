// Unit tests for #4008 — панель «Качество плана» (.atex-pp-quality) обогащена:
//  1) «уникальных комбинаций» — сколько всего разных настроек резки (набор ножей + сырьё +
//     намотка) встречается в плане (planQuality.combinations);
//  2) раздельные суммы наладки ножей и смены сырья (window.knifeCount/knifeMin и
//     window.materialCount/materialMin), из которых складываются «переналадки».
// DOM-панель (renderQueue) не тестируется — проверяем источник её чисел (planQualityView).
//
// Run with: node experiments/atex-production-planning-4008.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = a === b;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}

var SETTINGS = { KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15 };
function ctlCut(o) {
    return {
        id: o.id, slitter: { id: '7' }, planDate: '2026-07-03', planStart: o.ps,
        knifeWidths: o.kw, knifeCount: o.kw.length, materialId: o.m, winding: o.w != null ? o.w : 'IN', batchId: ''
    };
}

// Один станок, один день. Заправка на входе — сырьё A, ножи {100}.
//   1: {100} A  — как заправка → без переналадки
//   2: {100} B  — смена сырья A→B (15)
//   3: {100} A  — смена сырья B→A (15)
//   4: {60,60} A — наладка ножей (уширение полос 1→2 → KNIVES_INCREASE 50)
// Комбинации «ножи+сырьё+намотка»: {100|A}, {100|B}, {60|A} — три уникальные (1 и 3 совпадают).
var cuts = [
    ctlCut({ id: 1, ps: 100, kw: [100], m: 'A' }),
    ctlCut({ id: 2, ps: 200, kw: [100], m: 'B' }),
    ctlCut({ id: 3, ps: 300, kw: [100], m: 'A' }),
    ctlCut({ id: 4, ps: 400, kw: [60, 60], m: 'A' })
];
var view = planning.planQualityView(cuts, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703,
    prevSetupBySlitter: { '7': { materialId: 'A', winding: 'IN', knifeWidths: [100] } }
});

console.log('\n== #4008: уникальные комбинации + раздельные суммы ножи/сырьё ==');
// 1) Уникальные комбинации ножи+сырьё+намотка.
eq(view.combinations, 3, 'уникальных комбинаций (набор ножей + сырьё + намотка): 3');

// 2) Раздельные суммы наладки ножей и смены сырья за окно [С;По].
eq(view.window.knifeCount, 1, 'наладок ножей: 1 (переход {100}→{60,60})');
eq(view.window.knifeMin, 50, 'минут наладки ножей: 50 (уширение полос → KNIVES_INCREASE)');
eq(view.window.materialCount, 2, 'смен сырья: 2 (A→B, B→A)');
eq(view.window.materialMin, 30, 'минут смены сырья: 30 (2 × 15)');

// Суммы раздельных величин совпадают с общими «переналадками».
eq(view.window.knifeCount + view.window.materialCount, view.window.changeoverCount,
    'ножи + сырьё (кол-во) = переналадки');
eq(view.window.knifeMin + view.window.materialMin, view.window.changeoverMin,
    'ножи + сырьё (мин) = переналадки (мин)');

// Комбинаций не больше произведения уникальных наборов ножей × сырья, и ≥ max из них.
eq(view.combinations <= view.ideal.knifeConfigs * view.ideal.materials, true,
    'комбинаций ≤ (наборы ножей × сырьё)');
eq(view.combinations >= Math.max(view.ideal.knifeConfigs, view.ideal.materials), true,
    'комбинаций ≥ max(наборы ножей, сырьё)');

// Пустой план — нулевые комбинации без падения.
var empty = planning.planQualityView([], { settings: SETTINGS });
eq(empty.combinations, 0, 'пустой план → 0 комбинаций');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
