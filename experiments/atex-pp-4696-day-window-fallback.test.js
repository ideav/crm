// #4696 — ФОЛБЭК ОКНА ДНЯ НЕ МОЛЧИТ + сквозной эффект потолка на добор дня.
//
// Почему в 11.08 легло 5 проходов вместо 7 (боевая ateh, Станок 1).
//
// Состояние взято с боевой (report/cut_planning, 11.08.2026):
//   676648  08:00  82 прохода  ножи 0  + сырьё 0  + резка 263 = 263 мин   срок 10.08 (просрочено)
//   668294  13:03   5 проходов ножи 0  + сырьё 15 + резка 32  =  47 мин   срок 11.08
//   668469  13:50   4 прохода  ножи 30 + сырьё 15 + резка 24  =  69 мин   срок 12.08  (фольга)
//   676880  14:59   7 проходов ножи 30 + сырьё 0  + резка 42  =  72 мин   срок 12.08  (фольга)
//   677004  12.08   16 проходов — продолжение 676880 (общая «первая часть» 676880)
// Итого 11.08 = 451 мин. Вчера то же самое стояло как 5 + 18 и давало 439 мин (число из #4693).
//
// Настройки смены ateh: 08:00–16:30, TOTAL_INTERVALS 20 → потолок резки 16:10, нахлёст 5 → 16:15
// (975-я минута), обед 12:20×40. Перерывы 10:00/15:00 в раскладку не входят (ТЗ §5).
//
// Проверяем ДВЕ версии причины «5 вместо 7»:
//   A. номер дня относительно «С» (просрочка 676648 и её веса);
//   B. потолок дня: 975 (TOTAL_INTERVALS+нахлёст прочитаны) против 960 (взят CLEANUP_SHIFT 30).
//
// Run with: node experiments/atex-pp-4696-day-fill-probe.test.js

process.env.TZ = 'Europe/Moscow';
global.window = { db: 'ateh', xsrf: 'x' };

var P = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0 };

// Ножи: 676648 и 668294 — ролик 110 (одинаковый набор), 668469 — ролик 30, 676880 — ролик 40.
function K(n, w) { var a = []; for (var i = 0; i < n; i++) a.push(w); return a; }
var KN110 = K(9, 110), KN30 = K(29, 30), KN40 = K(22, 40);

function cut(id, mat, knives, roller, runs, perPass) {
    return { id: id, materialId: mat, winding: 'IN', batchId: 'B' + id,
             knifeWidths: knives, knifeCount: knives.length, rollerWidth: roller,
             isFoil: (mat === '2240'), plannedRuns: runs, fixed: false,
             _runs: runs, _perPass: perPass };
}

// Цепочка 676880+677004 СЛИТА в одно задание на 23 прохода — состояние после mergeSplitChain.
function machineDay() {
    return [
        cut('676648', '1253', KN110, 110, 82, 263 / 82),
        cut('668294', '2208', KN110, 110,  5,  32 / 5),
        cut('668469', '2240', KN30,   30,  4,  24 / 4),
        cut('676880', '2240', KN40,   40, 23,   6.0)
    ];
}
// Заправка станка на утро: та же, что у 676648 → его наладка = 0 (как в базе).
var CARRY = { materialId: '1253', winding: 'IN', knifeWidths: KN110, rollerWidth: 110 };

function pack(cuts, over) {
    var perPass = {}, runs = {};
    cuts.forEach(function (c) { perPass[String(c.id)] = c._perPass; runs[String(c.id)] = c._runs; });
    var opts = {
        dayStartMin: 480,
        dayEndMin: 970,          // 16:10 = DAY_END 16:30 − TOTAL_INTERVALS 20
        dayEndHourMin: 990,      // 16:30
        maxOverworkCutsMin: 5,   // MAX_OVERWORK_CUTS_MN
        maxOverworkTuneMin: 10,  // MAX_OVERWORK_TUNE_MN
        lunchStartMin: 740, lunchDurationMin: 40,   // 12:20 × 40
        times: TIMES, perPassByCut: perPass, runsByCut: runs,
        carryPrevSetup: CARRY, gapFill: true, orderAuthoritative: true
    };
    for (var k in (over || {})) opts[k] = over[k];
    return P.splitMachineQueue(cuts, opts);
}

