// Tests for ideav/crm#4156 — «Качество плана не сходится с Комбинациями по суммам наладки».
//
// Панель «Качество плана» показывала «фактические переналадки» из planQuality (веса штрафов
// планировщика): рост числа полос стоил KNIVES_INCREASE_COST_MN=50 вместо плоских 30 (#3600), а
// первому заданию станка вменялась смена сырья (ТЗ §13 п.4). Отчёт «Комбинации по всем позициям»
// суммирует ХРАНИМЫЕ колонки наладки задания (setupActivityColumns → firstSetupParts/changeoverParts):
// ножи плоско 30, у первого задания смены сырья нет. Отсюда суммы наладки расходились при совпадении
// числа заданий (114). На реальном плане: панель ножи 27 (970) / сырьё 47 (705) / переналадка 74 (1675);
// отчёт — ножи 27 (810) / сырьё 43 (645) / переналадка 70 (1455).
//
// Фикс #4156: панель читает «факт» из тех же хранимых колонок, что суммирует отчёт (storedSetupTotals),
// а не пересчитывает по весам. Веса штрафов остаются объективу «Упорядочить» (planQuality/planChangeoverMin).
//
// Run with: node experiments/atex-production-planning-4156.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;
var Controller = api.Controller;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// ── 1) Корень: канонная наладка (то, что суммирует отчёт) ≠ веса planQuality (старая панель) ──
// Один станок, станок пуст (нет заправки). A — первое задание; B наращивает полосы 1→3 при том же
// сырье; C меняет сырьё M1→M2 без смены ножей.
(function () {
    var times = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2 };
    var A = { id: 'A', slitterId: '1', knifeWidths: [50], knifeCount: 1, materialId: 'M1', winding: 'OUT', batchId: '', rollerWidth: 0 };
    var B = { id: 'B', slitterId: '1', knifeWidths: [50, 40, 30], knifeCount: 3, materialId: 'M1', winding: 'OUT', batchId: '', rollerWidth: 0 };
    var C = { id: 'C', slitterId: '1', knifeWidths: [50, 40, 30], knifeCount: 3, materialId: 'M2', winding: 'OUT', batchId: '', rollerWidth: 0 };

    // Хранимые колонки задания (setupActivityColumns) — их читает отчёт «Комбинации».
    var cols = planning.setupActivityColumns([A, B, C], times, null);
    assertEqual(cols['A'], { knifeMin: 30, materialWindingMin: 0 }, '#4156 канон: первое задание — только настройка ножей (30), смены сырья НЕТ');
    assertEqual(cols['B'], { knifeMin: 30, materialWindingMin: 0 }, '#4156 канон: рост полос 1→3 — ножи ПЛОСКО 30 (#3600), не 50');
    assertEqual(cols['C'], { knifeMin: 0, materialWindingMin: 15 }, '#4156 канон: смена сырья M1→M2 = 15, ножи не менялись → 0');
    var sumK = cols['A'].knifeMin + cols['B'].knifeMin + cols['C'].knifeMin;
    var sumM = cols['A'].materialWindingMin + cols['B'].materialWindingMin + cols['C'].materialWindingMin;
    assertEqual([sumK, sumM, sumK + sumM], [60, 15, 75], '#4156 канон Σ (= отчёт): ножи 60, смены сырья 15, переналадка 75');

    // Старая панель (planQuality по весам): первое задание = ножи + сырьё; рост полос = KNIVES_INCREASE 50.
    var slots = [{ ms: 1000, c: A }, { ms: 2000, c: B }, { ms: 3000, c: C }].map(function (x) {
        var c = x.c;
        return { id: c.id, slitterId: c.slitterId, dayKey: 20260701, planStartMs: x.ms,
                 knifeWidths: c.knifeWidths, knifeCount: c.knifeCount, materialId: c.materialId, winding: c.winding };
    });
    var pq = planning.planQuality(slots, { settings: {}, prevSetupBySlitter: {} });
    assertEqual([pq.all.knifeMin, pq.all.materialMin, pq.all.changeoverMin], [80, 30, 110],
        '#4156 старая панель РАЗДУВАЛА: ножи 80 (30+50-инкремент), сырьё 30 (15+15 у первого), переналадка 110 ≠ 75');
})();

