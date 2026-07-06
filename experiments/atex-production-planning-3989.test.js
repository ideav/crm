// Unit tests for #3989 (Фаза 1) — фундамент нового алгоритма планирования (ТЗ
// docs/atex_planning_tz.md): веса штрафов из «Настройки», стоимость размещения слота
// (вес + «качество») и оценка качества плана (факт vs идеал переналадок).
//
// Аддитивная фаза: движок раскладки не менялся, эти функции проверяются изолированно.
//
// Run with: node experiments/atex-production-planning-3989.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, failed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { failed++; process.exitCode = 1; }
}
function eq(a, b, name) { assert(a === b, name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')'); }
function near(a, b, name) { assert(Math.abs(a - b) < 1e-6, name + ' (' + a + ' ≈ ' + b + ')'); }

// Веса из ТЗ §14 (те же дефолты, что в коде).
var SETTINGS = {
    KNIVES_CHANGE_COST_MN: 30, KNIVES_INCREASE_COST_MN: 50, MATERIAL_CHANGE_COST_MN: 15,
    LEADER_COST_MN: 2, FOIL_NOTEND_COST_MN: 60, DEADLINE_COST_MN: 100, EXACT_DEADLINE_COST_MN: 33,
    MAX_DISTANCE_COST_MN: 25
};

// knifeWidths развёрнут по числу ножей (как в реальных данных, aggregateStrips).
function bands(spec) { // {110:3,60:5} → [110,110,110,60,60,60,60,60]
    var out = [];
    Object.keys(spec).forEach(function(w){ for (var i = 0; i < spec[w]; i++) out.push(Number(w)); });
    return out;
}
function cut(o) {
    o = o || {};
    var kw = o.bands ? bands(o.bands) : (o.knifeWidths || []);
    return {
        id: o.id, slitterId: o.slitterId, dayKey: o.dayKey, planStartMs: o.planStartMs,
        knifeWidths: kw, knifeCount: o.knifeCount != null ? o.knifeCount : kw.length,
        materialId: o.materialId != null ? o.materialId : 'X', winding: o.winding != null ? o.winding : 'IN',
        batchId: o.batchId != null ? o.batchId : '', leader: o.leader, sleeveId: o.sleeveId,
        rollerWidth: o.rollerWidth, isFoil: o.isFoil, dueKey: o.dueKey
    };
}

// ---------------------------------------------------------------------------
console.log('\n== planWeight: настройка / дефолт ==');
eq(planning.planWeight(SETTINGS, 'KNIVES_INCREASE_COST_MN'), 50, 'берёт значение из настроек');
eq(planning.planWeight({}, 'DEADLINE_COST_MN'), 100, 'дефолт ТЗ при пустой настройке');
eq(planning.planWeight({ FOIL_NOTEND_COST_MN: 'abc' }, 'FOIL_NOTEND_COST_MN'), 60, 'нечисловое → дефолт');

// ---------------------------------------------------------------------------
console.log('\n== stripPrefixQuality: пример из ТЗ ==');
var prevQ = cut({ bands: { 110: 3, 60: 5, 40: 10 } });   // 3 полосы (110,60,40)
var nextQ = cut({ bands: { 110: 3, 60: 5, 30: 13 } });   // совпали 110,60 → 2 из 3
near(planning.stripPrefixQuality(prevQ, nextQ), 3 / 2, 'ТЗ пример 110,60,40 → 110,60,30 = 3/2');
near(planning.stripPrefixQuality(prevQ, prevQ), 1, 'идентичный набор → качество 1');
var noKnives = cut({ knifeWidths: [] });
eq(planning.stripPrefixQuality(prevQ, noKnives), 0, 'нет ножей у нового → качество 0');

