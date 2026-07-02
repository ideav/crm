// Unit tests for ideav/crm#3978 — «Недогружен день с отпуском и следующий».
//
// Симптом (боевой ateh): у станка с ЧАСТИЧНЫМ простоем дня (напр. утро 08:00–10:00 после
// «Отпуска»/выходного — день начинается в 10:00) день держал ~99–129 мин вместо достижимых
// ~330, а работа каскадом стекала на следующие дни, которые тоже недобирали.
//
// Причина (предсуществующая, НЕ регресс #3974/#3976 — воспроизводится идентично до и после):
// splitMachineQueue пакует день ЛОГИЧЕСКИ от 08:00 БЕЗ учёта простоя, затем applyDowntime
// (shiftPlacementsPastDowntime) сдвигает ЦЕЛЫЕ сегменты за простой; вылезший за конец окна
// сегмент уходит на следующий день ЦЕЛИКОМ (дробить после сдвига нечем) → день с простоем
// недобирает. #3974 (набивка свободных от «С») лишь сделал баг виднее: свободные резки теперь
// сваливаются на первый день, где и стоит утренний простой.
//
// Фикс #3978: минуты простоя ВНУТРИ рабочего окна дня уменьшают его ёмкость (dayLostToBlock в
// effCapacity/availFor). Тогда укладчик ДРОБИТ резку по уменьшенной ёмкости и добивает
// частично-простойный день. Полностью заблокированный день (выходной #3788 / отпуск на всё окно)
// НЕ трогаем — им по-прежнему занимается applyDowntime (сумма простоя ≥ ёмкости → dayLostToBlock=0).
//
// Run with: node experiments/atex-production-planning-3978.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) { console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name); if (cond) passed++; else process.exitCode = 1; }

var DS = 480, DE = 970, DE_HOUR = 990, CAP = DE - DS - 40;   // окно 08:00–16:10, обед 40 → ёмкость 450
var OVERWORK = 5, CAP_END = DE + OVERWORK;                    // потолок конца сегмента 16:15
function cut(id, runs) {
    return { id: id, plannedRuns: runs, isFoil: false, fixed: false,
        material: { id: 'M', name: 'MW308' }, knifeWidths: [110], winding: 'OUT', length: 450 };
}
function place(cuts, blocked) {
    return planning.splitMachineQueue(cuts, {
        dayStartMin: DS, dayEndMin: DE, dayEndHourMin: DE_HOUR,
        maxOverworkCutsMin: OVERWORK, maxOverworkTuneMin: 10,
        times: { BETWEEN_CUTS: 0, KNIFE_CHANGE: 30, MATERIAL_CHANGE: 15, KNIFE: 30, MATERIAL_WINDING: 15 },
        leader: 0, gapFill: true, firstCutSetup: true, dayAnchorByCut: {},
        perPassByCut: cuts.reduce(function (o, c) { o[c.id] = 3.8; return o; }, {}),
        lunchStartMin: 740, lunchDurationMin: 40, blockedRanges: blocked || []
    });
}
function loadByDay(segs) {
    var d = {}; segs.forEach(function (s) { var k = Math.floor(s.windowStartMin / 1440);
        d[k] = (d[k] || 0) + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0); });
    return d;
}
function worstEnd(segs) {   // худший конец сегмента как time-of-day (для проверки перелива)
    var w = 0; segs.forEach(function (s) { var day = Math.floor(s.windowStartMin / 1440);
        var e = (s.windowStartMin - day * 1440) + (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0);
        if (e > w) w = e; });
    return w;
}

var cuts = [cut('a', 26), cut('b', 93), cut('c', 26), cut('d', 93)];   // ~934 мин работы всего

// ── 1) Частичный утренний простой 08:00–10:00: день 0 заполнен до своей уменьшенной ёмкости ──
(function () {
    var segs = place(cuts, [[480, 600]]);   // блок 120 мин → ёмкость дня 0 ≈ 330
    var d = loadByDay(segs);
    assert(d[0] >= 300, '#3978: день 0 с утренним простоем заполнен (' + Math.round(d[0]) +
        ' мин ≥ 300), а не недогружен ~129 как до фикса');
    assert(d[0] <= CAP + OVERWORK, '#3978: день 0 не переполнен (' + Math.round(d[0]) + ' ≤ ' + (CAP + OVERWORK) + ')');
    assert(worstEnd(segs) <= CAP_END, '#3978: ни один сегмент не выходит за конец смены (worst END ' +
        Math.round(worstEnd(segs)) + ' ≤ ' + CAP_END + ')');
})();

// ── 2) Работа не размазывается: с простоем занято не больше дней, чем плотно без него +1 ──
(function () {
    var withBlk = Object.keys(loadByDay(place(cuts, [[480, 600]]))).length;
    var noBlk = Object.keys(loadByDay(place(cuts, []))).length;
    assert(withBlk <= noBlk + 1, '#3978: простой добавляет не больше одного дня (дней с простоем ' +
        withBlk + ', без ' + noBlk + '), а не каскад недогруженных');
})();

// ── 3) Сохранность: суммарные минуты работы не меняются от простоя (ничего не потеряно) ──
(function () {
    var sum = function (d) { return Object.keys(d).reduce(function (a, k) { return a + d[k]; }, 0); };
    var s1 = sum(loadByDay(place(cuts, [[480, 600]])));
    var s0 = sum(loadByDay(place(cuts, [])));
    assert(Math.abs(s1 - s0) < 1, '#3978: суммарная работа с простоем = без простоя (' +
        Math.round(s1) + ' ≈ ' + Math.round(s0) + ')');
})();

// ── 4) Полностью заблокированный день (выходной) НЕ трогаем: dayLostToBlock=0, работает старый
//        путь applyDowntime — на заблокированный день ничего не садится ──
(function () {
    var segs = place([cut('x', 200)], [[2 * 1440, 4 * 1440]]);   // дни 2,3 — выходные (полный блок)
    var onBlocked = segs.some(function (s) { var dd = Math.floor(s.windowStartMin / 1440); return dd === 2 || dd === 3; });
    assert(!onBlocked, '#3978: на полностью заблокированные дни (выходные) работа не садится (путь applyDowntime не задет)');
})();

console.log('\n' + passed + ' assertions passed');
