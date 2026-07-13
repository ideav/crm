// #4230 — «То, что идет на склад/в отходы подсвечивать красным». В сводке полос карточки
// (renderQueue) полоса, НЕ идущая в заказ, показывается красным и вместо срока пишет «Склад»
// (номенклатура есть в «Максимальном запасе», table/67113) или «Отходы» (нарезать впрок нельзя).
//
// Полоса «в заказ» — если её ширина совпадает с шириной обеспечиваемой позиции заказа. У карточки
// нет id полос (в отличие от редактора полос, где назначение берётся из orderedBatchIds по id
// «Партии ГП»), поэтому «заказные» ширины выводит новый чистый помощник cutOrderedWidthKeys
// (supply.positionId → позиция → width, фолбэк supply.positionWidth). Остальные ширины → склад/отходы
// через stockStripPurpose. Здесь проверяются обе чистые части: cutOrderedWidthKeys и классификация.
//
// Run with: node experiments/atex-production-planning-4230.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var cutOrderedWidthKeys = planning.cutOrderedWidthKeys;

// ── A) cutOrderedWidthKeys: ширины обеспечиваемых позиций текущей резки ─────────────────────────
(function () {
    var genPositions = [
        { id: 'P1', width: 156 },
        { id: 'P2', width: 200 }
    ];
    var supplies = [
        { cutId: 'C1', positionId: 'P1' },   // заказная 156
        { cutId: 'C1', positionId: 'P2' },   // заказная 200
        { cutId: 'C2', positionId: 'P1' }    // ЧУЖАЯ резка — не учитываем
    ];
    var C1 = { id: 'C1' };
    var keys = cutOrderedWidthKeys(C1, supplies, genPositions);
    assert(keys['156'] === true && keys['200'] === true, 'A: ширины обеспечиваемых позиций 156 и 200 → заказные');
    assert(keys['30'] === undefined && keys['25'] === undefined, 'A: не обеспечиваемая ширина (30, 25) не заказная');
    assertEqual(Object.keys(keys).sort(), ['156', '200'], 'A: ровно две заказные ширины (чужая резка C2 отфильтрована)');
})();

// ── B) cutOrderedWidthKeys: фолбэк на supply.positionWidth (позиция вне активного списка, #4051) ──
(function () {
    var genPositions = [{ id: 'P3', width: 0 }];   // позиция есть, но ширина не пришла
    var supplies = [
        { cutId: 'C1', positionId: 'PX', positionWidth: 305 },   // позиции нет в списке → фолбэк 305
        { cutId: 'C1', positionId: 'P3', positionWidth: 128 }    // width пусто → фолбэк на positionWidth 128
    ];
    var keys = cutOrderedWidthKeys({ id: 'C1' }, supplies, genPositions);
    assert(keys['305'] === true, 'B: позиция вне активного списка → ширина из supply.positionWidth (305)');
    assert(keys['128'] === true, 'B: пустая ширина позиции → фолбэк supply.positionWidth (128)');
})();

// ── C) cutOrderedWidthKeys: защита от пустых входов ──────────────────────────────────────────────
(function () {
    assertEqual(cutOrderedWidthKeys(null, [{ cutId: 'C1', positionId: 'P1' }], []), {}, 'C: cut=null → {}');
    assertEqual(cutOrderedWidthKeys({ id: 'C1' }, null, []), {}, 'C: supplies=null → {}');
    assertEqual(cutOrderedWidthKeys({ id: 'C1' }, [], null), {}, 'C: пустые обеспечения → {}');
})();

// ── D) Классификация полосы карточки: Заказ / Склад / Отходы (как в renderQueue) ─────────────────
// Метаданные и строки «Максимального запаса» — как в #3391 (table/67113).
var maxStockMeta = {
    id: '67113', val: 'Максимальный запас', reqs: [
        { id: '67114', val: 'Вид сырья' },
        { id: '67115', val: 'Ширина, мм' },
        { id: '67116', val: 'Длина, м' },
        { id: '67117', val: 'Тип намотки' },
        { id: '67118', val: 'Диаметр втулки' },
        { id: '67119', val: 'Лидер' },
        { id: '67120', val: 'Примечание' }
    ]
};
var MW308 = '1100';
function stockRow(i, limit, width) {
    return { i: String(i), r: [String(limit), MW308 + ':MW', String(width), '300', 'OUT', '', '', ''] };
}

(function () {
    // Запас: 30 мм хранить можно (Склад), 25 мм нет (Отходы).
    var index = planning.buildMaxStockIndex([stockRow(1, 1740, 30)], maxStockMeta);
    var cut = { id: 'C1', materialId: MW308, length: 300, winding: 'OUT' };
    // Обеспечение только на 156 мм (заказная ширина). Полосы резки: 156 (заказ) + добор 30, 25.
    var supplies = [{ cutId: 'C1', positionId: 'P1' }];
    var genPositions = [{ id: 'P1', width: 156 }];
    var orderedKeys = cutOrderedWidthKeys(cut, supplies, genPositions);

    // Мини-повтор решения из renderQueue (для целых ширин nominal === факт, actualWidthIndex не нужен).
    function classify(width) {
        if (orderedKeys[String(width)]) return 'Заказ';
        return planning.stockStripPurpose(index, { material: cut.materialId, width: width, length: cut.length, winding: cut.winding });
    }
    assertEqual(classify(156), 'Заказ', 'D: 156 мм — обеспечивает позицию заказа → Заказ (срок, не красим)');
    assertEqual(classify(30), 'Склад', 'D: 30 мм — не в заказ, но в «Максимальном запасе» → Склад (красным)');
    assertEqual(classify(25), 'Отходы', 'D: 25 мм — не в заказ и не в запасе → Отходы (красным)');

    // Контроль: таблица «Максимальный запас» не настроена → не-заказная полоса «Склад» (прежнее
    // permissive-поведение stockStripPurpose), но всё равно НЕ «Заказ» → красится.
    var emptyIndex = planning.buildMaxStockIndex([], null);
    function classifyOff(width) {
        if (orderedKeys[String(width)]) return 'Заказ';
        return planning.stockStripPurpose(emptyIndex, { material: cut.materialId, width: width, length: cut.length, winding: cut.winding });
    }
    assertEqual(classifyOff(25), 'Склад', 'D контроль: таблица выключена → не-заказная 25 мм = Склад (permissive), но не Заказ');
    assertEqual(classifyOff(156), 'Заказ', 'D контроль: 156 мм остаётся Заказ независимо от таблицы');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
