// Repro / regression for #4202 — «фольга не последняя». Штраф FOIL_NOTEND (фольга не в конце дня,
// #3717/#4085) был АСИММЕТРИЧЕН: начислялся, только когда ОЦЕНИВАЕМЫЙ слот сам фольга, а следом
// нефольга. Значит РЕШЕНИЕ О ПЕРЕМЕЩЕНИИ нефольги (её цена «остаться»/«встать» за фольгой) штраф НЕ
// видело → перемещение считало НЕПОЛНЫЙ набор штрафов и оставляло/ставило резку после фольги (жалоба
// юзера: «любое перемещение должно вычислять ВЕСЬ набор штрафов и их сумму»). Фикс: штраф симметричен —
// нефольга сразу после фольги В ТОМ ЖЕ дне тоже несёт FOIL_NOTEND.
//
// Сцена: на станке m1 зафиксирована (🔒) фольга F в начале дня; подвижную нефольгу X (те же ножи,
// переналадка с обеих сторон одинакова) размещаем. При равном весе слой дописывает В КОНЕЦ (betterCand,
// тай-брейк по индексу) → X встаёт ПОСЛЕ фольги (фольга не последняя). С симметричным штрафом позиция
// «после фольги» дороже на FOIL_NOTEND → X встаёт ПЕРЕД фольгой, фольга остаётся последней.
//
// Run with: node experiments/atex-production-planning-4202.test.js

var mod = require('../download/atex/js/production-planning.js');
var P = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var BASE = new Date(2026, 6, 1, 0, 0, 0, 0).getTime();   // ср 01.07.2026 = день 0
var DAY0_0800_SEC = Math.round(BASE / 1000) + 8 * 3600;  // planDate фикс. фольги (unix-сек, день 0 08:00)

// Общая конфигурация: одни ножи [50], один рулончик; F — фольга (зафиксирована), X/Y — нефольга.
function cut(id, material, isFoil, fixed) {
    return { id: id, slitter: { id: 'm1' }, materialId: material, winding: 'OUT',
             batchId: 'B1', knifeWidths: [50], knifeCount: 1, rollerWidth: 0,
             plannedRuns: 1, isFoil: !!isFoil, planDate: fixed ? DAY0_0800_SEC : '',
             status: '', fixed: !!fixed };
}

function run(cuts) {
    return P.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: {},
        dayStartMin: 480, dayEndMin: 960, dayEndHourMin: 960,
        maxOverworkCutsMin: 0, maxOverworkTuneMin: 0,
        lunchStartMin: 0, lunchDurationMin: 0, gapFill: true,
        preserveOrder: false, slotPlacement: true, firstCutSetup: false,
        prevSetupBySlitter: {}, intraDayResequence: true,
        perPassByCut: { F: 60, X: 60, Y: 60 }, slitterIds: ['m1']
    });
}

// Итоговый порядок id по planStart (все на одном станке).
function order(ops) {
    return (ops.updates || []).slice()
        .sort(function (a, b) { return Number(a.planStartTs) - Number(b.planStartTs); })
        .map(function (u) { return String(u.cutId); });
}
// Индекс последней фольги и есть ли нефольга ПОСЛЕ неё.
function foilNotLast(ord, foilIds) {
    var lastFoil = -1;
    ord.forEach(function (id, i) { if (foilIds.indexOf(id) >= 0) lastFoil = i; });
    if (lastFoil < 0) return false;
    for (var i = lastFoil + 1; i < ord.length; i++) if (foilIds.indexOf(ord[i]) < 0) return true;
    return false;
}

// ── Зафиксированная фольга F + подвижная нефольга X: X не должна встать после фольги ──────────────
(function () {
    var ops = run([cut('F', 'FOIL', true, true), cut('X', 'A', false, false)]);
    var ord = order(ops);
    console.log('  порядок:', ord.join(','));
    assert(!foilNotLast(ord, ['F']),
        '#4202: подвижная нефольга X не оказывается после зафиксированной фольги F (порядок ' + ord.join(',') + ')');
})();

// ── Две подвижные нефольги + зафиксированная фольга: обе перед фольгой ────────────────────────────
(function () {
    var ops = run([cut('F', 'FOIL', true, true), cut('X', 'A', false, false), cut('Y', 'A', false, false)]);
    var ord = order(ops);
    console.log('  порядок:', ord.join(','));
    assert(!foilNotLast(ord, ['F']),
        '#4202: обе нефольги (X,Y) перед фольгой F, фольга последняя (порядок ' + ord.join(',') + ')');
})();

console.log('\n' + passed + '/' + total + ' проверок прошло');
if (passed !== total) process.exitCode = 1;
