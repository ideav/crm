// #4957 — «Расчёт оптимальной резки» (templates/atex/cut-optimizer.html) учитывает
// особенности втулки 0,5″, описанные в Планировщике (#3812):
//   • риббон у́же 55 мм на втулке 0,5″ НЕ производится — такая ширина выбывает из расчёта;
//   • при ширине втулки 110 мм в резку добавляются полосы 110 мм: продуктовая ширина
//     55–57 мм → 2 полосы, 63–64 мм → 1 полоса, прочие (58–62, 65–70, > 70) — ни одной.
//     Полосы занимают ширину джамбо ТОЙ ЖЕ резки (резервируются до укладки продукта);
//   • ширина 110 мм, заданная в желаемых рулонах, обеспечивается этими же полосами и не
//     режется сверх них (#3872);
//   • диаметр втулки участвует в резолве фактической ширины — правила «s=…» справочника
//     «Фактическая ширина резки» больше не пропускаются;
//   • точки запаса у́же 55 мм при втулке 0,5″ не предлагаются.
//
// Правила и числа — те же, что в планировании
// (download/atex/js/production-planning/10-planning-engine.js, sleeveCoreStripPlan /
// isSleeveWidthProducible; docs/atex_production_planning_algorithm.md, «Шаг 2.0»).
//
// Run with: node experiments/atex-cut-optimizer-4957-sleeve.test.js

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
var HALF = { inches: '0.5', widthMm: 110 };          // втулка 0,5″ шириной 110 мм
var HALF_57 = { inches: '0.5', widthMm: 57 };        // втулка 0,5″ шириной 57 мм

// ── Правило «у́же 55 мм на 0,5″ не производится» ───────────────────────────────────────
(function() {
    // Общий вид правила: таблица «диаметр × ширина» целиком, а не один случай.
    [
        ['0.5', 40, false], ['0.5', 54, false], ['0.5', 54.9, false],
        ['0.5', 55, true], ['0.5', 57, true], ['0.5', 110, true],
        ['1', 40, true], ['1', 54, true],
        ['', 40, true], [null, 40, true]              // диаметр не выбран — не ограничиваем
    ].forEach(function(row) {
        assertEqual(core.isSleeveWidthProducible(row[0], row[1]), row[2],
            '#4957: втулка ' + row[0] + '″, ширина ' + row[1] + ' мм → производима=' + row[2]);
    });

    // Единственная ширина непроизводима — плана нет, причина названа.
    var p = core.computePlan(891, [{ width: 50, qty: 10 }], { sleeve: HALF });
    assertEqual(p.feasible, false, '#4957: 50 мм на втулке 0,5″ — плана нет');
    assert(/55/.test(p.reason), '#4957: причина называет порог 55 мм');
    assertEqual(p.notProducible.map(function(it) { return it.width; }), [50],
        '#4957: непроизводимая ширина названа в notProducible');

    // Часть ширин непроизводима — режем остальные, выбывшие названы.
    var mix = core.computePlan(891, [{ width: 50, qty: 10 }, { width: 80, qty: 10 }], { sleeve: HALF });
    assertEqual(mix.feasible, true, '#4957: производимая ширина рядом с непроизводимой — план есть');
    assertEqual(mix.results.map(function(r) { return r.actualWidth; }), [80],
        '#4957: в плане только производимая ширина');
    assertEqual(mix.notProducible.map(function(it) { return it.width; }), [50],
        '#4957: выбывшая ширина названа');

    // Без втулки (диаметр не выбран) правило не действует — прежнее поведение.
    var old = core.computePlan(891, [{ width: 50, qty: 10 }]);
    assertEqual(old.feasible, true, '#4957: без выбранной втулки 50 мм режется как раньше');
    assertEqual(old.notProducible, [], '#4957: без втулки выбывших ширин нет');
    // Втулка 1″ ширину не ограничивает.
    var inch = core.computePlan(891, [{ width: 50, qty: 10 }], { sleeve: { inches: '1' } });
    assertEqual(inch.feasible, true, '#4957: на втулке 1″ 50 мм режется');
})();

