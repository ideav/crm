// Unit tests for ideav/crm#3872 — втулочные полосы 110 мм используют уже заказанные
// позиции 110 мм (того же заказа), а не режутся «впустую».
//
// #3812 всегда дописывал втулочные полосы 110 мм синтетически (core:true, без позиции).
// #3872: дополнительные втулки 110 мм могут быть уже в заказе. При планировании носитель
// (риббон 55–57/63–64 мм, втулка 0.5″/110) ищет подходящие позиции заказа 110 мм (тот же
// заказ, то же сырьё/намотка/длина) и привязывает полосы к ним (реальное обеспечение на
// произведённое min(заказ, полосы×проходов), излишек в запас). Не нашлось — синтетика (#3812).
// Проходы по продукту: позиции 110 мм их НЕ увеличивают.
//
// Run with: node experiments/test-issue-3872-sleeve-core-strip-positions.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

// Носитель-профиль: втулка 0.5″/110, риббон 55–57 → 2 полосы 110.
var GROUP = { materialId: 'm1', windDir: 'OUT', windLength: 300, coreStripCount: 2, coreStripWidth: 110 };
// Позиция-«втулка 110 мм» того же сырья/намотки/длины (ширина = 110, своих полос нет).
function pos110(id, orderId, qty, over) {
    return Object.assign({ id: id, orderId: orderId, width: 110, qty: qty, materialId: 'm1', windDir: 'OUT',
        windLength: 300, producible: true, coreStripCount: 0, coreStripWidth: 0 }, over || {});
}

// ── isCoreStripFiller ──
assert(planning.isCoreStripFiller(pos110('f1', 'o1', 4), GROUP), 'isCoreStripFiller: 110 мм того же сырья/намотки/длины → да');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4, { width: 105 }), GROUP), 'isCoreStripFiller: ширина ≠ 110 → нет');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4, { materialId: 'm2' }), GROUP), 'isCoreStripFiller: другое сырьё → нет');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4, { windDir: 'IN' }), GROUP), 'isCoreStripFiller: другая намотка → нет');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4, { windLength: 250 }), GROUP), 'isCoreStripFiller: другая длина → нет');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4, { producible: false }), GROUP), 'isCoreStripFiller: непроизводимая → нет');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4, { coreStripCount: 2 }), GROUP), 'isCoreStripFiller: сама носитель (count>0) → нет');
assert(!planning.isCoreStripFiller(pos110('f', 'o1', 4), { materialId: 'm1', windDir: 'OUT', windLength: 300, coreStripCount: 0, coreStripWidth: 0 }),
    'isCoreStripFiller: профиль без втулочных полос → нет');

// ── selectCoreStripFillers: тот же заказ, без повторного захвата ──
(function() {
    var unsup = [pos110('f1', 'o1', 4), pos110('f2', 'o2', 4), pos110('f3', 'o1', 2)];
    var claimed = {};
    // Раскладка покрывает только заказ o1 → берёт f1 и f3 (o1), не f2 (o2).
    var picked = planning.selectCoreStripFillers(unsup, GROUP, { o1: true }, claimed);
    assertEqual(picked, ['f1', 'f3'], 'selectCoreStripFillers: только позиции 110 покрытого заказа o1');
    assertEqual(claimed, { f1: true, f3: true }, 'selectCoreStripFillers: захваченные помечены в claimed');
    // Повторный вызов на тот же claimed для заказа o1 — пусто (уже забраны).
    assertEqual(planning.selectCoreStripFillers(unsup, GROUP, { o1: true }, claimed), [],
        'selectCoreStripFillers: повторно те же не забираются');
    // Заказ o2 → f2.
    assertEqual(planning.selectCoreStripFillers(unsup, GROUP, { o2: true }, claimed), ['f2'],
        'selectCoreStripFillers: заказ o2 → f2');
})();

