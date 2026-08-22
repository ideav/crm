// #4804 — правки «Расчёта оптимальной резки» (templates/atex/cut-optimizer.html):
//   1. вместо одного поля «Диаметр втулки» — ДИАМЕТР (1″ / 0,5″) и МАТЕРИАЛ втулки
//      (справочник table/740264). 0,5″ материала не спрашивает — всегда картон.
//      Конкретная запись справочника «Диаметр втулки» (8188) подбирается под ширину
//      полосы: точное совпадение «Ширина втулки, мм» → «метровая» запись (ширина
//      пустая, режется под размер) → нет подходящей;
//   2. карта раскроя ОДНА, со всеми ширинами: «Карта 1»/«Карта 2» больше не бывает;
//   3. по кнопке «Рассчитать» ножи ДОБИВАЮТСЯ сверх заданного так, чтобы отход был
//      минимальным. Приоритет — целые пропорциональные наборы, остаток добивается
//      любыми ширинами. Выпуск не может быть меньше заданного;
//   4. заданный набор шире джамбо → количества УМЕНЬШАЮТСЯ, чтобы влезть в ширину,
//      а не объявляются нерезабельными.
//
// Run with: node experiments/atex-cut-optimizer-4804.test.js

var core = require('../download/atex/js/cut-optimizer.js').core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}
// Ножи карты по ширинам — как их видит пользователь на рисунке раскроя.
function knivesOf(plan) {
    var m = (plan.maps || [])[0];
    if (!m) return [];
    return m.pattern.slice().sort(function(a, b) { return b.width - a.width; })
        .map(function(s) { return s.width + '×' + s.knives; });
}

// ── п.2: карта всегда ОДНА ────────────────────────────────────────────────────────────────────
(function() {
    // Три ширины, которые прежде раскладывались на две карты.
    var p = core.computePlan(880, [{ width: 60, qty: 14 }, { width: 40, qty: 1 }, { width: 100, qty: 4 }]);
    assertEqual(p.mapCount, 1, '#4804 п.2: три ширины — всё равно одна карта');
    assertEqual(p.maps.length, 1, '#4804 п.2: в плане ровно одна карта раскроя');
    var widthsOnMap = p.maps[0].pattern.map(function(s) { return s.width; }).sort(function(a, b) { return a - b; });
    assertEqual(widthsOnMap, [40, 60, 100], '#4804 п.2: все ширины лежат на одной карте');

    // Даже при потолке карт из опций больше одной не бывает.
    var p2 = core.computePlan(2000, [
        { width: 100, qty: 1 }, { width: 200, qty: 1 }, { width: 300, qty: 1 }, { width: 400, qty: 1 }
    ], { maxMaps: 3 });
    assertEqual(p2.mapCount, 1, '#4804 п.2: options.maxMaps карту не размножает');
})();

// ── п.3: добивка до минимального отхода ───────────────────────────────────────────────────────
(function() {
    // Пример из тикета: 60×5 и 50×10 на джамбо 910.
    // Пропорция 1:2 (набор 160 мм) укладывается 5 раз = 5×60 + 10×50 = 800 мм, остаток 110.
    // Остаток добивается 60+50 → 6×60 + 11×50 = 910 мм, отход 0.
    var p = core.computePlan(910, [{ width: 60, qty: 5 }, { width: 50, qty: 10 }]);
    assertEqual(p.totalWasteWidth, 0, '#4804 п.3: остаток джамбо добит — отход 0');
    assertEqual(knivesOf(p), ['60×6', '50×11'], '#4804 п.3: добивка дала 6×60 + 11×50');
    assertEqual(p.maps[0].usedWidth, 910, '#4804 п.3: занята вся ширина входа');

    // Выпуск не меньше заданного — по КАЖДОЙ ширине.
    var notLess = p.results.every(function(r) { return r.produced >= r.desiredQty; });
    assert(notLess, '#4804 п.3: выпуск не меньше заданного ни по одной ширине');

    // Вариант ровно один — «самый лучший с точки зрения отхода».
    assertEqual(p.maps.length, 1, '#4804 п.3: показан один вариант, а не список');
})();