// ---------------------------------------------------------------------------
console.log('\n== transitionCost: ножи change vs increase, сырьё, лидер ==');
// Меньше полос → KNIVES_CHANGE (30).
var less = planning.transitionCost(cut({ bands: { 110: 1, 60: 1, 40: 1 } }), cut({ bands: { 110: 1, 60: 1 } }), { settings: SETTINGS });
eq(less.byFactor.knife, 30, 'полос стало меньше → KNIVES_CHANGE 30');
// Больше полос → KNIVES_INCREASE (50).
var more = planning.transitionCost(cut({ bands: { 110: 1, 60: 1 } }), cut({ bands: { 110: 1, 60: 1, 40: 1 } }), { settings: SETTINGS });
eq(more.byFactor.knife, 50, 'полос стало больше → KNIVES_INCREASE 50');
// Смена сырья + намотки.
var mat = planning.transitionCost(cut({ materialId: 'A', bands: { 100: 2 } }), cut({ materialId: 'B', bands: { 100: 2 } }), { settings: SETTINGS });
eq(mat.byFactor.material, 15, 'смена сырья → MATERIAL_CHANGE 15');
eq(mat.byFactor.knife, undefined, 'тот же набор ножей → без штрафа ножей');
// Тот же набор и сырьё → нулевой вес.
var same = planning.transitionCost(cut({ materialId: 'A', bands: { 100: 2 } }), cut({ materialId: 'A', bands: { 100: 2 } }), { settings: SETTINGS });
eq(same.weight, 0, 'идентичная конфигурация → вес 0');
// Исключение: смена после «хвоста» прошлого дня бесплатна.
var free = planning.transitionCost(cut({ materialId: 'A', bands: { 100: 2 } }), cut({ materialId: 'B', bands: { 60: 3 } }), { settings: SETTINGS, freeAfterCarry: true });
eq(free.weight, 0, 'freeAfterCarry → вес 0 (продолжение прошлого дня)');

// ---------------------------------------------------------------------------
console.log('\n== transitionCost: ситуативные факторы ==');
var base = cut({ materialId: 'A', bands: { 100: 2 }, isFoil: true });
var foil = planning.transitionCost(base, cut({ materialId: 'A', bands: { 100: 2 }, isFoil: true }), { settings: SETTINGS, foilNotEnd: true });
eq(foil.byFactor.foilNotEnd, 60, 'фольга не в конце дня → FOIL_NOTEND 60');
var mv = planning.transitionCost(base, cut({ materialId: 'A', bands: { 100: 2 }, isFoil: true }), { settings: SETTINGS, isMove: true });
eq(mv.byFactor.foilMove, 60, 'перемещение фольги → FOIL_NOTEND 60');
// Срок: позже дня → DEADLINE; равен дню → EXACT_DEADLINE (дословно по ТЗ §8 п.4/5).
var late = planning.transitionCost(base, cut({ dueKey: 20260710 }), { settings: SETTINGS, placementDayKey: 20260703 });
eq(late.byFactor.deadline, 100, 'срок позже дня размещения → DEADLINE 100');
var exact = planning.transitionCost(base, cut({ dueKey: 20260703 }), { settings: SETTINGS, placementDayKey: 20260703 });
eq(exact.byFactor.exactDeadline, 33, 'срок равен дню размещения → EXACT_DEADLINE 33');
var dist = planning.transitionCost(base, cut({}), { settings: SETTINGS, distanceExceeded: true });
eq(dist.byFactor.distance, 25, 'большой простой между станками → MAX_DISTANCE 25');

// ---------------------------------------------------------------------------
console.log('\n== insertionCost: сумма двух переходов ==');
var ins = planning.insertionCost(
    cut({ materialId: 'A', bands: { 100: 2 } }),
    cut({ materialId: 'B', bands: { 100: 2 } }),   // сырьё A→B (15), назад B→A (15)
    cut({ materialId: 'A', bands: { 100: 2 } }),
    { settings: SETTINGS }, { settings: SETTINGS });
