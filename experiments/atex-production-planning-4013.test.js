// Unit tests for #4013 — «Правильно обработать отрицательный избыток при пустом плане».
//
// Баг: идеал и уникальные комбинации панели «Качество плана» считались по ВСЕМУ плану, а факт
// переналадок — за окно [С;По]. На пустом окне (день-выходной без заданий) панель показывала
// «идеал: 48 (1110 мин), избыток: −48 (−1110 мин), комбинаций: 63» — числа от задач ДРУГИХ дней.
//
// Фикс: у planQuality появились ОКОННЫЕ поля idealWindow/combinationsWindow, а qualityWindow
// теперь = факт окна vs идеал ОКНА. Панель читает их (пустое окно → 0/0/0). Поля ideal/combinations
// (весь план) и qualityAll не изменились (совместимость + всплывающая подсказка).
//
// #4029: идеал (count/minutes) теперь КРЕДИТУЕТ заправку станка — конфигурация, уже стоящая на
// станке на входе окна, наладки не требует (как и факт). Поэтому идеал ОКНА/всего плана ниже
// «сырого» разнообразия, а избыток ≥ 0 (раньше факт, вошедший настроенным, оказывался «лучше
// идеала» — отрицательный избыток; так быть не может). knifeConfigs/materials = СЫРОЕ разнообразие
// (не кредитуются, инвариант combos ≤ ножи×сырьё цел).
//
// Run with: node experiments/atex-production-planning-4013.test.js

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
        id: o.id, slitter: { id: '7' }, planDate: o.planDate, planStart: o.ps,
        knifeWidths: o.kw, knifeCount: o.kw.length, materialId: o.m, winding: o.w != null ? o.w : 'IN', batchId: ''
    };
}

// Один станок «7», заправка A/{100}. Задания только на 03.07 и 04.07:
//   03.07  t1 {100} A  (как заправка → без переналадки)
//          t2 {100} B  (смена сырья A→B → 15)
//   04.07  t3 {60,60} B (наладка ножей {100}→{60,60}, уширение 1→2 → KNIVES_INCREASE 50)
// Весь план: наборы ножей {100},{60,60} → 2; сырьё {A,B} → 2; комбинации {100·A},{100·B},{60·B} → 3.
var cuts = [
    ctlCut({ id: 1, planDate: '2026-07-03', ps: 100, kw: [100], m: 'A' }),
    ctlCut({ id: 2, planDate: '2026-07-03', ps: 200, kw: [100], m: 'B' }),
    ctlCut({ id: 3, planDate: '2026-07-04', ps: 100, kw: [60, 60], m: 'B' })
];
var PREV = { '7': { materialId: 'A', winding: 'IN', knifeWidths: [100] } };

// ── 1. ПУСТОЕ окно 06.07..06.07 (день-выходной): задач нет, план непустой ─────────────────────
console.log('\n== #4013: пустое окно (день-выходной) → панель 0/0/0, а не идеал 4 / избыток −4 ==');
var off = planning.planQualityView(cuts, {
    settings: SETTINGS, scopeFromKey: 20260706, scopeToKey: 20260706, prevSetupBySlitter: PREV
});
// Панельные (оконные) поля — нули.
eq(off.window.changeoverCount, 0, 'пустое окно: 0 переналадок');
eq(off.idealWindow.count, 0, 'пустое окно: идеал ОКНА 0 (а НЕ от задач других дней)');
eq(off.idealWindow.minutes, 0, 'пустое окно: идеал ОКНА 0 мин');
eq(off.combinationsWindow, 0, 'пустое окно: 0 комбинаций ОКНА');
eq(off.qualityWindow.excessCount, 0, 'пустое окно: избыток 0 (был −48 в баге)');
eq(off.qualityWindow.excessMin, 0, 'пустое окно: избыток 0 мин (был −1110 в баге)');
// Поля всего плана (совместимость + подсказка) — их панель НЕ показывает.
// #4029: идеал всего плана = 2 (заправка A/{100} закрывает 1 набор ножей + 1 сырьё; остаются
// {60,60} и сырьё B). Раньше было 4 (без кредита заправки).
eq(off.ideal.count, 2, 'весь план: идеал 2 (с кредитом заправки A/{100})');
eq(off.combinations, 3, 'весь план (совместимость): 3 комбинации (СЫРОЕ разнообразие, не кредитуется)');