// ── Втулочные полосы 110 мм: сколько их по диапазонам ────────────────────────────────
(function() {
    // Правило целиком: диапазон номинальной ширины → число полос 110 мм.
    [
        [55, 2], [56, 2], [57, 2],
        [58, 0], [60, 0], [62, 0],
        [63, 1], [64, 1],
        [65, 0], [70, 0], [71, 0], [100, 0]           // > 70 — по обычному правилу втулки 1″
    ].forEach(function(row) {
        assertEqual(core.sleeveCoreStripPlan('0.5', 110, [row[0]]).count, row[1],
            '#4957: ширина ' + row[0] + ' мм при втулке 0,5″/110 → полос ' + row[1]);
    });
    // Втулка 57 мм полос не даёт вовсе, диаметр 1″ — тоже.
    assertEqual(core.sleeveCoreStripPlan('0.5', 57, [55]).count, 0, '#4957: втулка 0,5″/57 — полос нет');
    assertEqual(core.sleeveCoreStripPlan('1', 110, [55]).count, 0, '#4957: втулка 1″ — полос нет');
    assertEqual(core.sleeveCoreStripPlan('', 110, [55]).count, 0, '#4957: диаметр не выбран — полос нет');
})();

// ── Полосы 110 мм занимают ширину джамбо той же резки ────────────────────────────────
(function() {
    // Пример из тикета #3812: 55 мм → 55×12 + 110×2 (джамбо 891).
    var p = core.computePlan(891, [{ width: 55, qty: 12 }], { sleeve: HALF });
    assertEqual(p.feasible, true, '#4957: 55 мм на втулке 0,5″/110 — план есть');
    assertEqual(knivesOf(p), ['110×2', '55×12'], '#4957: раскрой 55×12 + 110×2 (пример тикета)');
    assertEqual(p.coreStrip.count, 2, '#4957: в плане две втулочные полосы');
    assertEqual(p.coreStrip.width, 110, '#4957: ширина втулочной полосы — 110 мм');
    assertEqual(p.maps[0].usedWidth, 880, '#4957: занято 12×55 + 2×110 = 880 мм');
    assertEqual(p.maps[0].trimWidth, 11, '#4957: отход 891 − 880 = 11 мм');
    assertEqual(p.maps[0].knivesTotal, 14, '#4957: полос за резку — 12 продуктовых + 2 втулочных');
    // Полосы помечены в раскрое, чтобы рисунок и легенда отличали их от продукта.
    var coreSeg = p.maps[0].segments.filter(function(s) { return s.core; });
    assertEqual(coreSeg.length, 2, '#4957: на рисунке два втулочных сегмента');
    assertEqual(coreSeg.map(function(s) { return s.width; }), [110, 110], '#4957: сегменты шириной 110 мм');

    // Пример из тикета #3812: 64 мм → 64×12 + 110×1.
    var q = core.computePlan(891, [{ width: 64, qty: 12 }], { sleeve: HALF });
    assertEqual(knivesOf(q), ['110×1', '64×12'], '#4957: раскрой 64×12 + 110×1 (пример тикета)');
    assertEqual(q.maps[0].usedWidth, 878, '#4957: занято 12×64 + 110 = 878 мм');
    assertEqual(q.maps[0].trimWidth, 13, '#4957: отход 891 − 878 = 13 мм');

    // Без полос (ширина вне диапазонов) джамбо занято продуктом целиком — контроль.
    var r = core.computePlan(891, [{ width: 60, qty: 12 }], { sleeve: HALF });
    assertEqual(r.coreStrip.count, 0, '#4957: 60 мм — втулочных полос нет');
    assertEqual(knivesOf(r), ['60×14'], '#4957: 60 мм — весь джамбо под продукт (14 ножей)');

    // Втулка 57 мм: то же задание режется без втулочных полос.
    var s = core.computePlan(891, [{ width: 55, qty: 12 }], { sleeve: HALF_57 });
    assertEqual(s.coreStrip.count, 0, '#4957: втулка 57 мм — полос нет');
    assertEqual(knivesOf(s), ['55×16'], '#4957: втулка 57 мм — джамбо под продукт (16 ножей)');
})();

