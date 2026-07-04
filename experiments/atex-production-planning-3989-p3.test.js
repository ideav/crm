// Unit tests for #3989 Фаза 3 — панель качества плана (планировщик → planQuality).
// Проверяется ЧИСТЫЙ маппинг planQualityView: резки контроллера (mapCutRecord: вложенный
// slitter.id, planDate) → слоты planQuality, и корректные итоги/подписи. DOM-панель
// (renderQueue) здесь не тестируется — только источник её чисел.
//
// Run with: node experiments/atex-production-planning-3989-p3.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = a === b;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}

var SETTINGS = { KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15 };

// Резки в форме контроллера: вложенный slitter.id и planDate (ISO). knifeWidths развёрнут.
function ctlCut(o) {
    return {
        id: o.id, slitter: { id: o.slitterId }, planDate: o.planDate, planStart: o.planStart,
        knifeWidths: o.knifeWidths || [], knifeCount: o.knifeWidths ? o.knifeWidths.length : (o.knifeCount || 0),
        materialId: o.materialId, winding: o.winding != null ? o.winding : 'IN', batchId: '', dueKey: o.dueKey
    };
}

// Станок C1: два задания в один день, смена сырья A→B; заправка = A/{100}.
var cuts = [
    ctlCut({ id: 1, slitterId: '7', planDate: '2026-07-03', planStart: 100, knifeWidths: [100], materialId: 'A' }),
    ctlCut({ id: 2, slitterId: '7', planDate: '2026-07-03', planStart: 200, knifeWidths: [100], materialId: 'B' })
];
var view = planning.planQualityView(cuts, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703,
    prevSetupBySlitter: { '7': { materialId: 'A', winding: 'IN', knifeWidths: [100] } }
});

console.log('\n== planQualityView: маппинг slitter.id/planDate → planQuality ==');
eq(view.window.changeoverCount, 1, 'окно: 1 переналадка (смена сырья A→B)');
eq(view.window.changeoverMin, 15, 'окно: 15 мин');
eq(view.ideal.knifeConfigs, 1, 'идеал: 1 набор ножей ({100})');
eq(view.ideal.materials, 2, 'идеал: 2 сырья (A,B)');
eq(view.ideal.count, 3, 'идеал: 3 переналадки');
eq(view.ideal.minutes, 60, 'идеал: 1×30 + 2×15 = 60 мин');
eq(view.qualityWindow.excessCount, 1 - 3, 'избыток окна: 1 − 3 = -2');

// Пустой список — нулевые итоги без падения.
var empty = planning.planQualityView([], { settings: SETTINGS });
eq(empty.window.changeoverCount, 0, 'пустой план → 0 переналадок');
eq(empty.ideal.count, 0, 'пустой план → идеал 0');

console.log('\n== formatQualityDelta ==');
eq(planning.formatQualityDelta(3), '+3', '+3');
eq(planning.formatQualityDelta(0), '0', '0');
eq(planning.formatQualityDelta(-2), '−2', '−2 (минус — план лучше идеала)');

console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
