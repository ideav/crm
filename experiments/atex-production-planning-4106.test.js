// Тест #4106 — станки НЕ разъезжаются: штраф «большой простой между станками» (#4085 §8 п.6,
// MAX_DISTANCE) не начислялся, потому что distanceExceededFor нигде не создавался (мёртвый хук).
// Из-за этого выбор станка сваливался в чистое совпадение сырья: одинаковое сырьё копилось на ОДНОМ
// станке (совпадение → вес 0), а свободные простаивали (смена сырья → +MATERIAL_CHANGE), день не
// держал 450 (лог #4106: Станок 1 = 39 заданий/1979 мин, Станок 3 = 3). БЕЗ балансировщика — только
// штрафом (ТЗ §8 п.6): кандидат, уводящий старт больше чем на MAX_SLOTS_DISTANCE_HR от рано
// освобождающегося другого станка, получает +MAX_DISTANCE_COST_MN → мин.штраф уводит на простаивающий.
//
// Run with: node experiments/atex-production-planning-4106.test.js

var P = require('../download/atex/js/production-planning.js').planning;
var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // чистая оценка дня (setup=0)

// Резка контроллера: sr — станок (для фикс. сида), mat — сырьё, fix — зафиксирована (в сид занятости).
function cut(id, mat, sr, fix) {
    return { id: id, slitter: sr ? { id: sr } : undefined, materialId: mat, winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, rollerWidth: 0, plannedRuns: 1, isFoil: false, fixed: !!fix };
}

// Сценарий: 3 станка. m1 УЖЕ загружен сырьём M на 3 дня (сид m1a/b/c по 300 мин при ёмкости 400 →
// дни 0,1,2), m2/m3 простаивают — по одной мелкой резке сырья N (день0). Затем 3 подвижных резки
// сырья M. На m1 они пристраиваются к M (смена не нужна → вес 0), НО в хвост дня 3+ (простой > суток
// от m2/m3); на m2/m3 — смена сырья (+MATERIAL_CHANGE 15), зато без простоя. БЕЗ штрафа §8 п.6 вес 0
// на m1 всегда бьёт 15 → всё копится на m1; СО штрафом хвост m1 получает +25 (>15) → уезжает на m2/m3.
function run(distanceHr) {
    var seeds = [cut('m1a', 'M', 'm1', true), cut('m1b', 'M', 'm1', true), cut('m1c', 'M', 'm1', true),
                 cut('sN2', 'N', 'm2', true), cut('sN3', 'N', 'm3', true)];
    var mov = [];
    for (var i = 1; i <= 3; i++) mov.push(cut('T' + i, 'M'));   // подвижные, сырьё M
    var cuts = seeds.concat(mov);
    var perPass = {}, dueBy = {};
    cuts.forEach(function (c) {
        perPass[c.id] = (c.id === 'sN2' || c.id === 'sN3') ? 50 : 300;   // m1-сид по 300 (дни 0/1/2), N-сиды мелкие
        dueBy[c.id] = 20270101;                                 // срок далеко → без дедлайн-давления
    });
    var settings = { MAX_SLOTS_DISTANCE_HR: distanceHr };       // 0 → штраф выключен; 24 → включён
    var res = P.computeSlotPlacement(cuts, {
        settings: settings, times: ZERO, capacityMin: 400, baseMidnightMs: 0,
        perPassByCut: perPass, dueKeyByCut: dueBy, slitterIds: ['m1', 'm2', 'm3'],
        relocate: false   // изолируем первичную вставку (без §12-релокации)
    });
    var byM = { m1: 0, m2: 0, m3: 0 };
    mov.forEach(function (c) { var sid = res.slitterByCut[c.id]; if (byM[sid] != null) byM[sid]++; });
    return byM;
}

// БЕЗ штрафа (MAX_SLOTS_DISTANCE_HR=0): всё сырьё M копится на m1 (вес 0 всегда бьёт +MATERIAL_CHANGE).
var off = run(0);
console.log('  БЕЗ штрафа (порог 0):  m1=' + off.m1 + ' m2=' + off.m2 + ' m3=' + off.m3);
assert(off.m1 === 3, '#4106 без MAX_DISTANCE: все 3 подвижных сваливаются на перегруженный m1 (совпадение сырья)');

// СО штрафом (порог 24ч): хвост m1 (день 3+) простаивает > суток от m2/m3 → +MAX_DISTANCE_COST_MN
// делает его дороже смены сырья → подвижные уезжают на простаивавшие m2/m3.
var on = run(24);
console.log('  СО штрафом (порог 24): m1=' + on.m1 + ' m2=' + on.m2 + ' m3=' + on.m3);
assert(on.m1 < 3, '#4106 с MAX_DISTANCE: m1 больше НЕ забирает всё (спред штрафом)');
assert(on.m2 + on.m3 > 0, '#4106 с MAX_DISTANCE: часть подвижных уехала на простаивавшие m2/m3');

console.log('\n' + passed + '/' + total + ' passed');
