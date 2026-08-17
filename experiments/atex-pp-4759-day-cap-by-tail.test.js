// #4759 — ПОТОЛОК ДНЯ ВЫБИРАЕТ ЕГО ХВОСТ.
//
// РЕШЕНИЕ ЗАКАЗЧИКА (17.08.2026, дословно): «Если на конец дня приходится наладка ножей или смена
// сырья, то потолок 450+MAX_OVERWORK_TUNE_MN. Если же на конец дня приходится резка, то потолок
// 450+MAX_OVERWORK_CUTS_MN».
//
// Спор «455 или 460» был поставлен неверно: правильны ОБА числа, и выбирает между ними не
// потребитель мерки, а сам день — тем, что пришлось на его конец. Упаковщик так и паковал
// (`availFor(day,'cuts')` для проходов, `availFor(day,'tune')` для хвоста настройки, #3743/#3805/
// #3847), а судили его ВСЕ мерки потолком резки: законный день, кончающийся наладкой, объявлялся
// нарушением на 1…5 минут. На корпусе фаззера (120 планов × 5 входов) это давало 70 срабатываний
// DAY_CAPACITY; после правила осталось 8 — и все они про ДРУГОЕ (перебор при 🔒 в дне, #4759 п.2).
//
// Run with: node experiments/atex-pp-4759-day-cap-by-tail.test.js

process.env.TZ = 'UTC';
var mod = require('../download/atex/js/production-planning.js');
var planning = mod.planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eq(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : ' (ожидалось ' + JSON.stringify(e) + ', получено ' + JSON.stringify(a) + ')'));
}

// Боевое окно ateh: смена 08:00, резка до 16:10, обед 40 мин, нахлёст резки 5, настройки 10.
var WIN = { startMin: 480, cutEndMin: 970, lunchDurationMin: 40,
            maxOverworkCutsMin: 5, maxOverworkTuneMin: 10 };

// ── 1) Правило в одной функции ────────────────────────────────────────────────────────────────
eq(planning.dayTailKind(12), 'cuts', '#4759: на конце дня резка → мерим потолком РЕЗКИ');
eq(planning.dayTailKind(0), 'tune', '#4759: на конце дня одна наладка → потолком НАСТРОЙКИ');
eq(planning.dayTailKind(null), 'tune', '#4759: минут резки нет вовсе — это настройка');
eq(planning.dayCapacityMinutes(WIN, planning.dayTailKind(12)), 455, '#4759: день, кончающийся резкой — 450+5');
eq(planning.dayCapacityMinutes(WIN, planning.dayTailKind(0)), 460, '#4759: день, кончающийся наладкой — 450+10');

// ── 2) Мерка перебора по ХРАНИМЫМ колонкам судит день его же потолком ─────────────────────────
// День 458 минут: 455 работы + 3 минуты хвоста. Кончается РЕЗКОЙ → перебор 3.
var BASE = Date.UTC(2026, 7, 18, 0, 0, 0);
function cut(id, startMin, knife, mat, cutMin) {
    return { id: id, slitter: { id: 'm1' },
             planDate: String(Math.floor((BASE + startMin * 60000) / 1000)),
             storedKnifeSetupMin: knife, storedMaterialWindingMin: mat, storedCutAndLeaderMin: cutMin,
             plannedRuns: cutMin > 0 ? 5 : 0 };
}
var measureOpts = { baseMidnightMs: BASE, dayStartMin: WIN.startMin, cutEndMin: WIN.cutEndMin,
                    lunchDurationMin: WIN.lunchDurationMin, maxOverworkCutsMin: WIN.maxOverworkCutsMin,
                    maxOverworkTuneMin: WIN.maxOverworkTuneMin };

// (а) 458 минут, последним — задание С РЕЗКОЙ: потолок 455, перебор 3.
var endsWithCut = planning.overfilledDaysFromCuts(
    [cut('a', 480, 30, 15, 200), cut('b', 725, 0, 0, 213)], measureOpts);
eq(endsWithCut.length, 1, '#4759: день на 458 мин, кончающийся резкой — перебор есть');
eq([endsWithCut[0].tail, endsWithCut[0].overMin], ['cuts', 3],
    '#4759: мерка назвала хвост «резка» и перебор 3 (458 при 455)');

