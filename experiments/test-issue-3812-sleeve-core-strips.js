// Unit tests for ideav/crm#3812 — втулка 0.5″ шириной 110 мм: втулочные полосы.
//
//   • isSleeveWidthProducible — на втулке 0.5″ риббон у́же 55 мм не производится;
//   • sleeveCoreStripPlan     — план полос 110 мм (55–57 → 2, 63–64 → 1, иначе 0);
//   • appendCoreStrip         — дописывание полос в раскрой (идемпотентно, core:true);
//   • интеграция: полосы попадают в «Партию ГП» (producedBatchesForLayout),
//     не урезаются capStockToHeadroom и не меняют проходы (plannedRunsForLayout).
//
// Run with: node experiments/test-issue-3812-sleeve-core-strips.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        failed++;
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// ── parseSleeveWidthFromName (фолбэк к реквизиту — реальные названия записей ateh) ──
assertEqual(planning.parseSleeveWidthFromName('Втулка картонная 0.5" ширина 110 мм'), 110, 'имя 0.5" ширина 110 мм → 110');
assertEqual(planning.parseSleeveWidthFromName('Втулка картонная 0.5" ширина 57 мм'), 57, 'имя 0.5" ширина 57 мм → 57');
assertEqual(planning.parseSleeveWidthFromName('Втулка пластиковая фиолетовая 1" ширина 55 мм'), 55, 'имя 1" ширина 55 мм → 55');
assertEqual(planning.parseSleeveWidthFromName('Втулка картонная (76мм/10мм/1000мм)'), null, 'имя без «ширина NN мм» → null');
assertEqual(planning.parseSleeveWidthFromName('Втулка картонная 1" длина 1 метр'), null, 'имя «длина 1 метр» → null');
assertEqual(planning.parseSleeveWidthFromName(''), null, 'пустое имя → null');

// ── isSleeveWidthProducible ──
assertEqual(planning.isSleeveWidthProducible(0.5, 54), false, '0.5″ ширина 54 → не производится');
assertEqual(planning.isSleeveWidthProducible(0.5, 55), true,  '0.5″ ширина 55 → производится');
assertEqual(planning.isSleeveWidthProducible(0.5, 57), true,  '0.5″ ширина 57 → производится');
assertEqual(planning.isSleeveWidthProducible(0.5, 30), false, '0.5″ ширина 30 → не производится');
assertEqual(planning.isSleeveWidthProducible(1,   30), true,  '1″ ширина 30 → производится (правило только для 0.5″)');
assertEqual(planning.isSleeveWidthProducible(null, 10), true, 'без втулки ширина 10 → производится');

// ── sleeveCoreStripPlan: только втулка 0.5″ шириной 110 мм ──
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [55]), { stripWidth: 110, count: 2 }, '0.5″/110 ширина 55 → 2 полосы 110');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [56]), { stripWidth: 110, count: 2 }, '0.5″/110 ширина 56 → 2 полосы 110');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [57]), { stripWidth: 110, count: 2 }, '0.5″/110 ширина 57 → 2 полосы 110');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [56, 57]), { stripWidth: 110, count: 2 }, '0.5″/110 ширины 56+57 → 2 полосы 110');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [63]), { stripWidth: 110, count: 1 }, '0.5″/110 ширина 63 → 1 полоса 110');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [64]), { stripWidth: 110, count: 1 }, '0.5″/110 ширина 64 → 1 полоса 110');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [63, 64]), { stripWidth: 110, count: 1 }, '0.5″/110 ширины 63+64 → 1 полоса 110');

// Вне диапазонов (строго по ТЗ) — полос нет.
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [58]), { stripWidth: 0, count: 0 }, '0.5″/110 ширина 58 → нет полос');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [62]), { stripWidth: 0, count: 0 }, '0.5″/110 ширина 62 → нет полос');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [65]), { stripWidth: 0, count: 0 }, '0.5″/110 ширина 65 → нет полос');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [70]), { stripWidth: 0, count: 0 }, '0.5″/110 ширина 70 → нет полос');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [80]), { stripWidth: 0, count: 0 }, '0.5″/110 ширина 80 (>70, правило 1″) → нет полос');
// Смешанные диапазоны в одной резке → полос нет (резка разбивается по count в профиле).
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, [55, 64]), { stripWidth: 0, count: 0 }, '0.5″/110 смешанные 55+64 → нет полос');
// Не та втулка / не тот диаметр → правило не действует.
assertEqual(planning.sleeveCoreStripPlan(0.5, 57, [55]), { stripWidth: 0, count: 0 }, '0.5″/57 ширина 55 → нет полос (втулка не 110)');
assertEqual(planning.sleeveCoreStripPlan(1, 110, [55]),  { stripWidth: 0, count: 0 }, '1″/110 ширина 55 → нет полос (диаметр не 0.5″)');
assertEqual(planning.sleeveCoreStripPlan(0.5, null, [55]), { stripWidth: 0, count: 0 }, '0.5″ без ширины втулки → нет полос');
assertEqual(planning.sleeveCoreStripPlan(0.5, 110, []), { stripWidth: 0, count: 0 }, '0.5″/110 без ширин → нет полос');