eq(ins.weight, 30, 'вставка между A и A слота B = 15 + 15');

// ---------------------------------------------------------------------------
console.log('\n== planQuality: факт vs идеал, два окна, первое задание ==');
// Станок C1: заправка на входе = сырьё A, набор {100} (1 нож). Слоты по дням.
var slots = [
    // день 03: тот же набор {100}+A, что заправка → 0 переналадок у первого
    cut({ id: 1, slitterId: 'C1', dayKey: 20260703, planStartMs: 3, bands: { 100: 1 }, materialId: 'A' }),
    // день 03: смена сырья A→B (15), ножи те же ({100})
    cut({ id: 2, slitterId: 'C1', dayKey: 20260703, planStartMs: 4, bands: { 100: 1 }, materialId: 'B' }),
    // день 05 (за «По»): полос стало больше {100}→{100,60} = KNIVES_INCREASE 50, сырьё B→B нет
    cut({ id: 3, slitterId: 'C1', dayKey: 20260705, planStartMs: 5, bands: { 100: 1, 60: 1 }, materialId: 'B' })
];
var pq = planning.planQuality(slots, {
    settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260704,
    prevSetupBySlitter: { C1: { materialId: 'A', winding: 'IN', knifeWidths: [100] } }
});
// Окно [03;04]: только смена сырья слота 2 → 1 переналадка, 15 мин.
eq(pq.window.changeoverCount, 1, 'окно [С;По]: 1 переналадка (смена сырья)');
eq(pq.window.changeoverMin, 15, 'окно [С;По]: 15 мин');
// Всё [03;∞): + смена ножей слота 3 (50) → 2 переналадки, 65 мин.
eq(pq.all.changeoverCount, 2, 'всё: 2 переналадки');
eq(pq.all.changeoverMin, 65, 'всё: 15 + 50 (KNIVES_INCREASE) = 65 мин');
// СЫРОЕ разнообразие: разные наборы ножей = {100},{100,60} → 2; разные сырья = A,B → 2.
// #4029: идеал (count/minutes) КРЕДИТУЕТ заправку C1=A/{100} — она закрывает набор {100} и сырьё A,
// нужно наладок: 1 набор ({100,60}) + 1 сырьё (B) = 2, мин = 1*30 + 1*15 = 45 (было 4/90 без кредита).
eq(pq.ideal.knifeConfigs, 2, 'идеал: 2 разных набора ножей (СЫРОЕ разнообразие)');
eq(pq.ideal.materials, 2, 'идеал: 2 разных сырья (СЫРОЕ разнообразие)');
eq(pq.ideal.count, 2, 'идеал: 2 наладки нужно при заправке A/{100} (было 4 без кредита)');
eq(pq.ideal.minutes, 45, 'идеал: 45 мин (1*30 ножи + 1*15 сырьё; заправка закрыла старт)');
eq(pq.qualityAll.excessCount, 2 - 2, 'избыток (всё): факт 2 − идеал 2 = 0 (≥ 0, заправка учтена в идеале)');

// Первое задание без заправки — заложить наладку ножей + смену сырья (§13 п.4).
var firstNoSetup = planning.planQuality(
    [cut({ id: 9, slitterId: 'C2', dayKey: 20260703, bands: { 100: 2 }, materialId: 'A' })],
    { settings: SETTINGS, scopeFromKey: 20260703, scopeToKey: 20260703 }
);
eq(firstNoSetup.window.knifeCount, 1, 'первое задание без заправки: наладка ножей заложена');
eq(firstNoSetup.window.materialCount, 1, 'первое задание без заправки: смена сырья заложена');
eq(firstNoSetup.window.changeoverMin, 45, 'первое задание: 30 (ножи) + 15 (сырьё) = 45 мин');

// ---------------------------------------------------------------------------
console.log('\n----------------------------------------');
console.log('ИТОГО: ' + passed + ' passed, ' + failed + ' failed');