// ── 2) storedSetupTotals — панель суммирует ХРАНИМЫЕ колонки (как строки отчёта), с окном [С;По] ──
(function () {
    function dk(s) { return planning.planDateDayKey(s); }
    var d1 = String(Math.floor(Date.UTC(2026, 6, 1) / 1000));   // 2026-07-01 → 20260701
    var d2 = String(Math.floor(Date.UTC(2026, 6, 2) / 1000));   // 2026-07-02
    var d3 = String(Math.floor(Date.UTC(2026, 6, 3) / 1000));   // 2026-07-03
    function cut(id, planDate, k, m) {
        return { id: id, planDate: planDate,
                 storedKnifeSetupMin: (k == null ? '' : String(k)),
                 storedMaterialWindingMin: (m == null ? '' : String(m)) };
    }
    var cuts = [
        cut('a', d1, 30, 0),    // первое задание: только ножи
        cut('b', d1, 30, 0),    // смена ножей
        cut('c', d1, 0, 15),    // смена сырья
        cut('d', d2, 0, 15),    // смена сырья
        cut('e', d3, 30, 15),   // и ножи, и сырьё
        cut('f', d3, null, null) // без наладки (пустые колонки)
    ];
    var ctrl = Object.create(Controller.prototype);
    ctrl.cuts = cuts;

    var res = ctrl.storedSetupTotals(dk(d1), dk(d2));   // окно [01.07; 02.07]
    // окно: a,b,c (01.07) + d (02.07) → ножи a30,b30=60 (2 задания); сырьё c15,d15=30 (2); переналадка 90 (4); заданий 4
    assertEqual(res.window, { knifeCount: 2, knifeMin: 60, materialCount: 2, materialMin: 30,
                              changeoverCount: 4, changeoverMin: 90, taskCount: 4 },
        '#4156 окно [С;По] = суммы хранимых колонок заданий окна');
    // all [01.07; конец]: + e (30/15) + f (0/0) → ножи 90 (3); сырьё 45 (3); переналадка 135 (6); заданий 6
    assertEqual(res.all, { knifeCount: 3, knifeMin: 90, materialCount: 3, materialMin: 45,
                           changeoverCount: 6, changeoverMin: 135, taskCount: 6 },
        '#4156 all [С; конец всех задач] — тултип за весь горизонт');
    assert(res.hasStored === true, '#4156 hasStored=true при наличии колонок #3698');

    // задание f без наладки считается в taskCount, но не в переналадках
    assertEqual([res.all.taskCount, res.all.changeoverCount], [6, 6],
        '#4156 задание без наладки входит в «всего заданий», но не в переналадки');
})();

// ── 3) База без колонок #3698 → hasStored=false (панель ОРЁТ ошибкой, не откатывается молча) ──
(function () {
    var d1 = String(Math.floor(Date.UTC(2026, 6, 1) / 1000));
    var ctrl = Object.create(Controller.prototype);
    ctrl.cuts = [
        { id: 'x', planDate: d1, storedKnifeSetupMin: '', storedMaterialWindingMin: '' },
        { id: 'y', planDate: d1, storedKnifeSetupMin: null, storedMaterialWindingMin: null }
    ];
    var res = ctrl.storedSetupTotals(null, null);
    // hasStored=false → renderQueue выводит ошибку (консоль+тост+красная плашка), НЕ подсовывает planQuality.
    assert(res.hasStored === false, '#4156 hasStored=false — нет ни одной заполненной колонки наладки → ошибка, не тихий откат');
    assertEqual(res.window.taskCount, 2, '#4156 taskCount считает задания даже без наладки');
    assertEqual([res.window.changeoverMin, res.window.changeoverCount], [0, 0], '#4156 без колонок наладка = 0');

    // Значение "0" в колонке — это ЗАПОЛНЕНО (план без наладки), а не «нет колонок»: hasStored=true.
    var ctrl0 = Object.create(Controller.prototype);
    ctrl0.cuts = [{ id: 'z', planDate: d1, storedKnifeSetupMin: '0', storedMaterialWindingMin: '0' }];
    assert(ctrl0.storedSetupTotals(null, null).hasStored === true, '#4156 хранимый «0» = заполнено (план без наладки), не ошибка');
})();

console.log('\n' + passed + ' assertions passed.');
