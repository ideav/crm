// Unit-тесты ideav/crm#3686: условие j= справочника «Фактическая ширина резки»
// должно сверяться с полем «Номинальная ширина» вида сырья (физический рулон, напр.
// 910), а НЕ с «Ширина, мм» (полезная ширина реза после кромки, напр. 891). Иначе
// правило вида `j=910` никогда не срабатывает (891 ≠ 910) и резка идёт по номиналу.
//
// Проверяем:
//   • loadJumboWidths — строит nominalWidthByMaterial из «Номинальная ширина»
//     (с деградацией к «Ширина, мм», когда номинал не задан);
//   • annotatePositionsCutWidth — берёт ctx.jumbo из НОМИНАЛЬНОЙ ширины, поэтому
//     заказ 33 при джамбо 910 (а реальная ширина реза 891) резолвится в 32.5.
//
// Run with: node experiments/test-issue-3686-jumbo-nominal-width.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/production-planning.js');
var planning = api.planning;

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

// Мок метаданных «Вид сырья» (id 1069): порядок реквизитов как в бою — «Ширина, мм»
// (1086) и «Номинальная ширина» (81089) разнесены, чтобы columnIndex считал реально.
var VID_META = {
    id: '1069', val: 'Вид сырья', reqs: [
        { id: '1084', val: 'Полное название' },
        { id: '1086', val: 'Ширина, мм' },
        { id: '1088', val: 'Длина рулона, м' },
        { id: '81089', val: 'Номинальная ширина' },
        { id: '1090', val: 'Примечания' },
        { id: '13585', val: 'Допуск, мм' }
    ]
};
// Записи: 39014 = MWR116L (ширина 891, номинал 910); 2158 = без номинала (→ деградация к 891).
// r[]: [главное, Полное название, Ширина мм, Длина, Номинал, Примечания, Допуск]
var VID_ROWS = [
    { i: '39014', r: ['MWR116L', 'MWR116L', '891.00', '600.00', '910.00', '', ''] },
    { i: '2158',  r: ['MW411',   'MW411',   '740.00', '450.00', '',       '', ''] }
];

function makeController() {
    var controller = Object.create(api.Controller.prototype);
    controller._metaAll = [VID_META];
    controller.getJson = function(path) {
        if (path.indexOf('object/1069') >= 0) return Promise.resolve(VID_ROWS);
        return Promise.resolve([]);
    };
    return controller;
}

function runLoadJumboWidthsTest() {
    var c = makeController();
    return c.loadJumboWidths().then(function() {
        assertEqual(c.jumboWidthByMaterial['39014'], 891, 'loadJumboWidths: «Ширина, мм» 891 для геометрии реза');
        assertEqual(c.nominalWidthByMaterial['39014'], 910, 'loadJumboWidths #3686: «Номинальная ширина» 910 для условий j=');
        assertEqual(c.nominalWidthByMaterial['2158'], 740, 'loadJumboWidths #3686: нет номинала → деградация к «Ширина, мм» 740');
    });
}

function runAnnotateUsesNominalTest() {
    var c = makeController();
    // Справочник: заказ 33 → 32.5 при джамбо 910 (как в бою, реквизит 66190).
    c.actualWidthIndex = planning.buildActualWidthIndex([
        { order: 33, actual: 32.5, code: 'j=910' },
        { order: 33, actual: 33,   code: 'j>1000' }
    ]);
    c.sleeveInchesById = {};
    return c.loadJumboWidths().then(function() {
        c.genPositions = [
            { id: 'p1', materialId: '39014', width: 33, qty: 27 },  // MWR116L: реальная 891, номинал 910
            { id: 'p2', materialId: '2158',  width: 33, qty: 5 }    // без номинала → нет совпадения j=910
        ];
        c.annotatePositionsCutWidth();
        assertEqual(c.genPositions[0].width, 32.5,
            'annotate #3686: заказ 33 при номинале 910 → 32.5 (хотя «Ширина, мм»=891 и при ней правило бы не сработало)');
        assertEqual(c.genPositions[0].orderWidth, 33, 'annotate: номинал заказа сохранён в orderWidth');
        assertEqual(c.genPositions[1].width, 33,
            'annotate #3686: без «Номинальной ширины» (деградация к 740) правило j=910 не срабатывает → номинал 33');
    });
}

runLoadJumboWidthsTest()
    .then(runAnnotateUsesNominalTest)
    .then(function() {
        console.log('\n' + passed + ' проверок прошло.');
        if (process.exitCode === 1) console.log('ЕСТЬ ПАДЕНИЯ — см. выше.');
        else console.log('Все проверки #3686 зелёные.');
    })
    .catch(function(err) {
        console.error(err && err.stack || err);
        process.exitCode = 1;
    });
