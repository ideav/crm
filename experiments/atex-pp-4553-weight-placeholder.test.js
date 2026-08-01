// Tests for ideav/crm#4553 — НОВОЕ ЗАДАНИЕ НЕ ВСТАЁТ ПОВЕРХ УЖЕ СТОЯЩЕГО В ДНЕ.
//
// Боевая ateh, 01.08.2026. Диспетчер создал задание формой «Новое производственное задание»:
// заказ 4461 (110 мм × 450 м, 1000 рул.), Станок 1, «День вставки: 03.08.2026». В этот день на
// Станке 1 уже стояло ЗАФИКСИРОВАННОЕ задание 655426 на 08:00 (MW411, 16 мин). Новое задание
// 656166 встало ТОЖЕ на 08:00 — два задания в одну минуту, день 468 мин при потолке ≈460.
// В трассе это видно так:
//   ⛔ #4464: нарушен монолит зафиксированных заданий — #655426 (зафиксированные задания дня
//      переставлены местами: 656166 ↔ 655426)
//
// ДВА КОРНЯ:
//   1) МЕСТО. `createCutForPosition` зовёт `moveCutToDay(..., 'weight', ...)`: место в дне обязан
//      выбрать упаковщик по весам (`scorePosition`), а плейсхолдер — быть НЕЙТРАЛЬНЫМ. Но
//      `planMoveSequences` различала только 'end', и ВСЁ остальное (включая 'weight') ставила
//      ГОЛОВОЙ дня. Дальше `planMoveStarts` для головы даёт `times[0] − 60` — то есть 07:59:
//      ДО начала смены и ПЕРЕД зафиксированным заданием, хотя #4497 говорит «перед 🔒 автоматика
//      не ставит ничего». Оттуда и «встало на 8:00 поверх уже стоявшего».
//   2) ЧИСЛО В ФОРМЕ. Подсказка обещала «Длительность резки: ~225 мин» — это ОДНА НАМОТКА
//      (`plannedCutDurationMinutes`), без лидера (2 мин × 125 проходов = 250) и без наладки (45).
//      Реальная занятость дня — 520 мин. Диспетчер выбирал день по числу, втрое меньшему правды,
//      и день переполнялся. Занятость обязана называться целиком: наладка + «Резка и Лидер».
//
// Run with: node experiments/atex-pp-4553-weight-placeholder.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'testdb', xsrf: 'x' };
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

// ── Фикстура боевого случая: день 03.08.2026, Станок 1 ──────────────────────────────────────
var DAY_MIDNIGHT = new Date(2026, 7, 3, 0, 0, 0, 0).getTime() / 1000;
var SHIFT_START = DAY_MIDNIGHT + 8 * 3600;          // 08:00 — начало смены
var FIXED_CUT = { id: '655426', planDate: SHIFT_START, knifeCount: 11, fixed: true };
var NEW_CUT = '656166';

// ── 1. «По весу» не занимает голову дня ──────────────────────────────────────────────────────
(function() {
    var seq = planning.planMoveSequences(NEW_CUT, [FIXED_CUT], 'weight');
    assert(seq.ordered[0] === '655426',
        '#4553 «по весу»: плейсхолдер НЕ ставит новое задание головой дня — впереди остаётся стоявшее',
        'ordered=' + JSON.stringify(seq.ordered));
    assert(seq.ordered.indexOf(NEW_CUT) === seq.ordered.length - 1,
        '#4553 «по весу»: новое задание идёт нейтральным хвостом (место выберет упаковщик)',
        'ordered=' + JSON.stringify(seq.ordered));
})();

// ── 2. Старт «по весу» — внутри смены и позже уже стоящего ───────────────────────────────────
(function() {
    var seq = planning.planMoveSequences(NEW_CUT, [FIXED_CUT], 'weight');
    var starts = planning.planMoveStarts(seq.ordered, [FIXED_CUT], NEW_CUT, SHIFT_START);
    var ts = starts.byCut[NEW_CUT];
    assert(ts >= SHIFT_START,
        '#4553 «по весу»: плейсхолдер-старт не раньше начала смены (08:00)',
        'ts=' + new Date(ts * 1000).toTimeString().slice(0, 5));
    assert(ts > FIXED_CUT.planDate,
        '#4553 «по весу»: новое задание не встаёт ПЕРЕД зафиксированным (#4497)',
        'новое=' + new Date(ts * 1000).toTimeString().slice(0, 5)
            + ' 🔒=' + new Date(FIXED_CUT.planDate * 1000).toTimeString().slice(0, 5));
    assert(ts !== FIXED_CUT.planDate,
        '#4553 два задания дня не получают ОДНО И ТО ЖЕ время старта');
})();

