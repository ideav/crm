// Тест #4288 — слой РАЗМЕЩЕНИЯ учитывает ТЕКУЩУЮ ЗАПРАВКУ станка (prev_cut_setup) у ПЕРВОЙ
// резки очереди станка.
//
// Симптом (issue #4288): 21.07 на станке 1277 зафиксирована комбинация 1253/OUT/59мм
// (report/prev_cut_setup её отдаёт). При планировании 22.07 первая резка станка 1277 встала
// как MW411/IN «с полной настройкой», а совпадающая по сырью/намотке резка 1253/OUT не
// получила преимущества открыть день — «комбинация 21.07 не подтянулась». Причина: слой
// размещения (scorePosition/computeSlotPlacement) НЕ получал prevSetupBySlitter, поэтому старт
// станка считался «с нуля» (index 0, prev=null → переход не штрафуется вообще). Упаковщик
// (splitMachineQueue carryPrevSetup, #3853) и оценка идеала (qualityIdeal, #4029) заправку уже
// учитывали — расходились ПОРЯДОК размещения и фактический тайминг/идеал.
//
// Фикс: первая резка очереди станка (index 0, реального prev нет) НАСЛЕДУЕТ заправку станка как
// виртуальный prev (carryOverPrevCut) — совпадающая по комбинации резка получает переход 0 и
// притягивается к «своему» станку/старту дня.
//
// Run with: node experiments/atex-production-planning-4288.test.js

var planning = require('../download/atex/js/production-planning.js').planning;
var P = planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

// резка контроллера → слот (как в 4085-slot-placement.test.js)
function C(id, o) {
    o = o || {};
    return P.slotFromCut({ id: id, slitter: o.m ? { id: o.m } : undefined, materialId: o.mat || 'M1',
        winding: o.w || 'OUT', knifeWidths: o.kw || [50], knifeCount: (o.kw || [50]).length,
        rollerWidth: 0, plannedRuns: o.runs || 1, isFoil: !!o.foil, workMin: o.wm != null ? o.wm : 1 }, o.due);
}
var ZERO = { KNIFE: 0, KNIFE_MOVE: 0, MATERIAL_WINDING: 0, BETWEEN_CUTS: 0 };   // обнулить настройку для чистой оценки дня
var BASE = new Date(2026, 6, 22, 0, 0, 0, 0).getTime();   // 22.07.2026 полночь (день планирования)

// ── scorePosition: index 0 наследует заправку станка ─────────────────────────────────────────────
(function () {
    // Заправка станка 1277 с прошлого дня (21.07): сырьё 1253, намотка OUT, нож 59мм.
    var carry = { '1277': { materialId: '1253', winding: 'OUT', knifeWidths: [59] } };
    var ctxNo    = { settings: {}, capacityMin: 450, times: ZERO, baseMidnightMs: BASE };                                        // без заправки в ctx
    var ctxCarry = { settings: {}, capacityMin: 450, times: ZERO, baseMidnightMs: BASE, slitterId: '1277', prevSetupBySlitter: carry };

    var sMatch = C('a', { mat: '1253', w: 'OUT', kw: [59] });    // ПРОДОЛЖАЕТ заправку 1277
    var sDiff  = C('b', { mat: 'MW411', w: 'IN', kw: [59] });    // другое сырьё/намотка (те же ножи)
    var sWide  = C('c', { mat: '1253', w: 'OUT', kw: [59, 59, 59] });   // то же сырьё, БОЛЬШЕ полос

    // Обратная совместимость: без prevSetupBySlitter старт станка по-прежнему весит 0.
    assert(P.scorePosition([], 0, sMatch, ctxNo).weight === 0, '#4288: без prevSetupBySlitter — index 0 весит 0 (совместимость)');
    assert(P.scorePosition([], 0, sDiff,  ctxNo).weight === 0, '#4288: без prevSetupBySlitter — index 0 весит 0 для любой резки');

    // С заправкой: совпадающая первая резка → 0; несовпадающая → реальная переналадка.
    assert(P.scorePosition([], 0, sMatch, ctxCarry).weight === 0,
        '#4288: первая резка ПРОДОЛЖАЕТ заправку 1277 (1253/OUT/59) → вес 0');
    var d = P.scorePosition([], 0, sDiff, ctxCarry);
    assert(d.weight === 15 && d.byFactor.material === 15,
        '#4288: первая резка НЕ совпала с заправкой (MW411/IN) → MATERIAL_CHANGE 15 (было 0)');
    var w = P.scorePosition([], 0, sWide, ctxCarry);
    assert(w.byFactor.knife === 50 && w.byFactor.material == null,
        '#4288: то же сырьё, больше полос (1→3) → KNIVES_INCREASE 50, сырьё не тронуто');

    // Заправка учитывается ТОЛЬКО у первой резки (index 0): при вставке ПОСЛЕ реальной резки
    // виртуальный prev не подставляется (prev — настоящая резка).
    var arr = [C('x', { mat: '1253', w: 'OUT', kw: [59] })];
    var after = P.scorePosition(arr, 1, sMatch, ctxCarry);
    assert(after.weight === 0, '#4288: вставка после реальной резки — переход считается от неё, не от заправки');
})();

// ── computeSlotPlacement: каждая резка уходит на «свой» станок по заправке ─────────────────────────
(function () {
    // На каждом станке — своя заправка с прошлого дня. Резки поданы в «неудобном» порядке
    // (MW411/IN первой). Без учёта заправки MW411/IN садилась на 1277 (меньший id, tie 0/0), а
    // 1253/OUT уходила на 1285 — старт 1277 НЕ совпадал с его комбинацией (симптом #4288).
    var prevBy = {
        '1277': { materialId: '1253',  winding: 'OUT', knifeWidths: [59] },
        '1285': { materialId: 'MW411', winding: 'IN',  knifeWidths: [50] }
    };
    var cutsInput = [
        { id: 'B', materialId: 'MW411', winding: 'IN',  knifeWidths: [50], knifeCount: 1, plannedRuns: 1 },   // ↔ заправка 1285
        { id: 'A', materialId: '1253',  winding: 'OUT', knifeWidths: [59], knifeCount: 1, plannedRuns: 1 }    // ↔ заправка 1277
    ];
    var ctx = { settings: {}, times: ZERO, capacityMin: 450, perPassByCut: { A: 1, B: 1 },
                baseMidnightMs: BASE, slitterIds: ['1277', '1285'], prevSetupBySlitter: prevBy, relocate: false };
    var res = P.computeSlotPlacement(cutsInput, ctx);
    assert(res.slitterByCut['A'] === '1277',
        '#4288: резка 1253/OUT ушла на станок 1277 (совпала с его заправкой), а не на 1285');
    assert(res.slitterByCut['B'] === '1285',
        '#4288: резка MW411/IN ушла на станок 1285 (совпала с его заправкой), а не на 1277');
})();

console.log('\n' + passed + '/' + total + ' passed');