// ── Заказанные 110 мм обеспечиваются теми же полосами (#3872) ────────────────────────
(function() {
    var p = core.computePlan(891, [{ width: 55, qty: 12 }, { width: 110, qty: 2 }], { sleeve: HALF });
    assertEqual(knivesOf(p), ['110×2', '55×12'], '#4957/#3872: 110 мм не режется сверх втулочных полос');
    assertEqual(p.coreStrip.count, 2, '#4957/#3872: полос по-прежнему две');
    var by = {};
    p.results.forEach(function(r) { by[r.actualWidth] = r; });
    assertEqual(by[110].desiredQty, 2, '#4957/#3872: заказанные 110 мм остались в таблице');
    assertEqual(by[110].produced, 2, '#4957/#3872: заказанные 110 мм обеспечены полосами');
    assertEqual(by[110].core, true, '#4957/#3872: строка 110 мм помечена как втулочная');
    assertEqual(by[55].produced, 12, '#4957/#3872: продукт обеспечен полностью');
})();

// ── Ширины из разных диапазонов в одной карте ────────────────────────────────────────
(function() {
    // В планировании такие позиции расходятся по разным резкам (число втулочных полос —
    // измерение профиля), а калькулятор кладёт все ширины на одну карту. Полос не
    // добавляем и говорим об этом прямо.
    var p = core.computePlan(891, [{ width: 55, qty: 6 }, { width: 63, qty: 6 }], { sleeve: HALF });
    assertEqual(p.coreStrip.count, 0, '#4957: ширины разных диапазонов — полос не добавляем');
    assertEqual(p.coreStrip.mixed, true, '#4957: смешение диапазонов помечено');
    var q = core.computePlan(891, [{ width: 55, qty: 6 }, { width: 57, qty: 6 }], { sleeve: HALF });
    assertEqual(q.coreStrip.mixed, false, '#4957: ширины одного диапазона смешением не считаются');
    assertEqual(q.coreStrip.count, 2, '#4957: ширины одного диапазона — две полосы на обе');
})();

// ── Диаметр втулки в резолве фактической ширины (правила «s=…») ──────────────────────
(function() {
    var index = core.buildActualWidthIndex([
        { actual: 56, order: 57, code: 's=0.5' },
        { actual: 59, order: 60, code: '' }
    ]);
    var p = core.computePlan(891, [{ width: 57, qty: 4 }], { actualWidthIndex: index, sleeve: HALF_57 });
    assertEqual(p.results[0].actualWidth, 56, '#4957: правило s=0.5 применяется — факт. ширина 56 мм');
    var q = core.computePlan(891, [{ width: 57, qty: 4 }], { actualWidthIndex: index });
    assertEqual(q.results[0].actualWidth, 57, '#4957: втулка не выбрана — правило s=0.5 не применяется');
    var r = core.computePlan(891, [{ width: 60, qty: 4 }], { actualWidthIndex: index, sleeve: HALF_57 });
    assertEqual(r.results[0].actualWidth, 59, '#4957: безусловные правила работают как раньше');

    // Диапазон полос считается по НОМИНАЛУ (57), а режется факт. ширина 56.
    var s = core.computePlan(891, [{ width: 57, qty: 4 }], { actualWidthIndex: index, sleeve: HALF });
    assertEqual(s.coreStrip.count, 2, '#4957: диапазон полос — по номинальной ширине 57 мм');
    assertEqual(knivesOf(s), ['110×2', '56×11'], '#4957: режется факт. ширина 56 мм');
})();

