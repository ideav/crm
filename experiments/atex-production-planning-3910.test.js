// Unit tests for #3910 / #3909 (потолок дня) — «Почему опять 494 мин во 2 июле?».
//
// Корень: splitMachineQueue (генерация «Сгенерировать») паковал день до нахлёста за DAY_END_HOUR
// (16:30) + MAX_OVERWORK → ~16:35, накапливая 475–494 РАБОЧИХ минут в одном станко-дне. По #3909
// потолок последнего задания дня = cutEndMin (DAY_END_HOUR − TOTAL_INTERVALS = 16:10) + нахлёст:
//   • заканчивается резкой   → ≤ cutEndMin + MAX_OVERWORK_CUTS (16:15)
//   • заканчивается настройкой → ≤ cutEndMin + MAX_OVERWORK_TUNE (16:20)
// Тогда рабочих минут в дне (без обеда) ≤ (cutEndMin−dayStart) − обед + нахлёст ≈ 455 — «494» больше
// невозможно. Обед в эту сумму не входит (резерв в бюджете, но не в подписи минут).
//
// Run with: node experiments/atex-production-planning-3910.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}

var TIMES = { BETWEEN_CUTS: 2, KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 2, CLEANUP_SHIFT: 30 };
function cut(id, mat, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: mat, winding: 'OUT',
        knifeWidths: [100], knifeCount: 1, rollerWidth: 0, plannedRuns: runs };
}

// Реальная «Настройка» ateh: 08:00–16:30, TOTAL_INTERVALS 20 → cutEndMin 16:10 (970); нахлёст резки
// 5, настройки 10; обед 12:20 / 40 мин. Путь генерации (9016): base-ветка, без gapFill/anchors.
var DAY_START = 480, CUT_END = 970, DAY_END_HOUR = 990, OVER_CUTS = 5, OVER_TUNE = 10, LUNCH = 40;
var CAP_CUTS = CUT_END + OVER_CUTS;   // 975 = 16:15
var CAP_TUNE = CUT_END + OVER_TUNE;   // 980 = 16:20
var opts = {
    dayStartMin: DAY_START, dayEndMin: CUT_END, dayEndHourMin: DAY_END_HOUR,
    maxOverworkCutsMin: OVER_CUTS, maxOverworkTuneMin: OVER_TUNE,
    times: TIMES, lunchStartMin: 740, lunchDurationMin: LUNCH, firstCutSetup: true
};

// Заведомо переполняющая очередь: 10 резок по 13 проходов, чередуем сырьё (каждая несёт настройку).
var cuts = [], pp = {}, rr = {};
for (var i = 0; i < 10; i++) { var id = 'c' + i; cuts.push(cut(id, 'M' + (i % 2), 13)); pp[id] = 5; rr[id] = 13; }
var segs = planning.splitMachineQueue(cuts, Object.assign({}, opts, { perPassByCut: pp, runsByCut: rr }));

// Группируем по реальному дню (день выводим из windowStartMin — dayOffset устаревает после сдвигов).
var byDay = {};
segs.forEach(function (s) {
    var ws = s.windowStartMin, day = Math.floor(ws / 1440), tod = ws - day * 1440;
    var work = (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0);
    var endTod = tod + work;
    var endsWithSetupOnly = !!s.setupOnly || !(Number(s.durationMin) > 0);
    if (!byDay[day]) byDay[day] = { work: 0, worstEnd: 0, worstCutEnd: 0, segs: 0 };
    byDay[day].work += work;
    byDay[day].segs++;
    if (endTod > byDay[day].worstEnd) byDay[day].worstEnd = endTod;
    if (!endsWithSetupOnly && endTod > byDay[day].worstCutEnd) byDay[day].worstCutEnd = endTod;
});
var days = Object.keys(byDay).map(Number).sort(function (a, b) { return a - b; });

// ── 1) Ни один день не заканчивается позже cutEndMin+TUNE (16:20) ──
var allWithinTune = days.every(function (d) { return byDay[d].worstEnd <= CAP_TUNE + 1e-6; });
assert(allWithinTune, '#3910: ни один станко-день не заканчивается позже cutEndMin+TUNE = 16:20 (' +
    days.map(function (d) { return 'd' + d + ':' + byDay[d].worstEnd; }).join(' ') + ')');

// ── 2) Сегмент, заканчивающийся РЕЗКОЙ, не выходит за cutEndMin+CUTS (16:15) ──
var cutsWithin = days.every(function (d) { return byDay[d].worstCutEnd <= CAP_CUTS + 1e-6; });
assert(cutsWithin, '#3910: задание, заканчивающееся резкой, не позже cutEndMin+CUTS = 16:15');

// ── 3) Рабочих минут в дне не больше бюджета (cutEndMin−dayStart)−обед+TUNE ≈ 460 → «494» невозможно ──
var WORK_CAP = (CUT_END - DAY_START) - LUNCH + OVER_TUNE;   // 490 − 40 + 10 = 460
var noOverbook = days.every(function (d) { return byDay[d].work <= WORK_CAP + 1e-6; });
assert(noOverbook, '#3910: рабочих минут в дне ≤ ' + WORK_CAP + ' (≈455), «494» больше не набирается (' +
    days.map(function (d) { return 'd' + d + ':' + Math.round(byDay[d].work); }).join(' ') + ')');

// ── 4) Контроль: со СТАРЫМ потолком (DAY_END_HOUR база) первый день держал бы > 460 раб. мин ──
// Эмулируем старую базу, подняв cutEndMin до DAY_END_HOUR (dayEndMin = 990): день переполняется.
var oldSegs = planning.splitMachineQueue(cuts, Object.assign({}, opts, {
    dayEndMin: DAY_END_HOUR, perPassByCut: pp, runsByCut: rr
}));
var oldDay0 = 0;
oldSegs.forEach(function (s) {
    if (Math.floor(s.windowStartMin / 1440) === 0) oldDay0 += (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0);
});
assert(oldDay0 > WORK_CAP, '#3910 контроль: старый потолок (DAY_END_HOUR) держал бы > ' + WORK_CAP +
    ' раб. мин в дне0 (было ' + Math.round(oldDay0) + ') — теперь нет');

console.log('\n' + passed + ' assertions passed');
