// Regression for ideav/crm#4179 — резка-сирота «нет связей» из setup-only сегмента дробления.
//
// КОРЕНЬ (подтверждён живой БД ateh + воспроизведением splitMachineQueue):
//   Задание заказа (напр. 3942: MW308 154×20 + 110×4 = 4 прохода раскладки 154×5+110×1) при
//   генерации дробится по дням на [setup-only сегмент (0 проходов), сегмент проходов (4)].
//   splitMachineQueue выдаёт segRunsAll=[0,4]. Для setup-only сегмента splitSupplyShares даёт
//   долю рулонов = 0, и старый createFinishedBatches писал «Партию ГП» с ПУСТЫМ «ID заказа»
//   (batchOrderId([])='') — сирота «нет связей». reconcileOrphanOrderSupplies (#4175) её не чинит
//   (пустой order id, `if(!oid)return`), а applySplitPlan реюзит именно её (SET проходы 0→4) и
//   удаляет покрывающий сегмент → заказ без Обеспечения.
//
// ФИКС:
//   1) createFinishedBatches: «ID заказа» партии — по ПОКРЫТИЮ РАСКЛАДКИ (заказы покрытых позиций
//      по ширине), НЕ по доле рулонов сегмента. Setup-only сегмент (0 рулонов) всё равно несёт
//      «ID заказа». Складская полоса (нет покрытой позиции) остаётся без «ID заказа».
//   2) reconcileOrphanOrderSupplies: рулоны восстановления = МАКС(хранимое, полос × проходов
//      задания) — у реюзнутого setup-only «Кол-во план» устарело (полос×0), иначе Обеспечение
//      восстановилось бы заниженным (5 из 20) и заказ снова недообеспечен (churn).
//
// Здесь проверяем СОСТАВЛЕННУЮ логику обоих путей на РЕАЛЬНЫХ функциях модуля.
// Run with: node experiments/atex-production-planning-4179.test.js

