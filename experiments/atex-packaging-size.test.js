// Unit tests подбора типоразмера упаковки (ideav/crm#4665).
//
// Строки справочника — снимок боевой ateh (отчёт `pack_sizes`, справочник 670936).
// Проверяются: смежные диапазоны без дыр, правило по доп. втулке
// («с доп. втулкой» / «так же с доп. втулкой»), отдельная ветка фольги с ТОЧНЫМИ
// длинами и то, что строки, привязанные к типу втулки (пустые диапазоны), не
// подбираются. См. docs/atex_workplaces.md §3.13 и docs/integram-reports.md §12.
//
// Run with: node experiments/atex-packaging-size.test.js

var core = require('../download/atex/js/packaging-size.js').core;

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

var ROWS = [
    { size_id: '670947', size_name: '110х74/110 втулка 1"', add_sleeve: '', rows_cnt: '1', per_row: '28', per_box: '28', box: '№125', w_from: '', w_to: '', l_from: '', l_to: '', foil: '' },
    { size_id: '670978', size_name: '25-30 Х 270/320', add_sleeve: '', rows_cnt: '4', per_row: '15', per_box: '60', box: '№125', w_from: '25.00', w_to: '30.00', l_from: '201', l_to: '320', foil: '' },
    { size_id: '670992', size_name: '31-40 Х 330/450', add_sleeve: '', rows_cnt: '3', per_row: '12', per_box: '36', box: '№125', w_from: '31.00', w_to: '40.00', l_from: '321', l_to: '450', foil: '' },
    { size_id: '670993', size_name: '31-40 Х 330/450', add_sleeve: 'с доп. втулкой', rows_cnt: '3', per_row: '10', per_box: '30', box: '№125', w_from: '31.00', w_to: '40.00', l_from: '321', l_to: '450', foil: '' },
    { size_id: '670996', size_name: '31-40 Х 610/700', add_sleeve: 'так же с доп. втулкой', rows_cnt: '3', per_row: '8', per_box: '24', box: '№125', w_from: '31.00', w_to: '40.00', l_from: '601', l_to: '700', foil: '' },
    { size_id: '671025', size_name: '84-124 Х 200', add_sleeve: '', rows_cnt: '1', per_row: '24', per_box: '24', box: '№125', w_from: '84.00', w_to: '124.00', l_from: '0', l_to: '200', foil: '' },
    { size_id: '671026', size_name: '84-124 Х 200', add_sleeve: 'с доп. втулкой', rows_cnt: '1', per_row: '22', per_box: '22', box: '№125', w_from: '84.00', w_to: '124.00', l_from: '0', l_to: '200', foil: '' },
    { size_id: '671069', size_name: 'фольга 30 х 122', add_sleeve: '', rows_cnt: '', per_row: '', per_box: '60', box: '№125', w_from: '30.00', w_to: '30.00', l_from: '122', l_to: '122', foil: 'X' },
    { size_id: '671070', size_name: 'фольга 30 х 305', add_sleeve: '', rows_cnt: '', per_row: '', per_box: '24', box: '№125', w_from: '30.00', w_to: '30.00', l_from: '305', l_to: '305', foil: 'X' }
];
var SIZES = core.sizesFromReport(ROWS);

function match(params) {
    var s = core.matchSize(SIZES, params);
    return s ? s.size_name || s.name : null;
}

// ── Разбор строки справочника ──
(function() {
    var s = core.sizeFromReportRow(ROWS[2]);
    assertEqual([s.id, s.name, s.wFrom, s.wTo, s.lFrom, s.lTo, s.perBox, s.box, s.foil, s.hasRange],
        ['670992', '31-40 Х 330/450', 31, 40, 321, 450, 36, '№125', false, true],
        'sizeFromReportRow: диапазоны, короб, признак фольги');
    var noRange = core.sizeFromReportRow(ROWS[0]);
    assertEqual(noRange.hasRange, false, 'sizeFromReportRow: строка без диапазонов помечена');
    var both = core.sizeFromReportRow(ROWS[4]);
    assertEqual([both.withAddSleeve, both.bothWays], [true, true],
        'sizeFromReportRow: «так же с доп. втулкой» — и с доп. втулкой, и без');
})();

// ── Обычные ролики: ширина × длина ──
assertEqual(match({ width: 33, length: 450 }), '31-40 Х 330/450', 'подбор: 33 мм × 450 м');
assertEqual(match({ width: 40, length: 321 }), '31-40 Х 330/450', 'подбор: границы диапазона включительно');
assertEqual(match({ width: 110, length: 74 }), '84-124 Х 200',
    'подбор: длина 74 м попадает в нижний бин (0–200), а не мимо');
