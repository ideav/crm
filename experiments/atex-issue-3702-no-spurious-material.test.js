// Unit tests for ideav/crm#3702 — у задания НЕ должна заполняться «Сырье/намотка»,
// если в плане её нет. Корень: persistCutSetupColumns (#3698/#3700) считал активности
// в порядке (sequence, planDate), который ПЕРЕМЕШИВАЕТ дни («Очередность» сбрасывается
// на день), поэтому у не-первой резки дня предшественником становилась резка другого
// дня — и ложно появлялась смена сырья. Фикс: порядок groupBySlitter (день плана →
// «Очередность» → ножи) + веса changeTimes. Тест проверяет корень на чистых функциях
// (groupBySlitter + setupActivityColumns), которые использует persistCutSetupColumns.
//
// Run with: node experiments/atex-issue-3702-no-spurious-material.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var TIMES = { MATERIAL_WINDING: 15, KNIFE: 30, BETWEEN_CUTS: 2 };
var DAY1 = '1717200000';   // 2024-06-01 (unix, сек)
var DAY2 = '1717286400';   // 2024-06-02

function mk(id, planDate, seq, materialId, knifeWidths) {
    return {
        id: id, slitter: { id: 's1', label: 'Станок 1' }, planDate: planDate, sequence: seq,
        materialId: materialId, winding: 'IN', batchId: 'b',
        knifeWidths: knifeWidths, knifeCount: knifeWidths.length, rollerWidth: 0
    };
}

// День 1: A (seq1, M1), B (seq2, M1 — то же сырьё, ДРУГИЕ ножи). День 2: C (seq1, M2).
var A = mk('A', DAY1, 1, 'M1', [100, 200]);
var B = mk('B', DAY1, 2, 'M1', [100, 300]);
var C = mk('C', DAY2, 1, 'M2', [100, 200]);

// ── Фикс: порядок groupBySlitter не перемешивает дни ──
var groups = planning.groupBySlitter([C, B, A]);   // намеренно вперемешку
assertEqual(groups.length, 1, 'один станок → одна группа');
assertEqual(groups[0].cuts.map(function (x) { return x.id; }), ['A', 'B', 'C'],
    'groupBySlitter: день плана → «Очередность» (дни НЕ перемешиваются)');

var cols = planning.setupActivityColumns(groups[0].cuts, TIMES);
assertEqual(cols['B'].materialWindingMin, 0, 'B: предшественник A того же дня — то же сырьё → смены сырья НЕТ');
assertEqual(cols['B'].knifeMin, 30, 'B: только смена ножей (30)');
assertEqual(cols['C'].materialWindingMin, 15, 'C: первая резка дня 2, сырьё сменилось с M1 на M2 → смена сырья 15');

// ── Контроль регрессии: прежний порядок (sequence-first) ложно ставил смену сырья ──
var buggyOrder = [C, B, A].slice().sort(function (a, b) {
    var qa = a.sequence == null ? Infinity : a.sequence;
    var qb = b.sequence == null ? Infinity : b.sequence;
    if (qa !== qb) return qa - qb;
    return String(a.planDate).localeCompare(String(b.planDate));
});
assertEqual(buggyOrder.map(function (x) { return x.id; }), ['A', 'C', 'B'],
    'старый порядок (sequence-first) перемешивал дни: A, C, B');
var buggyCols = planning.setupActivityColumns(buggyOrder, TIMES);
assertEqual(buggyCols['B'].materialWindingMin, 15,
    'регрессия-контроль: при старом порядке у B ложно появлялась смена сырья (15)');

console.log('\n' + passed + ' assertions passed');