// ── Ширина втулки: варианты из справочника ───────────────────────────────────────────
(function() {
    var sleeves = [
        { id: '401', label: 'Втулка картонная 1" длина 1 метр', inches: 1, sleeveWidth: null, materialLabel: 'Картон' },
        { id: '402', label: 'Втулка картонная 0.5" ширина 110 мм', inches: 0.5, sleeveWidth: 110, materialLabel: 'Картон' },
        // Реквизит «Ширина втулки, мм» не заполнен — ширина берётся из НАЗВАНИЯ записи.
        { id: '405', label: 'Втулка картонная 0.5" ширина 57 мм', inches: 0.5, sleeveWidth: null, materialLabel: 'Картон' },
        { id: '406', label: 'Втулка картонная 0.5" ширина 110 мм (вторая)', inches: 0.5, sleeveWidth: 110, materialLabel: 'Картон' },
        { id: '407', label: 'Втулка картонная 0.5" метровая', inches: 0.5, sleeveWidth: null, materialLabel: 'Картон' }
    ];
    assertEqual(core.sleeveWidthOptions(sleeves, '0.5'), [57, 110],
        '#4957: ширины втулки 0,5″ — 57 и 110, без дублей и метровой палки');
    assertEqual(core.sleeveWidthOptions(sleeves, '1'), [],
        '#4957: у 1″ готовых ширин в справочнике нет');
    assertEqual(core.sleeveWidthOptions(sleeves, ''), [],
        '#4957: диаметр не выбран — вариантов нет');
    assertEqual(core.parseSleeveWidthFromName('Втулка картонная 0.5" ширина 110 мм'), 110,
        '#4957: ширина втулки читается из названия записи');
    assertEqual(core.parseSleeveWidthFromName('Втулка картонная 1" длина 1 метр'), null,
        '#4957: в названии метровой втулки ширины нет');
})();

// ── Точки запаса: у́же 55 мм при 0,5″ не предлагаются ────────────────────────────────
(function() {
    var sleeveById = {
        '402': { id: '402', label: 'Втулка картонная 0.5" ширина 110 мм', inches: 0.5, sleeveWidth: 110, materialLabel: 'Картон' }
    };
    var points = [
        { width: 50, limit: 10, sleeve: { id: '402', label: 'Втулка картонная 0.5" ширина 110 мм' } },
        { width: 57, limit: 10, sleeve: { id: '402', label: 'Втулка картонная 0.5" ширина 110 мм' } }
    ];
    var half = core.matchStockPoints(points, { sleeveChoice: { inches: '0.5', materialId: '' }, sleeveById: sleeveById });
    assertEqual(half.map(function(p) { return p.width; }), [57],
        '#4957: при втулке 0,5″ точка запаса 50 мм не предлагается');
    var any = core.matchStockPoints(points, { sleeveChoice: { inches: '', materialId: '' }, sleeveById: sleeveById });
    assertEqual(any.map(function(p) { return p.width; }), [50, 57],
        '#4957: диаметр не выбран — точки запаса не режем');
})();