// ── appendCoreStrip ──
(function() {
    var lay = { strips: [{ width: 55, qty: 12, purpose: 'Заказ', positionIds: ['p1'] }] };
    planning.appendCoreStrip(lay, 110, 2);
    assertEqual(lay.strips.length, 2, 'appendCoreStrip: добавлена полоса (всего 2)');
    var core = lay.strips.filter(function(s) { return s.core; })[0];
    assertEqual({ width: core.width, qty: core.qty, purpose: core.purpose, core: core.core },
        { width: 110, qty: 2, purpose: 'Заказ', core: true }, 'appendCoreStrip: полоса 110×2, core:true, Заказ');
    // Идемпотентность — повторный вызов не двоит полосу.
    planning.appendCoreStrip(lay, 110, 2);
    assertEqual(lay.strips.filter(function(s) { return s.core; }).length, 1, 'appendCoreStrip: идемпотентно (одна полоса 110)');
    // count 0 → no-op.
    var lay0 = { strips: [{ width: 55, qty: 12 }] };
    planning.appendCoreStrip(lay0, 110, 0);
    assertEqual(lay0.strips.length, 1, 'appendCoreStrip: count 0 → ничего не добавляет');
})();

// ── Интеграция: «55мм × 12 + 110мм × 2» (пример из ТЗ) ──
(function() {
    var lay = { strips: [{ width: 55, qty: 12, purpose: 'Заказ', positionIds: ['p1'] }], positionsCovered: ['p1'] };
    planning.appendCoreStrip(lay, 110, 2);
    // «Партия ГП» по ширинам — втулочная полоса 110 присутствует (Σ полос за проход).
    var batches = planning.producedBatchesForLayout(lay, 1000);
    assertEqual(batches, [
        { width: 55, strips: 12, length: 1000 },
        { width: 110, strips: 2, length: 1000 }
    ], 'producedBatchesForLayout: раскрой = 55×12 + 110×2');

    // Проходы определяются продуктом (55), втулочная полоса их не меняет.
    var runs = planning.plannedRunsForLayout(lay, [{ id: 'p1', width: 55, qty: 24 }]);
    assertEqual(runs, 2, 'plannedRunsForLayout: проходы по продукту (24/12=2), полоса 110 не влияет');

    // capStockToHeadroom при нулевом запасе НЕ урезает втулочную полосу.
    var ctx = {
        runsForLayout: function() { return 3; },
        headroomForNom: function() { return 0; },         // нулевой лимит запаса
        demandRollsForWidth: function() { return 0; }
    };
    planning.capStockToHeadroom([lay], ctx);
    var core = lay.strips.filter(function(s) { return s.core; })[0];
    assertEqual(core && core.qty, 2, 'capStockToHeadroom: втулочная полоса 110×2 сохранена (не урезана)');
})();

// ── Профиль планирования разбит по числу втулочных полос (#3812) ──
(function() {
    // Один материал/намотка/втулка, но разная потребность в полосах 110:
    //   ширина 57 → 2 полосы, ширина 64 → 1 полоса, ширина 80 → 0 (>70, как 1″).
    var common = { materialId: 'm1', windDir: 'out', windLength: 300, sleeveId: 's110' };
    var positions = [
        Object.assign({ id: 'a', width: 57, coreStripCount: 2, coreStripWidth: 110 }, common),
        Object.assign({ id: 'b', width: 64, coreStripCount: 1, coreStripWidth: 110 }, common),
        Object.assign({ id: 'c', width: 80, coreStripCount: 0, coreStripWidth: 0 }, common)
    ];
    var profiles = planning.groupPositionsByPlanningProfile(positions);
    assertEqual(profiles.length, 3, 'groupPositionsByPlanningProfile: 3 профиля (полосы 2/1/0 не смешиваются)');
    assertEqual(profiles.map(function(g) { return g.coreStripCount; }).sort(), [0, 1, 2],
        'groupPositionsByPlanningProfile: профили несут coreStripCount 0/1/2');

    // Без втулочной специфики (count 0 у всех) разбиения нет — обратная совместимость.
    var plain = [
        Object.assign({ id: 'd', width: 40, coreStripCount: 0, coreStripWidth: 0 }, common),
        Object.assign({ id: 'e', width: 45, coreStripCount: 0, coreStripWidth: 0 }, common)
    ];
    assertEqual(planning.groupPositionsByPlanningProfile(plain).length, 1,
        'groupPositionsByPlanningProfile: без втулочных полос — один профиль (как раньше)');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки #3812 зелёные.');