// ── 2. Частичное окно 03.07..03.07: идеал/комбинации ОКНА только за день; избыток ≥ 0 ─────────
console.log('\n== #4013/#4029: частичное окно 03.07 — оконный идеал с кредитом заправки, избыток ≥ 0 ==');
var d3 = planning.planQualityView(cuts, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703, prevSetupBySlitter: PREV
});
eq(d3.window.changeoverCount, 1, 'окно 03.07: 1 переналадка (A→B)');
eq(d3.window.materialMin, 15, 'окно 03.07: 15 мин смены сырья');
// Сырое разнообразие окна: набор {100} (1), сырьё {A,B} (2). Заправка A/{100} кредитует набор {100}
// и сырьё A → нужно наладок: 0 ножей + 1 сырьё = 1. Раньше идеал ОКНА был 3 (без кредита).
eq(d3.idealWindow.knifeConfigs, 1, 'окно 03.07: СЫРЫХ наборов ножей 1 ({100})');
eq(d3.idealWindow.materials, 2, 'окно 03.07: СЫРОГО сырья 2 (A,B)');
eq(d3.idealWindow.count, 1, 'окно 03.07: идеал ОКНА 1 (заправка A/{100} закрывает старт → нужна лишь смена на B)');
eq(d3.combinationsWindow, 2, 'окно 03.07: 2 комбинации ОКНА ({100·A},{100·B}) — БЕЗ {60·B}');
eq(d3.qualityWindow.excessCount, 1 - 1, 'окно 03.07: избыток 1−1 = 0 (≥ 0, не отрицательный)');
// Поля всего плана видят и 04.07 → шире окна.
eq(d3.combinations, 3, 'весь план: 3 комбинации (виден и {60·B} с 04.07)');
eq(d3.ideal.count, 2, 'весь план: идеал 2 (с кредитом заправки)');

// ── 3. Полное окно 03.07..04.07: окно == план (регресс — оконный идеал == весь план) ─────────
console.log('\n== #4013: полное окно == весь план (без регресса) ==');
var full = planning.planQualityView(cuts, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260704, prevSetupBySlitter: PREV
});
eq(full.window.changeoverCount, 2, 'полное окно: 2 переналадки (сырьё A→B + ножи {100}→{60,60})');
eq(full.window.knifeMin, 50, 'полное окно: 50 мин ножей (уширение)');
eq(full.window.materialMin, 15, 'полное окно: 15 мин сырья');
eq(full.idealWindow.count, 2, 'полное окно: идеал ОКНА 2 == весь план (с кредитом заправки)');
eq(full.combinationsWindow, 3, 'полное окно: 3 комбинации ОКНА == весь план');
eq(full.qualityWindow.excessCount, 2 - 2, 'полное окно: избыток 2−2 = 0 (заправка учтена и в идеале → ≥ 0)');

// ── 4. Совсем пустой список слотов — без падения ──────────────────────────────────────────────
console.log('\n== #4013: пустой список слотов ==');
var empty = planning.planQualityView([], { settings: SETTINGS });
eq(empty.window.changeoverCount, 0, 'нет слотов: 0 переналадок');
eq(empty.idealWindow.count, 0, 'нет слотов: идеал ОКНА 0');
eq(empty.combinationsWindow, 0, 'нет слотов: 0 комбинаций ОКНА');
eq(empty.ideal.count, 0, 'нет слотов: идеал всего плана 0');
eq(empty.combinations, 0, 'нет слотов: 0 комбинаций всего плана');
eq(empty.qualityWindow.excessCount, 0, 'нет слотов: избыток 0');

console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