// ── Экран: втулочные полосы видны в раскрое, выбывшие ширины названы ─────────────────
// Проверка не по исходнику: рендерим результат расчёта на заглушках DOM (как в
// experiments/atex-4690-to-order-disabled.test.js) и смотрим на настоящие узлы.
(function() {
    function makeNode(tag) {
        var node = {
            tagName: String(tag).toUpperCase(),
            className: '', textContent: '', innerHTML: '',
            dataset: {}, style: {}, attrs: {}, children: [], listeners: {},
            classList: { add: function() {}, remove: function() {}, toggle: function() {} },
            setAttribute: function(key, value) { node.attrs[key] = String(value); },
            appendChild: function(child) { node.children.push(child); return child; },
            addEventListener: function(type, fn) { (node.listeners[type] = node.listeners[type] || []).push(fn); }
        };
        return node;
    }
    global.document = {
        createElement: makeNode,
        createTextNode: function(text) { var n = makeNode('#text'); n.textContent = text; return n; }
    };
    var Controller = require('../download/atex/js/cut-optimizer.js').Controller;

    function findAll(node, pred, out) {
        out = out || [];
        if (!node) return out;
        if (pred(node)) out.push(node);
        (node.children || []).forEach(function(c) { findAll(c, pred, out); });
        return out;
    }
    function hasClass(node, cls) {
        return String(node.className || '').split(/\s+/).indexOf(cls) !== -1;
    }
    // Плашки экрана (atex-co-note) — то, что рабочее место говорит пользователю.
    function notes(node) {
        return findAll(node, function(n) { return hasClass(n, 'atex-co-note'); })
            .map(function(n) { return String(n.textContent || ''); });
    }
    function says(node, phrase) {
        return notes(node).filter(function(line) { return line.indexOf(phrase) >= 0; }).length > 0;
    }
    // Подписи строк таблицы «ширина → выпуск».
    function rowLabels(node) {
        return findAll(node, function(n) { return hasClass(n, 'atex-co-table-row'); })
            .map(function(n) { return String((n.children[0] || {}).textContent || ''); });
    }
    function render(plan) {
        var ctrl = Object.create(Controller.prototype);
        ctrl.viewEl = makeNode('div');
        ctrl.materialId = 1;
        ctrl.tolValue = '21';
        ctrl.materialById = function() { return { label: 'ПП 891' }; };
        ctrl.renderSummary = function() { return makeNode('div'); };
        ctrl.plan = plan;
        ctrl.renderResult();
        return ctrl.viewEl;
    }

    // 55 мм на втулке 0,5″/110 рядом с непроизводимыми 50 мм.
    var view = render(core.computePlan(891, [{ width: 55, qty: 12 }, { width: 50, qty: 3 }], { sleeve: HALF }));
    assert(says(view, 'не производится') && says(view, '50 мм'),
        '#4957: экран называет выбывшую ширину 50 мм и причину');
    assert(says(view, 'полосы 110 мм'), '#4957: экран говорит о добавленных полосах 110 мм');
    var segs = findAll(view, function(n) { return hasClass(n, 'atex-co-seg') && hasClass(n, 'atex-co-seg-core'); });
    assertEqual(segs.length, 2, '#4957: на рисунке раскроя два втулочных сегмента');
    var legend = findAll(view, function(n) { return hasClass(n, 'atex-co-swatch') && hasClass(n, 'atex-co-seg-core'); });
    assertEqual(legend.length, 1, '#4957: в легенде появился ключ втулочных полос');

    // Без втулочных полос лишнего ключа в легенде нет, и цветных сегментов тоже.
    var plain = render(core.computePlan(891, [{ width: 60, qty: 12 }]));
    assertEqual(findAll(plain, function(n) { return hasClass(n, 'atex-co-seg-core'); }).length, 0,
        '#4957: без втулочных полос ни сегментов, ни ключа легенды не добавляется');
    assertEqual(says(plain, 'полосы 110 мм'), false, '#4957: без втулки о полосах не говорим');

    // #3872: строка заказанных 110 мм помечена в таблице.
    var served = render(core.computePlan(891, [{ width: 55, qty: 12 }, { width: 110, qty: 2 }], { sleeve: HALF }));
    assertEqual(rowLabels(served), ['55', '110 · втулочные полосы'],
        '#4957/#3872: в таблице ширина 110 мм помечена как обеспеченная полосами');

    // Ширины разных диапазонов — экран объясняет, почему полос нет.
    var mixed = render(core.computePlan(891, [{ width: 55, qty: 6 }, { width: 63, qty: 6 }], { sleeve: HALF }));
    assert(says(mixed, 'разными резками'), '#4957: о смешении диапазонов экран говорит прямо');
})();

console.log('\n' + passed + '/' + total + ' проверок прошли');
if (passed !== total) process.exit(1);
