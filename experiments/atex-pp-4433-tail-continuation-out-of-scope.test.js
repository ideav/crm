// Tests for ideav/crm#4433 — «↻ Пересчитать наладку (заданий: 1)» на задании НАЛАДКИ, когда
// следующий день не входит в диапазон [С; По].
//
// СИМПТОМ: в дне N стоит setup-only хвост (0 проходов, #3635 п.5) — начатая наладка следующей
// резки; сама резка (продолжение цепочки) идёт в дне N+1. Пока N+1 виден, кнопки нет. Стоит
// сузить диапазон до дня N — на хвосте появляется расхождение и красная кнопка, хотя ни данные,
// ни порядок не менялись: изменился только показанный диапазон.
//
// КОРЕНЬ: onlyIds ограничивает НАБОР ЗАПИСИ (док у computeCutSetupUpdates, #3778/#4401), но в
// цикле дробления хвоста (#4030/#4111) им же отсекался ПОИСК ПРОДОЛЖЕНИЯ. Продолжение из дня N+1
// вне диапазона → «продолжения нет» → вся наладка остаётся на хвосте (tailKeep = fullK/fullM)
// вместо доли, которую записал упаковщик → расхождение с хранимым. Зеркальный случай: диапазон
// показывает только день N+1 — тогда хвост вне набора вообще не отдаёт продолжению свой остаток,
// и расхождение вылезает уже на продолжении.
//
// ПРАВИЛО (общее, а не про этот кейс): сужение набора ЗАПИСИ не меняет РАСЧЁТ. Что посчитано для
// задания при полном горизонте, то же должно получиться и когда в onlyIds попало только оно.
//
// Run with: node experiments/atex-pp-4433-tail-continuation-out-of-scope.test.js

process.env.TZ = 'UTC';
var api = require('../download/atex/js/production-planning.js');

var passed = 0, failed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { failed++; console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

var base = new Date(2026, 6, 1, 0, 0, 0).getTime();   // полночь 01.07.2026 (TZ=UTC)
var baseSec = Math.floor(base / 1000);
function ts(dayOffset, minuteOfDay) { return String(baseSec + dayOffset * 86400 + minuteOfDay * 60); }
var cutMeta = { id: '110', val: 'Задание в производство', reqs: [
    { id: '96067', val: 'Наладка ножей, мин' },
    { id: '96069', val: 'Сырье/намотка, мин' },
    { id: '96778', val: 'Резка и Лидер' }
] };
// ateh: 08:00–16:30, TOTAL_INTERVALS 20 → cutEndMin 16:10 (970); нахлёст настройки 10 → потолок 16:20.
var daySettings = { DAY_START_HOUR: '08:00', DAY_END_HOUR: '16:30', TOTAL_INTERVALS: '20',
    MAX_OVERWORK_CUTS_MN: '5', MAX_OVERWORK_TUNE_MN: '10' };

function icut(o) {
    return { id: o.id, slitter: { id: '1', label: 'Станок 1' },
        materialId: o.mat, winding: 'OUT', batchId: 'b', knifeWidths: o.kw, knifeCount: o.kw.length,
        rollerWidth: 0, isFoil: false, plannedRuns: o.runs, duration: o.dur || 0,
        planDate: ts(o.day, o.min), number: ts(o.day, o.min), firstPartId: o.first || '',
        storedKnifeSetupMin: '', storedMaterialWindingMin: '', storedCutAndLeaderMin: '' };
}

function makeCtrl(cuts, filter) {
    var ctrl = Object.create(api.Controller.prototype);
    ctrl.meta = { cut: cutMeta };
    ctrl.cuts = cuts;
    ctrl.changeTimes = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 0, CLEANUP_SHIFT: 30 };
    ctrl.daySettings = daySettings;
    ctrl.slitters = [{ id: '1', label: 'Станок 1' }];
    ctrl.prevSetupBySlitter = {};
    ctrl.downtimesBySlitter = {};
    ctrl.calendarByDay = {};
    ctrl.filter = filter || { date: '2026-07-01', dateTo: '' };
    return ctrl;
}

