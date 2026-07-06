// Regression test for ideav/crm#4029 — «Отрицательный избыток при плане, продолжающем заправку».
//
// Панель «Качество плана» сверяет ФАКТ переналадок с ИДЕАЛОМ (минимум наладок). Идеал считался
// «с нуля» — каждый набор ножей и каждое сырьё окна = 1 наладка, БЕЗ учёта того, что станок уже
// заправлен. Когда задачи окна ПРОДОЛЖАЮТ заправку (факт 0 переналадок), идеал показывал «сколько-то
// часов», а избыток = факт − идеал уходил в МИНУС: «0 < идеала, значит план лучше идеала» — чего
// быть не может (пустой/наладки-не-требующий план выглядел «хорошим»).
//
// Фикс #4029: идеал (count/minutes) КРЕДИТУЕТ конфигурацию, уже стоящую на станке на входе окна
// (prevSetupBySlitter либо последняя дозадача до окна) — ровно как факт засчитывает её бесплатной
// первой наладкой. Избыток ≥ 0 = истинный минимум ПРИ ТЕКУЩЕЙ ЗАПРАВКЕ. knifeConfigs/materials
// остаются СЫРЫМ разнообразием (инвариант combos ≤ ножи×сырьё цел, #4008).
//
// Run with: node experiments/atex-production-planning-4029.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function eq(a, b, name) {
    var ok = a === b;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}
function ge0(a, name) {
    var ok = a >= 0;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + ' (' + JSON.stringify(a) + ' >= 0)');
    if (ok) { passed++; } else { failed++; process.exitCode = 1; }
}

var SETTINGS = { KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15 };
function ctlCut(o) {
    return { id: o.id, slitter: { id: o.s || '7' }, planDate: o.d, planStart: o.ps,
        knifeWidths: o.kw, knifeCount: o.kw.length, materialId: o.m, winding: o.w || 'IN', batchId: '' };
}

// ── 1. Реал-сценарий #4029: план ПРОДОЛЖАЕТ заправку → факт 0, избыток 0 (был −45) ────────────
console.log('\n== #4029: план продолжает заправку → факт 0, идеал 0, избыток 0 (не −45) ==');
// Станок 7 заправлен A/{100}. Обе задачи окна — тоже A/{100} → 0 переналадок (всё с заправки).
var cont = [
    ctlCut({ id: 1, d: '2026-07-03', ps: 100, kw: [100], m: 'A' }),
    ctlCut({ id: 2, d: '2026-07-03', ps: 200, kw: [100], m: 'A' })
];
var PREV = { '7': { materialId: 'A', winding: 'IN', knifeWidths: [100] } };
var v = planning.planQualityView(cont, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703, prevSetupBySlitter: PREV
});
eq(v.window.changeoverCount, 0, 'факт: 0 переналадок (задачи продолжают заправку)');
eq(v.idealWindow.count, 0, 'идеал ОКНА: 0 (заправка A/{100} закрывает всё — наладок не нужно)');
eq(v.idealWindow.minutes, 0, 'идеал ОКНА: 0 мин');
eq(v.qualityWindow.excessCount, 0, 'ИЗБЫТОК: 0, а не −2 (план не «лучше идеала»)');
eq(v.qualityWindow.excessMin, 0, 'ИЗБЫТОК: 0 мин, а не −45');
// Сырое разнообразие сохранено (для диагностики / инварианта #4008).
eq(v.idealWindow.knifeConfigs, 1, 'СЫРЫХ наборов ножей 1 ({100})');
eq(v.idealWindow.materials, 1, 'СЫРОГО сырья 1 (A)');

// ── 2. Реальная работа (смена конфигурации) даёт ПОЛОЖИТЕЛЬНЫЙ/нулевой избыток, не отрицательный ─
console.log('\n== #4029: смена ножей+сырья после заправки — избыток ≥ 0, наладка нужна ==');
var work = [
    ctlCut({ id: 1, d: '2026-07-03', ps: 100, kw: [100], m: 'A' }),   // = заправка (бесплатно)
    ctlCut({ id: 2, d: '2026-07-03', ps: 200, kw: [60, 60], m: 'B' }) // смена ножей + сырья
];
var v2 = planning.planQualityView(work, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703, prevSetupBySlitter: PREV
});
eq(v2.window.changeoverCount, 2, 'факт: 2 переналадки (ножи {100}→{60,60} + сырьё A→B)');
eq(v2.idealWindow.count, 2, 'идеал: 2 (заправка закрыла {100}/A; нужны {60,60} и B)');
eq(v2.qualityWindow.excessCount, 0, 'избыток 0 (план оптимален при заправке) — но НЕ отрицательный');
ge0(v2.qualityWindow.excessCount, 'избыток ≥ 0');

// ── 3. Инвариант: избыток НИКОГДА не отрицателен (несколько раскладок) ─────────────────────────
console.log('\n== #4029: избыток ≥ 0 во всех раскладках ==');
var scenarios = [
    [ctlCut({ id: 1, d: '2026-07-03', ps: 100, kw: [100], m: 'A' })],                                   // 1 задача = заправка
    [ctlCut({ id: 1, d: '2026-07-03', ps: 100, kw: [100], m: 'A' }), ctlCut({ id: 2, d: '2026-07-03', ps: 200, kw: [100], m: 'A' }), ctlCut({ id: 3, d: '2026-07-03', ps: 300, kw: [100], m: 'A' })],  // всё заправка
    [ctlCut({ id: 1, d: '2026-07-03', ps: 100, kw: [80], m: 'A' })]                                     // не совпадает с заправкой → наладка ножей
];
scenarios.forEach(function(sc, i) {
    var r = planning.planQualityView(sc, { settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703, prevSetupBySlitter: PREV });
    ge0(r.qualityWindow.excessCount, 'сценарий ' + (i + 1) + ': избыток окна ≥ 0');
    ge0(r.qualityAll.excessCount, 'сценарий ' + (i + 1) + ': избыток всего плана ≥ 0');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
