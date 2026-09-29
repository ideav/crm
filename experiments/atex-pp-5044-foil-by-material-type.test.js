// #5044 — «Время резки»: у задания из сырья MB тайминг считался по обычной норме
// (WIND_300/WIND_450 с интерполяцией, узкая WIND_W30_300), хотя в «Время операции, мин»
// для фольги есть WIND_FOIL_305 = 4 мин.
//
// Фольга — это «Тип сырья» справочника «Вид сырья» (у MB = «Фольга»), а не слово в
// названии: имя «MB» слова «фольг» не содержит. Задание, загруженное из cut_planning,
// обязано получить isFoil по типу своего вида сырья — от него зависит выбор нормы
// намотки (windPointsForCut) и «фольга в конец дня» (#3717).
//
// Run with: node experiments/atex-pp-5044-foil-by-material-type.test.js

var M = require('../download/atex/js/production-planning.js');
var planning = M.planning;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}
function assertMatch(text, re, name) {
    total++;
    var ok = re.test(String(text));
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  text:', JSON.stringify(text));
    process.exitCode = 1;
}

// Метаданные «Вид сырья» (1069) в боевом порядке реквизитов; «Тип сырья» — ссылка,
// JSON_OBJ отдаёт её как «<id>:<значение>».
var VID_META = {
    id: '1069', val: 'Вид сырья', reqs: [
        { id: '1084', val: 'Полное название' },
        { id: '1086', val: 'Ширина, мм' },
        { id: '1088', val: 'Длина рулона, м' },
        { id: '81089', val: 'Номинальная ширина' },
        { id: '1090', val: 'Примечания' },
        { id: '13585', val: 'Допуск, мм' },
        { id: '84633', val: 'Тип сырья' },
        { id: '774855', val: 'Для расчета резки' },
        { id: '867030', val: 'Альтернативное имя' }
    ]
};
// Записи с боевой базы: 2240 = MB (фольга), 66254 = второй «MB» без типа, 2086 = MR194.
var VID_ROWS = [
    { i: 2240, r: ['MB', 'DMP901 HSF Jumbo 910 х 6000', '891.00', '6000', '910.00', '', '21.00', '84634:Фольга', '', ''] },
    { i: 66254, r: ['MB', '', '', '', '', '', '', '', 'X', ''] },
    { i: 2086, r: ['MR194', 'TDR330 Resin Jumbo 910 х 18600', '891.00', '18600', '910.00', '', '', '', 'X', 'MCHR ZNAK 2 Extra'] }
];

// «Время операции, мин» (13588) — боевые нормы намотки.
var OP_TIMES = {
    WIND_300: 1.5, WIND_450: 1.8, WIND_600: 4, WIND_900: 5, WIND_1000: 5.3, WIND_1100: 5.6,
    BETWEEN_CUTS: 2, WIND_FOIL_305: 4, WIND_05_110: 4,
    WIND_W30_300: 2.25, WIND_W30_450: 2.7, WIND_W30_600: 6
};

function reportRow(over) {
    var base = {
        cut_id: '900001', cut_material_id: '2240', cut_material: 'MB',
        cut_winding: 'IN', cut_roller_width: '50.00', cut_length: '305.00', cut_planned_runs: '7'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

function controllerWith(cuts) {
    var c = Object.create(M.Controller.prototype);
    c._metaAll = [VID_META];
    c.getJson = function(path) {
        return Promise.resolve(path.indexOf('object/1069') >= 0 ? VID_ROWS : []);
    };
    c.cuts = cuts;
    c.supplies = [];
    c.genPositions = [];
    c.healCutBatches = function() {};   // граница: партии сырья тут не участвуют
    return c;
}

var p = planning.rowsToPlanning([
    reportRow({}),                                                            // скрин 1: 49 мм × 305 м × 7
    reportRow({ cut_id: '900002', cut_length: '122.00', cut_planned_runs: '15' }), // скрин 2: 30 мм × 122 м × 15
    reportRow({ cut_id: '900003', cut_material_id: '2086', cut_material: 'MR194',
        cut_winding: 'OUT', cut_length: '300.00', cut_planned_runs: '2' }),
    reportRow({ cut_id: '900004', cut_material_id: '66254' })               // «MB» без типа
]);
var byId = {};
p.cuts.forEach(function(cut) { byId[cut.id] = cut; });
byId['900001'].knifeWidths = [49, 49, 49];
byId['900002'].knifeWidths = [30, 30, 30];

var ctrl = controllerWith(p.cuts);
ctrl.loadJumboWidths().then(function() {
    ctrl.resolveCutMaterials();

    assertEqual(byId['900001'].isFoil, true, '#5044: MB («Тип сырья» = Фольга) — задание фольговое, хоть в имени нет «фольг»');
    assertEqual(byId['900002'].isFoil, true, '#5044: узкое задание MB — тоже фольга');
    assertEqual(byId['900003'].isFoil, false, '#5044: MR194 без типа «Фольга» — не фольга');
    assertEqual(byId['900004'].isFoil, false, '#5044: вид сырья без «Типа сырья» — не фольга (данных нет — не выдумываем)');

    var t1 = planning.cutTimingDetails(305, 7, OP_TIMES, byId['900001']);
    assertMatch(t1, /Норма намотки: WIND_FOIL_305=4 мин/, '#5044 скрин 1: 305 м — норма WIND_FOIL_305, а не WIND_300/WIND_450');
    assertMatch(t1, /Намотка: 4 \* 7 = 28 мин/, '#5044 скрин 1: намотка 4 мин × 7 проходов');

    var t2 = planning.cutTimingDetails(122, 15, OP_TIMES, byId['900002']);
    assertMatch(t2, /Норма намотки: WIND_FOIL_305=4 мин/, '#5044 скрин 2: полосы 30 мм — у фольги своя норма, не WIND_W30_300');
    assertMatch(t2, /Намотка: 4 \* 15 = 60 мин/, '#5044 скрин 2: 122 м — полная норма блока 305 м (#3742), 4 × 15');

    var t3 = planning.cutTimingDetails(300, 2, OP_TIMES, byId['900003']);
    assertMatch(t3, /Норма намотки: WIND_300=1.5 мин/, '#5044: обычное сырьё по-прежнему на WIND_300');

    console.log('\n' + passed + '/' + total + ' assertions passed');
    if (passed !== total) process.exitCode = 1;
}).catch(function(e) { console.error(e); process.exitCode = 1; });
