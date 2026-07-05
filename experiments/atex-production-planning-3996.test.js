// Tests for ideav/crm#3996 — «количество полос не по убыванию».
//
// Симптом (скрин очереди, всё сырьё MR194 OUT): число полос шло 22,22,22,44,29,29,29 — то есть
// ПОДНИМАЛОСЬ (22→44), хотя по ТЗ §8 доставить ножи (полос стало больше, KNIVES_INCREASE=50)
// заметно дороже, чем снять (KNIVES_CHANGE=30).
//
// Причина: движок очереди (greedySequence) выбирал порядок по ФИЗИЧЕСКОЙ стоимости переналадки
// (changeoverCost), где смена ножей — плоские 30 мин в ЛЮБУЮ сторону (#3600). Из-за этого убывающая
// и возрастающая цепочки полос стоили ОДИНАКОВО, а убывание держалось лишь вторичным тай-брейком
// (knifeDescSeq, #3130): он работает только среди РАВНЫХ по стоимости цепочек и только в полном
// мультистарт-переборе, поэтому сбивался разницей по сырью/партии, не действовал на одиночном старте
// (очередь > 60) и не поправлял уже сохранённый план.
//
// Фикс #3996: для ВЫБОРА ПОРЯДКА добавлена направленная стоимость (sequencingCost) — к физической
// переналадке прибавляется штраф за РОСТ числа полос = planWeight(INCREASE) − planWeight(CHANGE)
// (веса #3991, ТЗ §14). Убывание полос стало СТРОГО дешевле возрастания, а не тай-брейком. Физический
// тайминг (changeoverParts/setupBreakdown → «Наладка ножей, мин») НЕ тронут: реальная наладка ножей
// осталась фиксированной (30 мин в обе стороны). Во время выравнивания загрузки штраф отключён
// (balanceFastChangeover, #3871) — там нужна скорость, а финальный порядок всё равно собирает orderCuts.
//
// Run with: node experiments/atex-production-planning-3996.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) passed++;
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}
function assert(cond, name) { assertEqual(!!cond, true, name); }

function widths(w, n) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
function cut(id, kc, w, mat, batch) {
    return { id: id, materialId: mat || 'MR194', winding: 'OUT', batchId: batch || 'b1',
        knifeCount: kc, knifeWidths: widths(w, kc), rollerWidth: 880, isFoil: false };
}
function counts(seq) { return seq.map(function (c) { return c.knifeCount; }); }
function isNonIncreasing(arr) { for (var i = 1; i < arr.length; i++) { if (arr[i] > arr[i - 1]) return false; } return true; }

// ── 1) Сценарий скрина: одно сырьё, конфигурации ножей 22 / 44 / 29 → строго по УБЫВАНИЮ полос ──
(function () {
    var screen = [cut('c3', 22, 40), cut('c4', 22, 40), cut('c5', 22, 40),
                  cut('c6', 44, 20), cut('c7', 29, 30), cut('c8', 29, 30), cut('c9', 29, 30)];
    var order = counts(planning.orderCuts(screen, {}));
    assertEqual(order, [44, 29, 29, 29, 22, 22, 22],
        '#3996 скрин: полосы по убыванию 44>29>22 (было 22,22,22,44,29,29,29)');
    assert(isNonIncreasing(order), '#3996 скрин: число полос не растёт по очереди');
})();

// ── 2) Разные партии одного сырья НЕ сбивают убывание (штраф, а не хрупкий тай-брейк) ──
(function () {
    var mixed = [cut('a1', 22, 40, 'MR194', 'bA'), cut('a2', 22, 40, 'MR194', 'bA'),
                 cut('b1', 44, 20, 'MR194', 'bB'), cut('c1', 29, 30, 'MR194', 'bC'), cut('c2', 29, 30, 'MR194', 'bC')];
    assert(isNonIncreasing(counts(planning.orderCuts(mixed, {}))),
        '#3996 разные партии: полосы всё равно по убыванию');
})();

// ── 3) Детерминизм: обратный вход даёт тот же убывающий порядок (порядок задаёт стоимость, не вход) ──
(function () {
    var screen = [cut('c3', 22, 40), cut('c4', 22, 40), cut('c5', 22, 40),
                  cut('c6', 44, 20), cut('c7', 29, 30), cut('c8', 29, 30), cut('c9', 29, 30)];
    var forward = counts(planning.orderCuts(screen, {}));
    var reversed = counts(planning.orderCuts(screen.slice().reverse(), {}));
    assertEqual(reversed, forward, '#3996 порядок не зависит от входного порядка резок');
})();

// ── 4) Большая очередь (> 60 → одиночный старт greedyFromStart, мультистарт-тай-брейк выключен) ──
(function () {
    var big = [];
    for (var i = 0; i < 24; i++) { big.push(cut('x' + i, 22, 40), cut('y' + i, 29, 30), cut('z' + i, 44, 20)); }
    assert(big.length > 60, '#3996 очередь действительно > 60 (одиночный старт)');
    assert(isNonIncreasing(counts(planning.orderCuts(big, {}))),
        '#3996 очередь > 60: полосы по убыванию (штраф работает и на одиночном старте)');
})();

// ── 5) Физический тайминг НЕ раздут: смена ножей в ЛЮБУЮ сторону = фикс. 30 мин ──
//     Штраф KNIVES_INCREASE живёт ТОЛЬКО в выборе порядка, а не в «Наладка ножей, мин».
(function () {
    var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15 };
    var up = planning.changeoverCost(cut('p', 22, 40), cut('q', 44, 20), TIMES);   // полос стало больше
    var down = planning.changeoverCost(cut('p', 44, 20), cut('q', 22, 40), TIMES); // полос стало меньше
    assertEqual([up, down], [30, 30],
        '#3996 changeoverCost (реальная наладка): плоские 30 в обе стороны — тайминг не раздут');
})();

// ── 6) Инвариант #3717 сохранён: фольга в конце, не-фольга внутри — по убыванию ──
(function () {
    var withFoil = [cut('f1', 10, 50), cut('n1', 22, 40), cut('n2', 44, 20)];
    withFoil[0].isFoil = true;
    var ord = planning.orderCuts(withFoil, {});
    assertEqual(ord[ord.length - 1].id, 'f1', '#3996/#3717: фольга остаётся в конце дня');
    assert(isNonIncreasing(counts(ord.filter(function (c) { return !c.isFoil; }))),
        '#3996: не-фольга по убыванию, фольга не ломает правило');
})();

console.log('\n' + passed + ' assertions passed');