(function() {
    // Приоритет пропорции: целый набор кладётся раньше, чем «просто что влезет».
    // 100×1 и 50×2 на 800: набор 100+2×50 = 200 мм ложится 4 раза ровно → 4×100 + 8×50.
    var p = core.computePlan(800, [{ width: 100, qty: 1 }, { width: 50, qty: 2 }]);
    assertEqual(p.totalWasteWidth, 0, '#4804 п.3: пропорциональный набор закрыл джамбо без отхода');
    assertEqual(knivesOf(p), ['100×4', '50×8'], '#4804 п.3: пропорция 1:2 сохранена при добивке');
})();

(function() {
    // Добивка не обязана быть пропорциональной, если так меньше отход.
    // 70×1 на 300: 4×70 = 280, остаток 20 — добить нечем, отход 20.
    var p = core.computePlan(300, [{ width: 70, qty: 1 }]);
    assertEqual(p.totalWasteWidth, 20, '#4804 п.3: добить нечем — отход остаётся, план не ломается');
    assertEqual(knivesOf(p), ['70×4'], '#4804 п.3: одна ширина набивается до упора');
})();

// ── п.4: не влезло → уменьшаем количества ─────────────────────────────────────────────────────
(function() {
    // Заданный набор шире джамбо: 60×1 + 50×10 = 560 мм при входе 500.
    var p = core.computePlan(500, [{ width: 60, qty: 1 }, { width: 50, qty: 10 }]);
    assert(p.feasible, '#4804 п.4: набор шире джамбо — план всё равно считается');
    var m = p.maps[0];
    assert(!!m, '#4804 п.4: карта построена');
    assert(m.usedWidth <= 500, '#4804 п.4: занятая ширина укладывается в джамбо');
    assert(m.fits, '#4804 п.4: карта помечена резабельной — количества уменьшены под ширину');
    // Ни одна ширина не потеряна.
    var allCut = p.results.every(function(r) { return r.produced > 0; });
    assert(allCut, '#4804 п.4: обе ширины остались в раскрое');
    // Уменьшение видно как признак «пропорцию сохранить не удалось».
    assertEqual(p.proportionKept, false, '#4804 п.4: план сообщает, что пропорция не сохранена');
})();

(function() {
    // Даже по одному ножу на ширину не влезает — это честная невозможность.
    var p = core.computePlan(100, [{ width: 60, qty: 1 }, { width: 50, qty: 1 }]);
    assert(!!p.reason, '#4804 п.4: по ножу на ширину не влезает — план называет причину');
    var m = (p.maps || [])[0];
    if (m) assert(m.usedWidth <= 100, '#4804 п.4: и в этом случае карта не шире джамбо');
})();

// ── п.1: диаметр + материал → запись справочника «Диаметр втулки» ─────────────────────────────
// Боевые записи ateh (table 8188): «Дюймы», «Ширина втулки, мм», «Материал втулки» (→ 740264).
var SLEEVES = [
    { id: '8189',   label: 'Втулка картонная 0.5" ширина 57 мм',        inches: 0.5, sleeveWidth: 57,   materialId: '740267', materialLabel: 'Картон' },
    { id: '35561',  label: 'Втулка картонная 0.5" ширина 110 мм',       inches: 0.5, sleeveWidth: 110,  materialId: '740267', materialLabel: 'Картон' },
    { id: '8190',   label: 'Втулка картонная 1" длина 1 метр',          inches: 1,   sleeveWidth: null, materialId: '740267', materialLabel: 'Картон' },
    { id: '35565',  label: 'Втулка пластиковая фиолетовая 1" ш. 110 мм', inches: 1,  sleeveWidth: 110,  materialId: '740273', materialLabel: 'Пластик фиолетовая' },
    { id: '104601', label: 'Втулка пластиковая фиолетовая 1" ш. 55 мм',  inches: 1,  sleeveWidth: 55,   materialId: '740273', materialLabel: 'Пластик фиолетовая' },
    { id: '35562',  label: 'Втулка пластиковая PPC-CORES чёрная 1"',     inches: 1,  sleeveWidth: null, materialId: '740269', materialLabel: 'Пластик чёрная' }
];

