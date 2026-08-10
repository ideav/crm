// Планирование проставляет ТИПОРАЗМЕР упаковки «Партии ГП» (ideav/crm#4665).
//
// Подсказка упаковщику («в какой короб и по сколько штук») должна появляться в момент
// планирования: каждая создаваемая «Партия ГП» получает ссылку на запись справочника
// «Типоразмер», подобранную по ширине ролика, длине намотки, фольге и доп. втулке.
// Сам подбор — download/atex/js/packaging-size.js (experiments/atex-packaging-size.test.js),
// здесь — стык: реквизит в полях записи, доп. втулка позиции из отчёта и подпись строки.
//
// Run with: node experiments/atex-pp-tiporazmer-4665.test.js

var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;
var Controller = mod.Controller;
var packing = require('../download/atex/js/packaging-size.js').core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var FB_META = { id: '1081', reqs: [
    { id: '1186', val: 'Ширина, мм' }, { id: '70190', val: 'Кол-во полос' },
    { id: '70575', val: 'Кол-во план' }, { id: '673788', val: 'Типоразмер' }
]};

// ── Реквизит «Типоразмер» уезжает в запись «Партии ГП» ──
(function() {
    var fields = planning.buildFinishedBatchFields(FB_META, { width: 33, strips: 3, size: '670992' });
    assertEqual(fields.t673788, '670992', 'buildFinishedBatchFields: типоразмер пишется в «Партию ГП»');
    var without = planning.buildFinishedBatchFields(FB_META, { width: 33, strips: 3 });
    assertEqual(Object.prototype.hasOwnProperty.call(without, 't673788'), false,
        'buildFinishedBatchFields: без подобранного типоразмера поле не трогаем');
})();

// ── Доп. втулка позиции приезжает из отчёта positions_list ──
(function() {
    var rows = [
        { position_id: '10', position_width: '33', position_length: '450', position_add_sleeve: 'Приклеить' },
        { position_id: '11', position_width: '33', position_length: '450', position_add_sleeve: '' }
    ];
    var gen = planning.rowsToGenPositions(rows);
    assertEqual(gen[0].addSleeve, 'Приклеить', 'rowsToGenPositions: доп. втулка позиции читается');
    assertEqual(Object.prototype.hasOwnProperty.call(gen[1], 'addSleeve'), false,
        'rowsToGenPositions: пустая доп. втулка ключа не заводит (форма записи — оракул соседних тестов)');
    var list = planning.rowsToPositions(rows);
    assertEqual(list[0].addSleeve, 'Приклеить', 'rowsToPositions: доп. втулка позиции читается');
})();

// ── Подбор типоразмера контроллером: ширина полосы, длина и фольга задания, доп. втулка позиции ──
(function() {
    var SIZES = packing.sizesFromReport([
        { size_id: '670992', size_name: '31-40 Х 330/450', add_sleeve: '', rows_cnt: '3', per_row: '12', per_box: '36', box: '№125', w_from: '31.00', w_to: '40.00', l_from: '321', l_to: '450', foil: '' },
        { size_id: '670993', size_name: '31-40 Х 330/450', add_sleeve: 'с доп. втулкой', rows_cnt: '3', per_row: '10', per_box: '30', box: '№125', w_from: '31.00', w_to: '40.00', l_from: '321', l_to: '450', foil: '' },
        { size_id: '671069', size_name: 'фольга 30 х 122', add_sleeve: '', rows_cnt: '', per_row: '', per_box: '60', box: '№125', w_from: '30.00', w_to: '30.00', l_from: '122', l_to: '122', foil: 'X' }
    ]);
    var cut = { id: '700', length: 450, isFoil: false, materialType: '' };
    var ctl = Object.create(Controller.prototype);
    ctl.packSizes = SIZES;
    ctl.cuts = [cut];
    ctl.genPositions = [{ id: '10', width: 33, length: 450, addSleeve: 'Приклеить' }];
    ctl.supplies = [{ cutId: '700', positionId: '10', positionWidth: 33 }];

    assertEqual(ctl.packSizeIdFor(cut, 33), '670993',
        'packSizeIdFor: у обеспечиваемой позиции доп. втулка → норма «с доп. втулкой»');
    assertEqual(ctl.packSizeIdForCutId('700', 33), '670993', 'packSizeIdForCutId: то же по id задания');

    // Полоса не в заказ (добор ходовыми): доп. втулки нет — обычная норма.
    ctl.genPositions = [];
    ctl.supplies = [];
    assertEqual(ctl.packSizeIdFor(cut, 33), '670992', 'packSizeIdFor: полоса не в заказ — норма без доп. втулки');

    // Фольга — своя ветка справочника (длины точные).
    var foilCut = { id: '701', length: 122, isFoil: true, materialType: 'Фольга' };
    ctl.cuts = [foilCut];
    assertEqual(ctl.packSizeIdFor(foilCut, 30), '671069', 'packSizeIdFor: фольга берёт фольговый типоразмер');

    // Ничего не подошло — поле не пишем.
    assertEqual(ctl.packSizeIdFor({ id: '702', length: 5000, isFoil: false }, 33), '',
        'packSizeIdFor: типоразмера нет → пусто, поле не пишется');
    var noDict = Object.create(Controller.prototype);
    noDict.packSizes = [];
    assertEqual(noDict.packSizeIdFor(cut, 33), '', 'packSizeIdFor: справочник не прочитан → пусто');

    // Подпись строки полосы: имя типоразмера + короб и раскладка.
    ctl.packSizes = SIZES;
    assertEqual(ctl.stripPackTitle(cut, 33, 33.2), '31-40 Х 330/450 — №125 · 36 шт в коробе (3 × 12)',
        'stripPackTitle: подпись строки полосы');
    assertEqual(ctl.stripPackTitle({ id: '703', length: 5000 }, 33, 33), '',
        'stripPackTitle: нечего подсказать — подписи нет');

    // #4685: со числом полос — ещё и сколько коробов уйдёт на мотки ЭТОЙ строки.
    // Мотки = проходы × полос (та же арифметика, что в подписи строки): 14 × 22 = 308,
    // по 36 в коробе → 9 коробов (последний неполный).
    var manyRuns = { id: '704', length: 450, isFoil: false, materialType: '', plannedRuns: 14 };
    ctl.cuts = [manyRuns];
    assertEqual(planning.stripRollsForCut(manyRuns, 22), 308, 'stripRollsForCut: мотки = проходы × полос');
    assertEqual(ctl.stripPackTitle(manyRuns, 33, 33, 22),
        '31-40 Х 330/450 — №125 · 36 шт в коробе (3 × 12) · 9 коробов',
        'stripPackTitle: число коробов на мотки строки');
    // Ровно один короб — «1 короб», а не «1 коробов».
    assertEqual(ctl.stripPackTitle({ id: '705', length: 450, plannedRuns: 36 }, 33, 33, 1),
        '31-40 Х 330/450 — №125 · 36 шт в коробе (3 × 12) · 1 короб',
        'stripPackTitle: ровно один короб');
    // Проходов ещё нет (setup-хвост) — коробов не выдумываем.
    assertEqual(ctl.stripPackTitle({ id: '706', length: 450, plannedRuns: 0 }, 33, 33, 22),
        '31-40 Х 330/450 — №125 · 36 шт в коробе (3 × 12)',
        'stripPackTitle: без проходов коробов не считаем');
})();

console.log('\n' + passed + ' assertions passed');
