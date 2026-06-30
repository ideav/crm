// Unit tests for #3871 — «Нажал Создать — и долго висит» (выравнивание загрузки станков
// по строчке в полминуты).
//
// rebalanceSlitterLoad на каждую пробу переноса пересчитывал переналадку по ПОЛНЫМ наборам
// станка через greedySequence с перебором стартов (O(n³)). При ~170 резках это ≈40 с на
// перенос — «Создать» висел минутами, окно прогресса не успевало отрисоваться. Фикс (#3871):
// на время прохода — кэш стоимости перехода по паре id + одностартовая жадная цепочка (O(n²)).
// Оценка переналадки тут лишь ориентир баланса (финальную очередь строит planCutOperations),
// поэтому результат балансировки сохраняется, а проход ускоряется в сотни раз.
//
// Run with: node experiments/atex-production-planning-3871.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name); process.exitCode = 1; }
}

var CAP = 450;
var SLITTERS = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
function maxDays(load) { return Math.max.apply(null, Object.keys(load).map(function (k) { return load[k].days; })); }
function peakMin(load) { return Math.max.apply(null, Object.keys(load).map(function (k) { return load[k].minutes; })); }

// Детерминированный набор резок с разнообразием сырья/ножей (переналадка нетривиальна).
var MATERIALS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
var KNIFE_SETS = [[50], [50, 80], [60], [40, 40, 40], [100], [55, 55], [70, 90], [120]];
function makePlans(targets) {
    // Стартовая загрузка свалена жадным назначением на «свои» станки → перегруз.
    var plans = [], id = 0;
    Object.keys(targets).forEach(function (sid) {
        var acc = 0, i = 0;
        while (acc < targets[sid]) {
            var dur = 40 + (i % 5) * 10;          // 40..80 мин
            var ks = KNIFE_SETS[(id * 3 + Number(sid)) % KNIFE_SETS.length];
            plans.push({ id: 'c' + (id++), slitterId: sid, materialId: MATERIALS[(id + Number(sid)) % MATERIALS.length],
                winding: (id % 2 ? 'OUT' : 'IN'), knifeWidths: ks.slice(), knifeCount: ks.length, isFoil: false, duration: dur });
            acc += dur; i++;
        }
    });
    return plans;
}
function makeBigPlans() {
    // ~ как в issue: С1 2300, С2 2800, С3 1790, С4 3100 (минуты намотки); 1–3 простаивают слабее 4.
    var targets = { '1': 2300, '2': 2800, '3': 1790, '4': 3100 };
    return makePlans(targets);
}

// ── Большой набор: выравнивание сходится и НЕ висит ──
(function () {
    var plans = makeBigPlans();
    assert(plans.length > 120, '#3871 набор крупный (>120 резок): ' + plans.length);

    var t0 = Date.now();
    var res = planning.rebalanceSlitterLoad(plans, SLITTERS, { weights: null, dayCapacityMin: CAP });
    var elapsedMs = Date.now() - t0;
    console.log('  выравнивание: ' + res.moves.length + ' переносов за ' + elapsedMs + 'ms; макс. дней ' +
        maxDays(res.loadBefore) + '→' + maxDays(res.loadAfter));

    // Перформанс-страховка: до фикса проход шёл ≈9 мин (≈40 с на перенос). Порог щедрый,
    // чтобы не флапать по CI, но падает на O(n³)-регрессии.
    assert(elapsedMs < 20000, '#3871 быстро (< 20 c; было ≈9 мин): ' + elapsedMs + 'ms');

    // Результат балансировки сохранён: перегруз снят, пик минут упал, дни выровнялись.
    assert(maxDays(res.loadBefore) >= 8, '#3871 старт: перегруз (макс. ≥8 дней)');
    assert(maxDays(res.loadAfter) <= maxDays(res.loadBefore), '#3871 итог: макс. число дней не вырос');
    assert(peakMin(res.loadAfter) < peakMin(res.loadBefore), '#3871 итог: пик минут станка упал');
    assert(res.moves.length > 0, '#3871 есть переносы');
    assert(res.stopReason === 'no-progress', '#3871 стоп по отсутствию прогресса (не уперлись в лимит итераций)');

    // Все четыре станка задействованы (работа не осталась на одном-двух).
    var used = Object.keys(res.loadAfter).filter(function (k) { return res.loadAfter[k].minutes > 0; });
    assert(used.length === 4, '#3871 итог: задействованы все 4 станка');
})();

// ── Детерминизм: повтор даёт тот же результат (одностартовая цепочка стабильна) ──
(function () {
    var mid = { '1': 1000, '2': 1400, '3': 600, '4': 1600 };
    var a = planning.rebalanceSlitterLoad(makePlans(mid), SLITTERS, { weights: null, dayCapacityMin: CAP });
    var b = planning.rebalanceSlitterLoad(makePlans(mid), SLITTERS, { weights: null, dayCapacityMin: CAP });
    assert(JSON.stringify(a.loadAfter) === JSON.stringify(b.loadAfter), '#3871 детерминизм: повтор даёт ту же загрузку');
    assert(a.moves.length === b.moves.length, '#3871 детерминизм: то же число переносов');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