assertEqual(core.CARDBOARD_LABEL, 'Картон',
    '#4804 п.1: материал 0,5″ — картон (подпись, по которой он ищется в справочнике)');

assertEqual(core.sleeveInchesOptions().map(function(o) { return o.value; }), ['1', '0.5'],
    '#4804 п.1: диаметр выбирается из двух значений — 1″ и 0,5″');

assert(core.sleeveNeedsMaterial('1') === true,
    '#4804 п.1: у 1″ материал втулки спрашиваем');
assert(core.sleeveNeedsMaterial('0.5') === false,
    '#4804 п.1: у 0,5″ материал не спрашиваем — он всегда картон');

// Точное совпадение по ширине втулки.
assertEqual((core.resolveSleeve(SLEEVES, { inches: '1', materialId: '740273', width: 55 }) || {}).id, '104601',
    '#4804 п.1: 1″ + фиолетовый пластик, полоса 55 мм → готовая втулка на 55');
assertEqual((core.resolveSleeve(SLEEVES, { inches: '1', materialId: '740273', width: 110 }) || {}).id, '35565',
    '#4804 п.1: та же пара, полоса 110 мм → готовая втулка на 110');

// Готовой под эту ширину нет — берём «метровую» (ширина пустая, режется под размер).
assertEqual((core.resolveSleeve(SLEEVES, { inches: '1', materialId: '740267', width: 55 }) || {}).id, '8190',
    '#4804 п.1: 1″ + картон, полоса 55 мм → метровая картонная (режется под размер)');
assertEqual((core.resolveSleeve(SLEEVES, { inches: '1', materialId: '740269', width: 33 }) || {}).id, '35562',
    '#4804 п.1: 1″ + чёрный пластик → метровая, готовой на 33 мм нет');

// 0,5″ материал не спрашивает — картон подставляется сам.
assertEqual((core.resolveSleeve(SLEEVES, { inches: '0.5', width: 110 }) || {}).id, '35561',
    '#4804 п.1: 0,5″ без материала → картонная 0.5″ на 110 мм');
assertEqual((core.resolveSleeve(SLEEVES, { inches: '0.5', materialId: '740273', width: 57 }) || {}).id, '8189',
    '#4804 п.1: 0,5″ игнорирует переданный материал — всегда картон');

// Ничего не подходит — молча чужую втулку не подставляем.
assertEqual(core.resolveSleeve(SLEEVES, { inches: '0.5', width: 33 }), null,
    '#4804 п.1: готовой 0,5″ на 33 мм нет и метровой 0,5″ нет → втулка не подобрана');
assertEqual(core.resolveSleeve(SLEEVES, { inches: '', width: 55 }), null,
    '#4804 п.1: диаметр не выбран → втулка не подобрана');

// Отбор точек запаса идёт по паре «диаметр + материал», а не по конкретной записи.
assert(core.sleeveMatchesChoice(SLEEVES[3], { inches: '1', materialId: '740273' }) === true,
    '#4804 п.1: точка запаса с фиолетовой 1″ подходит выбору «1″ + фиолетовый»');
assert(core.sleeveMatchesChoice(SLEEVES[2], { inches: '1', materialId: '740273' }) === false,
    '#4804 п.1: картонная 1″ выбору «1″ + фиолетовый» не подходит');
assert(core.sleeveMatchesChoice(SLEEVES[0], { inches: '0.5' }) === true,
    '#4804 п.1: у 0,5″ материал не сравниваем — подходит любая картонная 0,5″');
assert(core.sleeveMatchesChoice(SLEEVES[3], { inches: '' }) === true,
    '#4804 п.1: диаметр не выбран — точки запаса не фильтруем');

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exitCode = 1;