// Очередь из приложенного к тикету плана: P (обычная резка, 08:00–16:01) → T (setup-only хвост
// дня N, 16:01, голова цепочки) → C (продолжение, день N+1 08:00, 8 проходов, firstPartId = T).
// Дни упакованы встык от начала смены, поэтому старты честные (recalcStartUpdates молчит) и
// расхождение, если оно появится, может прийти только от колонок наладки.
function queue() {
    return [
        icut({ id: 'P', mat: 'MW411',  kw: [70], runs: 4, dur: 436, day: 0, min: 8 * 60 }),
        icut({ id: 'T', mat: 'MWR200', kw: [50], runs: 0, dur: 0,   day: 0, min: 16 * 60 + 1, first: 'T' }),
        icut({ id: 'C', mat: 'MWR200', kw: [50], runs: 8, dur: 26,  day: 1, min: 8 * 60,      first: 'T' })
    ];
}

// Хранимое = то, что записал бы полный расчёт (весь горизонт). Дальше сужаем ТОЛЬКО набор записи.
function withStoredFromFullScope() {
    var cuts = queue();
    var ctrl = makeCtrl(cuts);
    var by = {};
    ctrl.computeCutSetupUpdates(null).updates.forEach(function(u) { by[String(u.cutId)] = u; });
    cuts.forEach(function(c) {
        var u = by[String(c.id)];
        if (!u) return;
        c.storedKnifeSetupMin = String(u.knife);
        c.storedMaterialWindingMin = String(u.material);
        c.storedCutAndLeaderMin = String(u.cutTime);
    });
    return cuts;
}

// ── Часть 1. Расчёт колонок не зависит от того, что попало в onlyIds ─────────
(function () {
    var cuts = withStoredFromFullScope();
    var stored = {};
    cuts.forEach(function(c) { stored[c.id] = { knife: c.storedKnifeSetupMin, material: c.storedMaterialWindingMin }; });

    // Контроль: раскладка упаковщика — хвост держит в дне N только смену сырья, ножи у продолжения (#4111).
    assertEqual(stored.T, { knife: '0', material: '15' }, '#4111 (контроль): хвост T хранит в дне N только сырьё 15');
    assertEqual(stored.C, { knife: '30', material: '0' }, '#4111 (контроль): продолжение C хранит вынесенные ножи 30');

    function updatesFor(onlyIds) {
        var out = {};
        makeCtrl(cuts).computeCutSetupUpdates(onlyIds, { dryRun: true }).updates.forEach(function(u) {
            out[String(u.cutId)] = { knife: u.knife, material: u.material };
        });
        return out;
    }

    assertEqual(updatesFor(null), {}, 'полный горизонт: хранимое совпало с расчётом — писать нечего');

    // Диапазон показывает только день N: продолжение C вне набора записи, но оно есть в очереди
    // станка — значит хвост по-прежнему отдаёт ему ножи и хранит свои 15.
    assertEqual(updatesFor(['P', 'T']), {},
        '#4433: день N без дня N+1 — расчёт хвоста тот же, расхождения нет');

    // Зеркально: диапазон показывает только день N+1. Хвост вне набора записи, но остаток наладки
    // он всё равно передаёт продолжению — иначе у C «пропали» бы 30 минут ножей.
    assertEqual(updatesFor(['C']), {},
        '#4433: день N+1 без дня N — продолжение сохраняет наладку, переданную хвостом');

    // Общее правило: для КАЖДОГО задания одиночный снимок даёт то же, что полный горизонт.
    cuts.forEach(function(c) {
        assertEqual(updatesFor([String(c.id)]), {},
            '#4433: onlyIds=[' + c.id + '] — сужение набора записи не меняет расчёт');
    });
})();

// ── Часть 2. Детектор кнопки «↻ Пересчитать наладку» ─────────────────────────
// Кнопка в renderQueue показывается ровно при непустом recalcMismatchIds (20-controller.js).
(function () {
    var cuts = withStoredFromFullScope();

    function mismatchIn(from, to) {
        var ctrl = makeCtrl(cuts, { date: from, dateTo: to });
        return ctrl.recalcMismatchIds('1');
    }

    assertEqual(mismatchIn('2026-07-01', '2026-07-02'), [],
        'оба дня видны — кнопки нет (так на экране и было)');
    assertEqual(mismatchIn('2026-07-01', '2026-07-01'), [],
        '#4433: следующий день вне диапазона — кнопки всё равно нет');
    assertEqual(mismatchIn('2026-07-02', '2026-07-02'), [],
        '#4433: виден только день продолжения — кнопки нет');
    assertEqual(mismatchIn('2026-07-01', ''), [],
        'открытый правый край диапазона — кнопки нет');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