// ── appendCoreStrip с привязкой к позициям: полоса несёт positionIds, позиции покрыты ──
(function() {
    var lay = { strips: [{ width: 55, qty: 12, purpose: 'Заказ', positionIds: ['p1'] }], positionsCovered: ['p1'] };
    planning.appendCoreStrip(lay, 110, 2, ['f1', 'f3']);
    var core = lay.strips.filter(function(s) { return s.core; })[0];
    assertEqual({ width: core.width, qty: core.qty, core: core.core, positionIds: core.positionIds },
        { width: 110, qty: 2, core: true, positionIds: ['f1', 'f3'] }, 'appendCoreStrip: полоса 110×2 несёт positionIds, core:true');
    assertEqual(lay.positionsCovered, ['p1', 'f1', 'f3'], 'appendCoreStrip: позиции 110 добавлены в positionsCovered');
    // Идемпотентно: повтор не двоит полосу и не дублирует покрытие.
    planning.appendCoreStrip(lay, 110, 2, ['f1', 'f3']);
    assertEqual(lay.strips.filter(function(s) { return s.core; }).length, 1, 'appendCoreStrip: идемпотентно (одна полоса 110)');
    assertEqual(lay.positionsCovered, ['p1', 'f1', 'f3'], 'appendCoreStrip: покрытие не дублируется');
    // Без filler ids — синтетика (#3812): positionIds пуст, покрытие не трогаем.
    var lay2 = { strips: [{ width: 55, qty: 12, purpose: 'Заказ', positionIds: ['p1'] }], positionsCovered: ['p1'] };
    planning.appendCoreStrip(lay2, 110, 2);
    assertEqual(lay2.strips.filter(function(s) { return s.core; })[0].positionIds, [], 'appendCoreStrip: без позиций — синтетика (positionIds [])');
    assertEqual(lay2.positionsCovered, ['p1'], 'appendCoreStrip: без позиций — покрытие не меняется');
})();

// ── Проходы по продукту: позиция 110 мм НЕ увеличивает число проходов ──
(function() {
    // Раскрой: продукт 55×12 (заказ 24 рулона → 2 прохода) + полоса 110×2 (позиция f1, заказ 100).
    var lay = { strips: [
        { width: 55, qty: 12, purpose: 'Заказ', positionIds: ['p1'] },
        { width: 110, qty: 2, purpose: 'Заказ', core: true, positionIds: ['f1'] }
    ], positionsCovered: ['p1', 'f1'] };
    var positions = [{ id: 'p1', width: 55, qty: 24 }, { id: 'f1', width: 110, qty: 100 }];
    assertEqual(planning.coreOnlyStripWidths(lay), { '110': true }, 'coreOnlyStripWidths: 110 — только из втулочных полос');
    assertEqual(planning.plannedRunsForLayout(lay, positions), 2,
        'plannedRunsForLayout: проходы по продукту (24/12=2); заказ 110 мм (100) их НЕ увеличивает');
})();

// ── Обеспечение позиции 110 мм = min(заказ, полосы×проходов); излишек в запас ──
(function() {
    var lay = { strips: [
        { width: 55, qty: 12, purpose: 'Заказ', positionIds: ['p1'] },
        { width: 110, qty: 2, purpose: 'Заказ', core: true, positionIds: ['f1'] }
    ], positionsCovered: ['p1', 'f1'] };
    var runs = 2;   // по продукту
    // Заказ 110 = 3 ≤ выпуск 2×2=4 → обеспечиваем 3, излишек 1 в запас.
    var supplyShort = planning.supplyRollsForPosition(lay, { id: 'f1', width: 110, qty: 3 }, runs);
    assertEqual(supplyShort, 3, 'supplyRollsForPosition: заказ 110=3 ≤ выпуск 4 → обеспечено 3');
    // Заказ 110 = 10 > выпуск 4 → обеспечиваем только 4 (недостаток игнорируем — ошибка менеджера).
    var supplyLong = planning.supplyRollsForPosition(lay, { id: 'f1', width: 110, qty: 10 }, runs);
    assertEqual(supplyLong, 4, 'supplyRollsForPosition: заказ 110=10 > выпуск 4 → обеспечено 4 (недостаток игнорируем)');

    // «Партия ГП» содержит и продукт 55, и полосу 110; обеспечение покрывает обе позиции.
    var batches = planning.producedBatchesForLayout(lay, 1000);
    assertEqual(batches, [{ width: 55, strips: 12, length: 1000 }, { width: 110, strips: 2, length: 1000 }],
        'producedBatchesForLayout: 55×12 + 110×2');
    var plan = planning.supplyPlanForLayout(lay, [{ id: 'p1', width: 55, qty: 24, length: 1000 }, { id: 'f1', width: 110, qty: 3, length: 1000 }], runs);
    assertEqual(plan.map(function(s) { return s.positionId + ':' + s.width + 'x' + s.rolls; }), ['p1:55x24', 'f1:110x3'],
        'supplyPlanForLayout: обеспечения для продукта 55 (24) и позиции 110 (3)');
})();

console.log('\n' + passed + ' проверок прошло' + (failed ? ', ' + failed + ' упало' : '') + '.');
if (!failed) console.log('Все проверки #3872 зелёные.');