// (б) те же 458 минут, но последним стои́т ОГРЫЗОК ИЗ ОДНОЙ НАЛАДКИ (0 проходов, #4021):
//     день кончается настройкой → потолок 460, нарушения НЕТ.
var endsWithSetup = planning.overfilledDaysFromCuts(
    [cut('a', 480, 30, 15, 383), cut('c', 878, 30, 0, 0)], measureOpts);
eq(endsWithSetup.length, 0,
    '#4759: те же 458 минут, но день кончается наладкой — это НЕ нарушение (потолок 460)');

// (в) 462 минуты с наладкой на конце — уже за потолком настройки.
var overTune = planning.overfilledDaysFromCuts(
    [cut('a', 480, 30, 15, 387), cut('c', 882, 30, 0, 0)], measureOpts);
eq([overTune.length && overTune[0].tail, overTune.length && overTune[0].overMin], ['tune', 2],
    '#4759: 462 мин с наладкой на конце — перебор 2 (потолок 460)');

// ── 3) Страж судит станко-день ТЕМ ЖЕ правилом ────────────────────────────────────────────────
// Контекст стража: занятость дня даёт упаковщик (ops.dayLoad), хвост — он же (ops.dayTail).
function ctxFor(load, tails) {
    return {
        dayLoadMinutes: function() { return load; },
        dayCapacityMin: function(key) {
            var kind = (key != null && tails) ? (tails[String(key)] || 'cuts') : 'cuts';
            return planning.dayCapacityMinutes(WIN, kind);
        },
        fixedHeldDays: function() { return []; },
        dayKeyOfTs: function() { return null; }
    };
}
var opsStub = { updates: [], creates: [], deletes: [] };
var vTune = planning.checkPlanInvariants(opsStub,
    ctxFor({ 'm1|20260818': 458 }, { 'm1|20260818': 'tune' }), 'auto') || [];
eq(vTune.filter(function(v) { return v.rule === 'DAY_CAPACITY'; }).length, 0,
    '#4759: страж молчит про 458 мин в дне, который кончается наладкой');
var vCuts = planning.checkPlanInvariants(opsStub,
    ctxFor({ 'm1|20260818': 458 }, { 'm1|20260818': 'cuts' }), 'auto') || [];
eq(vCuts.filter(function(v) { return v.rule === 'DAY_CAPACITY'; }).length, 1,
    '#4759: тот же день с резкой на конце страж называет переполненным');

// ── 4) Упаковщик СООБЩАЕТ, чем кончается каждый день ──────────────────────────────────────────
// Один станок, работы на два дня: в первом день закрывает резка, во втором — тоже.
(function () {
    var cuts = [
        { id: 'c1', slitter: { id: 'm1' }, materialId: 'MW308', winding: 'IN', knifeWidths: [59, 59],
          knifeCount: 2, rollerWidth: 59, plannedRuns: 60, planDate: String(Math.floor(BASE / 1000) + 8 * 3600),
          duration: '420', storedCutAndLeaderMin: 420 }
    ];
    var ops = planning.planCutOperations(cuts, {
        planBaseMidnightMs: BASE, weights: {}, times: { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 },
        dayStartMin: 480, dayEndMin: 970, dayEndHourMin: 990,
        maxOverworkCutsMin: 5, maxOverworkTuneMin: 10, lunchStartMin: 740, lunchDurationMin: 40,
        firstCutSetup: true, prevSetupBySlitter: {}, perPassByCut: { c1: 7 },
        slitterIds: ['m1'], dueDayByCut: {}, dueKeyByCut: {}, dayAnchorByCut: {}
    });
    assert(ops.dayTail && Object.keys(ops.dayTail).length > 0,
        '#4759: раскладка отдаёт dayTail — чем кончается каждый станко-день');
    var tails = Object.keys(ops.dayTail).map(function(k) { return ops.dayTail[k]; });
    assert(tails.every(function(t) { return t === 'cuts' || t === 'tune'; }),
        '#4759: значения dayTail — только «cuts» или «tune»');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