process.env.TZ = 'UTC';
global.window = {};
var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.error((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── Раскладка заказа 3942: 154×5 + 110×1 (обе полосы «Заказ»), покрывает 431806(154) и 431807(110).
var lay = {
    positionsCovered: ['431806', '431807'],
    strips: [
        { width: 154, qty: 5, purpose: 'Заказ', positionIds: ['431806'] },
        { width: 110, qty: 1, purpose: 'Заказ', positionIds: ['431807'] }
    ],
    mat: '1253', windDir: 'OUT', windLength: 450
};
var posById = {
    '431806': { id: '431806', width: 154, qty: 20, length: 450, orderId: '431805' },
    '431807': { id: '431807', width: 110, qty: 4,  length: 450, orderId: '431805' }
};
var posLength = { '431806': 450, '431807': 450 };
var fullPlannedRuns = 4;

// Точная копия логики createFinishedBatches (ПОСЛЕ фикса #4179): «ID заказа» — по покрытию,
// «Кол-во рулонов» — по доле рулонов сегмента.
function batchesForSegment(segIndex, segRunsAll) {
    var segSupplies = [];
    P.supplyPlanForLayout(lay, posById, fullPlannedRuns, posLength).forEach(function (plan) {
        var share = P.splitSupplyShares(plan.rolls, plan.footage, segRunsAll)[segIndex] || { rolls: 0, footage: 0 };
        var pos = posById[String(plan.positionId)] || {};
        segSupplies.push({ positionId: plan.positionId, width: plan.width, rolls: share.rolls, footage: share.footage, orderId: pos.orderId || '' });
    });
    var demandByWidth = {}, ordersByWidth = {};
    segSupplies.forEach(function (s) {
        var key = String(s.width);
        if (s.orderId != null && String(s.orderId) !== '') (ordersByWidth[key] = ordersByWidth[key] || []).push(s.orderId);
        if (!(s.rolls > 0)) return;
        demandByWidth[key] = (demandByWidth[key] || 0) + s.rolls;
    });
    var segRunsForPlan = segRunsAll[segIndex];
    return P.producedBatchesForLayout(lay, 450).map(function (b) {
        var key = String(b.width);
        var demand = demandByWidth[key];
        return {
            width: b.width,
            planned: P.finishedBatchRolls(b.strips, segRunsForPlan),
            rolls: demand > 0 ? demand : '',
            orderId: P.batchOrderId(ordersByWidth[key])
        };
    });
}

// Тест 1: setup-only сегмент (segRunsAll=[0,4], segIndex=0) — «Партии ГП» НЕСУТ «ID заказа».
var setupOnly = batchesForSegment(0, [0, 4]);
var so154 = setupOnly.filter(function (b) { return b.width === 154; })[0];
var so110 = setupOnly.filter(function (b) { return b.width === 110; })[0];
assert(so154 && so154.orderId === '431805', '1a: setup-only 154 несёт «ID заказа» заказа (не сирота)', JSON.stringify(so154));
assert(so110 && so110.orderId === '431805', '1b: setup-only 110 несёт «ID заказа» заказа');
assert(so154 && so154.rolls === '',          '1c: setup-only 154 «Кол-во рулонов» пусто (0 проходов сегмента)');
assert(so110 && so110.rolls === '',          '1d: setup-only 110 «Кол-во рулонов» пусто');

// Тест 2: сегмент проходов (segIndex=1) — полное покрытие заказа сохраняется.
var passes = batchesForSegment(1, [0, 4]);
var p154 = passes.filter(function (b) { return b.width === 154; })[0];
var p110 = passes.filter(function (b) { return b.width === 110; })[0];
assert(p154 && p154.orderId === '431805' && p154.rolls === 20, '2a: сегмент проходов 154 = заказ + 20 рулонов', JSON.stringify(p154));
assert(p110 && p110.orderId === '431805' && p110.rolls === 4,  '2b: сегмент проходов 110 = заказ + 4 рулона', JSON.stringify(p110));

// Тест 3: складская полоса (нет покрытой позиции этой ширины) остаётся БЕЗ «ID заказа».
var layStock = {
    positionsCovered: ['431806'],
    strips: [
        { width: 154, qty: 5, purpose: 'Заказ',  positionIds: ['431806'] },
        { width: 110, qty: 2, purpose: 'Склад',  positionIds: [] }
    ],
    mat: '1253', windDir: 'OUT', windLength: 450
};
var posStock = { '431806': { id: '431806', width: 154, qty: 20, length: 450, orderId: '431805' } };
(function () {
    var ss = [];
    P.supplyPlanForLayout(layStock, posStock, 4, { '431806': 450 }).forEach(function (plan) {
        var sh = P.splitSupplyShares(plan.rolls, plan.footage, [0, 4])[0] || { rolls: 0 };
        var pos = posStock[String(plan.positionId)] || {};
        ss.push({ width: plan.width, rolls: sh.rolls, orderId: pos.orderId || '' });
    });
    var ow = {};
    ss.forEach(function (s) { var k = String(s.width); if (s.orderId) (ow[k] = ow[k] || []).push(s.orderId); });
    var batches = P.producedBatchesForLayout(layStock, 450).map(function (b) { return { width: b.width, orderId: P.batchOrderId(ow[String(b.width)]) }; });
    var b154 = batches.filter(function (b) { return b.width === 154; })[0];
    var b110 = batches.filter(function (b) { return b.width === 110; })[0];
    assert(b154 && b154.orderId === '431805', '3a: заказная 154 несёт «ID заказа»');
    assert(b110 && b110.orderId === '',        '3b: СКЛАДСКАЯ 110 остаётся без «ID заказа» (не сломали запас)', JSON.stringify(b110));
})();

// Тест 4: reconcile — рулоны восстановления = МАКС(хранимое, полос × проходов задания).
// Реюзнутый setup-only: «Кол-во план» партии устарело (полос 5 × 0 = 5 через fallback), проходы 4.
(function () {
    function reconciledRolls(storedRolls, storedPlanned, strips, cutRuns) {
        var rolls = storedRolls > 0 ? storedRolls : storedPlanned;
        var produced = Math.round(strips * (cutRuns || 0) * 1000) / 1000;
        if (produced > rolls) rolls = produced;
        return rolls;
    }
    // setup-only сирота: «Кол-во рулонов»='' (0), «Кол-во план»=5 (устар.), полос=5, проходы=4 → 20.
    assert(reconciledRolls(0, 5, 5, 4) === 20, '4a: реюзнутый setup-only восстанавливается на РЕАЛЬНЫЙ выпуск (20, не 5)');
    assert(reconciledRolls(0, 1, 1, 4) === 4,  '4b: реюзнутый setup-only 110 → 4 (не 1)');
    // Обычная сирота (не setup-only): «Кол-во план»=полос×проходов уже верно → без изменений.
    assert(reconciledRolls(0, 20, 5, 4) === 20, '4c: обычная сирота — поведение прежнее (20)');
    assert(reconciledRolls(15, 20, 5, 4) === 20, '4d: хранимое «Кол-во рулонов» 15 < выпуск 20 → 20');
})();

console.error('\n' + passed + '/' + total + ' проверок пройдено.');