function runsOnDay(segs, cutId, day) {
    return segs.filter(function (s) {
        return String(s.cutId) === String(cutId) && s.dayOffset === day && !s.setupOnly;
    }).reduce(function (a, s) { return a + (Number(s.runs) || 0); }, 0);
}
function dayMinutes(segs, day) {
    return segs.filter(function (s) { return s.dayOffset === day; })
        .reduce(function (a, s) { return a + Math.round(Number(s.setupMin) || 0) + Math.ceil(Number(s.durationMin) || 0); }, 0);
}
function report(label, segs) {
    var d0 = segs.filter(function (s) { return s.dayOffset === 0; })
        .sort(function (a, b) { return a.windowStartMin - b.windowStartMin; });
    console.log('\n  ' + label);
    d0.forEach(function (s) {
        var st = Math.round(s.windowStartMin), hh = Math.floor(st / 60), mm = st % 60;
        console.log('    ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm +
            '  ' + s.cutId + '  проходов ' + s.runs +
            '  наладка ' + Math.round(s.setupMin) + '  резка ' + Math.ceil(s.durationMin));
    });
    console.log('    день 0 = ' + dayMinutes(segs, 0) + ' мин · цепочка на дне 0: ' +
        runsOnDay(segs, '676880', 0) + ' проходов, на дне 1: ' + runsOnDay(segs, '676880', 1));
}

// ── B. Потолок 975 (настройки прочитаны) ─────────────────────────────────────────────────
var full = pack(machineDay());
report('потолок 16:15 (TOTAL_INTERVALS 20 + нахлёст 5)', full);
assert(runsOnDay(full, '676880', 0) === 7,
    'при потолке 975 цепочка кладёт в 11.08 СЕМЬ проходов — как сегодня утром',
    '(' + runsOnDay(full, '676880', 0) + ')');

// ── B'. Потолок 960: TOTAL_INTERVALS не прочитан → взят CLEANUP_SHIFT 30, нахлёста нет ────
var noSettings = pack(machineDay(), { dayEndMin: 960, maxOverworkCutsMin: null, maxOverworkTuneMin: null });
report('потолок 16:00 (взят CLEANUP_SHIFT 30, нахлёст выключен)', noSettings);
assert(runsOnDay(noSettings, '676880', 0) === 5,
    'при потолке 960 цепочка кладёт в 11.08 ПЯТЬ проходов — как вчера (439 мин)',
    '(' + runsOnDay(noSettings, '676880', 0) + ')');

// ── B''. Каждая настройка по отдельности ─────────────────────────────────────────────────
var noOverwork = pack(machineDay(), { maxOverworkCutsMin: null, maxOverworkTuneMin: null });
report('потолок 16:10 (нахлёст выключен, TOTAL_INTERVALS прочитан)', noOverwork);
var noIntervals = pack(machineDay(), { dayEndMin: 960 });
report('потолок 16:00+5 (TOTAL_INTERVALS не прочитан, нахлёст есть)', noIntervals);

console.log('\n  проходов в 11.08 по вариантам: ' +
    'потолок 975 → ' + runsOnDay(full, '676880', 0) + ' · ' +
    '970 → ' + runsOnDay(noOverwork, '676880', 0) + ' · ' +
    '965 → ' + runsOnDay(noIntervals, '676880', 0) + ' · ' +
    '960 → ' + runsOnDay(noSettings, '676880', 0));
assert(dayMinutes(full, 0) === 451 && dayMinutes(noSettings, 0) === 439,
    'вилка узкая: 451 мин при потолке 16:15 и 439 при 16:00 — оба боевых состояния',
    '(' + dayMinutes(full, 0) + ' / ' + dayMinutes(noSettings, 0) + ')');

