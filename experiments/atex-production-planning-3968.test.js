// Tests for ideav/crm#3968 — «Станки недогружены, некоторые сильно».
//
// Симптом (CSV+отчёты cut_planning/positions_list из #3968): Станок 1 работал всего 2 дня
// (420 и 414 мин), потом пусто, пока Станки 2/3/4 несли по 6–9 дней и местами переливали за
// ёмкость. Недогруженный день Станка 1 — просроченная (сроки 25–29.06) партия ОДНОГО сырья: в
// реальной по-дневной укладке (splitMachineQueue/selectByConfig) соседние одинаковые конфиги
// ставят ножи/сырьё ОДИН раз, поэтому 12 резок укладывались в 420 мин.
//
// Причина: балансировщик (rebalanceSlitterLoad → packMachine, #3965) считал настройку КАЖДОЙ
// резки «с нуля» (ножи+сырьё), игнорируя группировку. Настроечно-СГРУППИРОВАННЫЙ станок оценивался
// почти вдвое тяжелее реального (репро на данных #3968: Станок 1 оценка 1479 при реальных 834 мин),
// поэтому балансировщик считал его загруженным и НЕ докидывал на него работу — станок оставался
// недогруженным, а соседние копили перегруз.
//
// Фикс #3968: packMachine считает настройку резки как переналадку от ПРЕДЫДУЩЕЙ в очереди
// (changeoverCost, как buildSchedule: setup = changeoverCost(cuts[i-1], c)), а НЕ «с нуля» у
// каждой. Одинаковые конфиги группируются (переход 0) → оценка совпадает с реальной укладкой;
// разные конфиги (сценарий #3965) по-прежнему дают полную настройку у каждой (станок тяжёлый).
//
// Run with: node experiments/atex-production-planning-3968.test.js

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

var CAP = 450;
var SCRATCH = 45;   // ножи 30 + сырьё 15

// Просроченная партия одного сырья: одинаковый конфиг → группируется.
function grouped(id, sid, wind) {
    return { id: id, slitterId: String(sid), materialId: 'BATCH', winding: 'OUT',
             knifeWidths: [50], knifeCount: 1, isFoil: false, duration: wind };
}
// Настроечно-разная резка (у каждой своё сырьё+ножи) → каждый переход = полная настройка 45.
var _w = {}, _n = 0;
function distinct(id, sid, wind) {
    if (!(id in _w)) _w[id] = 50 + (_n++) * 3;
    return { id: id, slitterId: String(sid), materialId: 'M' + id, winding: 'OUT',
             knifeWidths: [_w[id]], knifeCount: 1, isFoil: false, duration: wind };
}
function dist(p) { var o = {}; p.forEach(function (x) { o[x.slitterId] = (o[x.slitterId] || 0) + 1; }); return o; }

// ── 1) Сгруппированная партия НЕ завышается (оценка = реальная укладка, не «с нуля» у каждой) ──
(function () {
    // 12 резок одного сырья, намотка 30. Реальная укладка: 45 (первая настройка) + 12×30 = 405 мин.
    // Старая оценка «с нуля» дала бы 12×(45+30)=900 (в 2.2× больше) → ложный «перегруз».
    var plans = [];
    for (var i = 0; i < 12; i++) plans.push(grouped('g' + i, '1', 30));
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }], { weights: null, dayCapacityMin: CAP });
    assertEqual(res.loadBefore['1'].minutes, SCRATCH + 12 * 30, '#3968 сгруппированная партия: 45 + 12×30 = 405 мин (не 900 «с нуля»)');
    assertEqual(res.loadBefore['1'].days, 1, '#3968 сгруппированная партия влезает в 1 день (405 ≤ 450), а не в 2 (900)');
})();

// ── 2) Балансировщик ЗАПОЛНЯЕТ недогруженный сгруппированный станок, а не считает его занятым ──
// Станок 1: маленькая сгруппированная партия (лёгкая). Станки 2/3/4: много РАЗНЫХ резок (тяжёлые,
// перелив на дни). Верный расчёт видит, что Станок 1 недогружен → тянет на него работу с 2/3/4.
(function () {
    var plans = [];
    for (var i = 0; i < 6; i++) plans.push(grouped('g' + i, '1', 30));           // Станок 1: 45 + 6×30 = 225 мин ≈ полдня
    ['2', '3', '4'].forEach(function (m) {
        for (var j = 0; j < 10; j++) plans.push(distinct(m + '_' + j, m, 120));   // 2/3/4: 10×(45+120)=1650 ≈ 4 дня каждый
    });
    var before = {};
    var res = planning.rebalanceSlitterLoad(plans, [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        { weights: null, dayCapacityMin: CAP,
          log: function (ev) { if (ev.event === 'start') before = ev.load; } });
    // Станок 1 стартует легчайшим (1 день), 2/3/4 — по ~4 дня.
    assertEqual(before['1'].days, 1, '#3968 старт: сгруппированный Станок 1 — 1 день (недогружен)');
    assert(before['2'].days >= 4, '#3968 старт: настроечно-разные Станки 2/3/4 перегружены (≥ 4 дня)');
    // Баланс тянет работу НА Станок 1 (было 6 резок, стало больше) — не оставляет его пустым.
    assert(res.moves.length > 0, '#3968 баланс сделал переносы (перекос виден)');
    assert((dist(plans)['1'] || 0) > 6, '#3968 ИТОГ: на недогруженный Станок 1 ПРИТЯНУЛИ работу (резок > 6), он не остался пустым');
    var maxAfter = Math.max(res.loadAfter['1'].days, res.loadAfter['2'].days, res.loadAfter['3'].days, res.loadAfter['4'].days);
    var maxBefore = Math.max(before['1'].days, before['2'].days, before['3'].days, before['4'].days);
    assert(maxAfter < maxBefore, '#3968 ИТОГ: максимальная загрузка станка снизилась (' + maxBefore + '→' + maxAfter + ' дней)');
})();

console.log('\n' + passed + ' assertions passed');