assertEqual(match({ width: 30, length: 305 }), '25-30 Х 270/320',
    'подбор: НЕ фольга 305 м идёт в обычный бин 201–320');

// ── Доп. втулка ──
assertEqual(match({ width: 33, length: 450, addSleeve: '' }), '31-40 Х 330/450', 'доп. втулки нет → строка без неё');
(function() {
    var plain = core.matchSize(SIZES, { width: 33, length: 450, addSleeve: '' });
    var glued = core.matchSize(SIZES, { width: 33, length: 450, addSleeve: 'Приклеить' });
    assertEqual([plain.id, plain.perBox], ['670992', 36], 'без доп. втулки: 36 шт в коробе');
    assertEqual([glued.id, glued.perBox], ['670993', 30], 'с доп. втулкой: своя норма 30 шт');
    var inserted = core.matchSize(SIZES, { width: 33, length: 450, addSleeve: 'Вложить' });
    assertEqual(inserted.id, '670993', '«Вложить» — тоже доп. втулка');

    // Для длин от 460 м пары строк нет — работает «так же с доп. втулкой» в обе стороны.
    var bothWith = core.matchSize(SIZES, { width: 33, length: 650, addSleeve: 'Приклеить' });
    var bothWithout = core.matchSize(SIZES, { width: 33, length: 650, addSleeve: '' });
    assertEqual([bothWith.id, bothWithout.id], ['670996', '670996'],
        '«так же с доп. втулкой» подходит и с доп. втулкой, и без');
})();
(function() {
    // Строку «с доп. втулкой» ролику БЕЗ доп. втулки не отдаём: если бы пары без неё не
    // было, подбор обязан вернуть null, а не чужую норму.
    var onlyWithAdd = core.sizesFromReport([ROWS[3]]);
    assertEqual(core.matchSize(onlyWithAdd, { width: 33, length: 450, addSleeve: '' }), null,
        'без доп. втулки: строка «с доп. втулкой» не подходит');
})();

// ── Фольга: отдельная ветка, длины точные ──
assertEqual(match({ width: 30, length: 305, foil: true }), 'фольга 30 х 305', 'фольга: 30 мм × 305 м');
assertEqual(match({ width: 30, length: 122, foil: true }), 'фольга 30 х 122', 'фольга: та же ширина, другая длина');
assertEqual(match({ width: 30, length: 300, foil: true }), null,
    'фольга: длина не из справочника — типоразмера нет');
assertEqual(match({ width: 33, length: 450, foil: true }), null, 'фольга не берёт обычные строки');
assertEqual(core.isFoilType('Фольга'), true, 'isFoilType: «Фольга»');
assertEqual(core.isFoilType(''), false, 'isFoilType: пусто → нет');

// ── Ничего не подошло ──
assertEqual(match({ width: 250, length: 300 }), null, 'ширина вне справочника → null');
assertEqual(match({ width: 33, length: 5000 }), null, 'длина вне справочника → null');
assertEqual(match({ width: 0, length: 300 }), null, 'без ширины → null');
assertEqual(match({ width: 33, length: 0 }), null, 'без длины → null');
assertEqual(match({ width: 110, length: 74, addSleeve: 'Приклеить' }), '84-124 Х 200',
    'строка, привязанная к типу втулки, в подбор не лезет');

// ── Подпись и короба ──
(function() {
    var s = core.matchSize(SIZES, { width: 33, length: 450 });
    assertEqual(core.describeSize(s), '№125 · 36 шт в коробе (3 × 12)', 'describeSize: короб и раскладка');
    var foil = core.matchSize(SIZES, { width: 30, length: 305, foil: true });
    assertEqual(core.describeSize(foil), '№125 · 24 шт в коробе', 'describeSize: у фольги раскладки нет');
    assertEqual(core.describeSize(null), '', 'describeSize: без типоразмера — пусто');
    assertEqual(core.boxesFor(s, 36), 1, 'boxesFor: ровно короб');
    assertEqual(core.boxesFor(s, 37), 2, 'boxesFor: остаток — ещё короб');
    assertEqual(core.boxesFor(s, 0), 0, 'boxesFor: нечего упаковывать');
    assertEqual(core.boxesFor(null, 10), 0, 'boxesFor: без типоразмера — 0');
})();

console.log('\n' + passed + ' assertions passed');