// ── C. Фолбэк окна дня НЕ МОЛЧИТ (workingWindowFallbacks) ────────────────────────────────
// Боевая «Настройка» ateh (269): все ключи потолка на месте — жаловаться не на что.
var ATEH = { DAY_START_HOUR: '8:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
             CLEANUP_SHIFT: '30', LUNCH_START: '12:20', LUNCH_DURATION: '40',
             MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };
function keys(cfg) { return P.workingWindowFallbacks(cfg, 30).map(function (m) { return m.key; }); }

assert(keys(ATEH).length === 0, 'боевые настройки ateh: фолбэков нет — молчим', JSON.stringify(keys(ATEH)));

var noTI = Object.assign({}, ATEH); delete noTI.TOTAL_INTERVALS;
assert(keys(noTI).join(',') === 'TOTAL_INTERVALS',
    'нет TOTAL_INTERVALS → назван ключ (потолок падает до «конец смены − уборка»)', JSON.stringify(keys(noTI)));
assert(P.workingWindowFallbacks(noTI, 30)[0].fallback.indexOf('30') >= 0,
    'сказано, ЧТО подставлено вместо него — уборка 30 мин');

var noOver = Object.assign({}, ATEH); delete noOver.MAX_OVERWORK_CUTS_MN; delete noOver.MAX_OVERWORK_TUNE_MN;
assert(keys(noOver).join(',') === 'MAX_OVERWORK_CUTS_MN',
    'нет обоих ключей нахлёста → назван (нахлёст выключен)', JSON.stringify(keys(noOver)));

var halfOver = Object.assign({}, ATEH); delete halfOver.MAX_OVERWORK_CUTS_MN;
assert(keys(halfOver).length === 0,
    'задан только TUNE_MN — второй наследует его (#3847), это не фолбэк', JSON.stringify(keys(halfOver)));

// Ровно тот случай, что дал 439: не доехали ОБА ключа потолка.
var broken = Object.assign({}, ATEH); delete broken.TOTAL_INTERVALS;
delete broken.MAX_OVERWORK_CUTS_MN; delete broken.MAX_OVERWORK_TUNE_MN;
assert(keys(broken).join(',') === 'TOTAL_INTERVALS,MAX_OVERWORK_CUTS_MN',
    'боевой случай 11.08: названы ОБА ключа, из-за которых потолок стал 16:00', JSON.stringify(keys(broken)));
var winBroken = P.resolveWorkingWindow(broken, 30);
assert(P.dayCeilingMin(winBroken, 'cuts') === 960 && P.dayCeilingMin(P.resolveWorkingWindow(ATEH, 30), 'cuts') === 975,
    'потолок резки: 960 без этих ключей против 975 с ними',
    '(' + P.dayCeilingMin(winBroken, 'cuts') + ' / ' + P.dayCeilingMin(P.resolveWorkingWindow(ATEH, 30), 'cuts') + ')');

var lunchHalf = Object.assign({}, ATEH); delete lunchHalf.LUNCH_DURATION;
assert(keys(lunchHalf).join(',') === 'LUNCH_DURATION',
    'задана половина обеда → назван недостающий ключ', JSON.stringify(keys(lunchHalf)));
var noLunch = Object.assign({}, ATEH); delete noLunch.LUNCH_START; delete noLunch.LUNCH_DURATION;
assert(keys(noLunch).length === 0, 'обеда нет вовсе — законная конфигурация, не фолбэк');

// ── D. Окно дня одной строкой (в лог без флага трассировки) ──────────────────────────────
var label = P.workingWindowLabel(P.resolveWorkingWindow(ATEH, 30));
console.log('\n  окно дня: ' + label);
assert(/08:00\.\.16:10/.test(label) && /потолок резки 16:15/.test(label) && /обед 12:20×40/.test(label),
    'строка окна называет окно, потолок резки и обед', label);

console.log('\n' + passed + ' проверок прошли из ' + total);
