// Unit tests for #3907 — окончание задания после конца смены (перелив дня) при выталкивании
// через окна простоя/выходные.
//
// Контекст: splitMachineQueue корректно режет очередь по дням (каждый сегмент ≤ овертайм-кап).
// Затем applyDowntime → shiftPlacementsPastDowntime переносит ЦЕЛЫЕ дневные сегменты за
// блокированные интервалы (выходные #3788 / «Отпуск станка» #3764), укладывая их встык курсором.
// Баг: nextFreeWorkMinute проверял только что НАЧАЛО within < dayEnd, но не что КОНЕЦ
// (m + len) влезает в рабочее окно дня. Полнодневный сегмент, сдвинутый на середину дня
// (например, после утреннего блока 08:00–10:35), вылезал за конец смены и НЕ перерезался.
//
// Реальный кейс ateh (#3907): резка 108 проходов после утреннего блока стартовала в 10:35
// и заканчивалась в ~17:26 — после конца смены 16:30 (овертайм-кап 16:35).
//
// Фикс (opt-in через fitEnd): сегмент, который ЦЕЛИКОМ помещается в рабочий день, но при
// текущем старте вылез бы за конец рабочего окна дня, выталкивается на 08:00 следующего
// рабочего дня. Сегменты, которые и так помещаются, не двигаются (хирургичность).
//
// Run with: node experiments/atex-production-planning-3907.test.js

process.env.TZ = 'UTC';

var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) { passed++; } else { process.exitCode = 1; }
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var TIMES = { BETWEEN_CUTS: 2, KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 2, CLEANUP_SHIFT: 30 };
function cut(id, runs) {
    return { id: id, slitter: { id: 'm1' }, materialId: 'M1', winding: 'OUT',
        knifeWidths: [100], knifeCount: 1, rollerWidth: 0, plannedRuns: runs };
}

// Реальная «Настройка» ateh: смена 08:00–16:30, овертайм резки +5 мин → кап 16:35 (995 мин).
var DS = 480, DE_HOUR = 990, OVERWORK = 5;
var OVERWORK_CAP = DE_HOUR + OVERWORK;   // 995 = 16:35
var opts = {
    dayStartMin: DS, dayEndMin: 970, dayEndHourMin: DE_HOUR,
    maxOverworkCutsMin: OVERWORK, maxOverworkTuneMin: 10,
    times: TIMES, lunchStartMin: 740, lunchDurationMin: 40, firstCutSetup: true
};

// time-of-day конца сегмента + его «реальный» день (после сдвига dayOffset устаревает,
// поэтому день выводим из windowStartMin).
function seg(s) {
    var ws = s.windowStartMin, len = (Number(s.setupMin) || 0) + (Number(s.durationMin) || 0);
    var day = Math.floor(ws / 1440);
    return { day: day, todStart: ws - day * 1440, todEnd: (ws - day * 1440) + len };
}

// ── 1) Утренний блок 08:00–10:35: полнодневная резка (108 проходов) ДРОБИТСЯ по ёмкости
//        частично-простойного дня (#3978) — ни один сегмент не переливается за конец смены, и
//        день 0 после блока НЕ простаивает. (До #3978 вся резка выталкивалась на день 1 целиком,
//        а день 0 после утреннего блока стоял пустым — это и был недогруз issue #3978.)
//        Инвариант #3907 сохранён: КОНЕЦ каждого сегмента ≤ овертайм-кап (перелива нет).
var bigSegs = planning.splitMachineQueue([cut('BIG', 108)],
    Object.assign({}, opts, { perPassByCut: { BIG: 1.81 }, runsByCut: { BIG: 108 },
        dayAnchorByCut: { BIG: 0 }, blockedRanges: [[480, 635]] }));
assert(bigSegs.length >= 1, '#3907: резка размещена');
bigSegs.forEach(function (s) {
    var g = seg(s);
    assert(g.todEnd <= OVERWORK_CAP,
        '#3907: сегмент (день ' + g.day + ') не выходит за конец смены (todEnd ' +
        Math.round(g.todEnd) + ' ≤ ' + OVERWORK_CAP + ')');
});
// #3978: день 0 после утреннего блока заполнен (не простаивает) — часть резки осталась в нём.
var big0 = bigSegs.filter(function (s) { return Math.floor(s.windowStartMin / 1440) === 0; });
assert(big0.length >= 1, '#3978: часть резки осталась в дне 0 — день после блока не простаивает');
assertEqual(seg(big0[0]).todStart, 635, '#3978: сегмент дня 0 стартует сразу после блока (10:35)');

// ── 2) Хирургичность: резка, которая ПОМЕЩАЕТСЯ после блока, остаётся в дне 0 ──
var smallSegs = planning.splitMachineQueue([cut('SMALL', 20)],
    Object.assign({}, opts, { perPassByCut: { SMALL: 1.81 }, runsByCut: { SMALL: 20 },
        dayAnchorByCut: { SMALL: 0 }, blockedRanges: [[480, 635]] }));
var small = seg(smallSegs[0]);
assertEqual(small.day, 0, '#3907: помещающаяся резка не двигается — остаётся в дне 0');
assertEqual(small.todStart, 635, '#3907: и стартует сразу после блока (10:35)');
assert(small.todEnd <= OVERWORK_CAP, '#3907: и тоже в пределах смены');

// ── 3) Выходные (#3788): резки, привязанные к разным дням, наложенные на день после выходных,
//        не переливаются — каждая в пределах смены ──
var many = [], mp = {}, mr = {}, ma = {};
for (var d = 2; d <= 6; d++) { var id = 'd' + d; many.push(cut(id, 100)); mp[id] = 1.81; mr[id] = 100; ma[id] = d; }
var wkSegs = planning.splitMachineQueue(many,
    Object.assign({}, opts, { perPassByCut: mp, runsByCut: mr, dayAnchorByCut: ma,
        blockedRanges: [[4 * 1440, 6 * 1440]] }));   // дни 4,5 — выходные
var worstEnd = 0;
wkSegs.forEach(function (s) { var e = seg(s).todEnd; if (e > worstEnd) worstEnd = e; });
assert(worstEnd <= OVERWORK_CAP,
    '#3907: после выходных ни одна резка не выходит за конец смены (worst END ' +
    Math.round(worstEnd) + ' ≤ ' + OVERWORK_CAP + ')');
// дни 4,5 заблокированы — ни один сегмент не должен стартовать в эти календарные дни
var onWeekend = wkSegs.some(function (s) { var dd = Math.floor(s.windowStartMin / 1440); return dd === 4 || dd === 5; });
assert(!onWeekend, '#3907: ни одна резка не попала на заблокированные выходные (дни 4,5)');

// ── 4) Без блокировок поведение не меняется (фикс — opt-in только при сдвиге за простой) ──
var plainSegs = planning.splitMachineQueue([cut('P', 108)],
    Object.assign({}, opts, { perPassByCut: { P: 1.81 }, runsByCut: { P: 108 }, dayAnchorByCut: { P: 0 } }));
var plain = seg(plainSegs[0]);
assertEqual(plain.day, 0, '#3907: без блокировок резка стартует в дне 0 как раньше');
assertEqual(plain.todStart, DS, '#3907: без блокировок старт — 08:00');

console.log('\n' + passed + ' assertions passed');