// ── 3. Явные 'start'/'end' работают как раньше (охрана от регресса #3602/#3923/#4221) ────────
(function() {
    var dayCuts = [
        { id: 'a', planDate: SHIFT_START, knifeCount: 3 },
        { id: 'b', planDate: SHIFT_START + 3600, knifeCount: 2 }
    ];
    assert(JSON.stringify(planning.planMoveSequences('M', dayCuts, 'start').ordered) === JSON.stringify(['M', 'a', 'b']),
        '#4553 регресс: «в начало дня» по-прежнему ставит задание первым');
    assert(JSON.stringify(planning.planMoveSequences('M', dayCuts, 'end').ordered) === JSON.stringify(['a', 'b', 'M']),
        '#4553 регресс: «в конец дня» по-прежнему ставит задание последним');
})();

// ── 4. Пустой день: «по весу» кладёт задание на начало смены ─────────────────────────────────
(function() {
    var seq = planning.planMoveSequences(NEW_CUT, [], 'weight');
    var starts = planning.planMoveStarts(seq.ordered, [], NEW_CUT, SHIFT_START);
    assert(JSON.stringify(seq.ordered) === JSON.stringify([NEW_CUT]),
        '#4553 пустой день: порядок — одно новое задание');
    assert(starts.byCut[NEW_CUT] === SHIFT_START,
        '#4553 пустой день: старт «по весу» — начало смены',
        'ts=' + new Date(starts.byCut[NEW_CUT] * 1000).toTimeString().slice(0, 5));
})();

// ── 5. Занятость дня формой — наладка + «Резка и Лидер», а не одна намотка ───────────────────
// Боевые числа заказа 4461: 125 проходов × 450 м, WIND_450 = 1.8 мин, лидер BETWEEN_CUTS = 2 мин.
// Форма показывала pl.duration (намотку) = 225 мин, а день задание съедало на 520.
(function() {
    var Controller = require('../download/atex/js/production-planning.js').Controller;
    var BASE = new Date(2026, 7, 3, 0, 0, 0, 0).getTime();
    var OP_TIMES = { WIND_450: 1.8, BETWEEN_CUTS: 2 };
    var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, KNIFE_MOVE: 0, BETWEEN_CUTS: 2, CLEANUP_SHIFT: 30 };
    var c = Object.create(Controller.prototype);
    c.busy = false; c.cuts = [];   // пустой станок: наладка нового = настройка ножей с нуля
    c.meta = { cut: { id: '1078', reqs: [] } };
    c.filter = { slitter: '', status: '', date: '2026-08-03', dateTo: '2026-08-08', query: '' };
    c.slitters = [{ id: '101', label: 'Станок 1' }];
    c.opTimes = OP_TIMES; c.changeTimes = TIMES;
    c.daySettings = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', LUNCH_START: '12:20',
        LUNCH_DURATION: '40', TOTAL_INTERVALS: '15' };
    c.supplies = []; c.genPositions = []; c.positionLengthById = {};
    c.footageBySupply = {}; c.consumptionByCut = {}; c.jumboWidthByMaterial = {};
    c.downtimesBySlitter = {}; c.calendarByDay = {}; c.freezeByDay = {};
    c.prevSetupBySlitter = {}; c.plannedTailSetup = {};
    c.nowMs = function() { return BASE + 9 * 3600000; };
    c.notify = function() {}; c.render = function() {}; c.setBusy = function() {};

    var knifeWidths = [];
    for (var i = 0; i < 8; i++) knifeWidths.push(110);
    var prospect = { id: '__new__', plannedRuns: 125, materialId: 'MW411', winding: 'OUT',
        knifeWidths: knifeWidths, runLength: 450 };

    var wind = planning.plannedCutDurationMinutes(450, 125, OP_TIMES, prospect);
    assert(Math.round(wind) === 225,
        '#4553 намотка 125 проходов × 450 м = 225 мин — это число и печатала форма',
        'wind=' + wind);

    var slot = c.freeSlotForCut('101', prospect);
    assert(!!slot, '#4553 свободное окно станка рассчитано');
    var occupancy = slot ? Math.round(slot.setupMin + slot.durationMin) : 0;
    assert(slot && Math.round(slot.durationMin) === 475,
        '#4553 «Резка и Лидер» = ceil(225) + 2×125 = 475 мин',
        'durationMin=' + (slot && slot.durationMin));
    assert(occupancy === 520,
        '#4553 занятость дня = наладка 45 (ножи 30 + сырьё/намотка 15) + «Резка и Лидер» 475 = 520 мин'
            + ' — форма обещала 225',
        'occupancy=' + occupancy);
    assert(occupancy > Math.round(wind) * 2,
        '#4553 занятость больше намотки более чем вдвое — одну намотку показывать нельзя');
})();

console.log('\n' + passed + '/' + total + ' проверок пройдено');
