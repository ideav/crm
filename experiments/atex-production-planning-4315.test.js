// #4315 — «дырка полчаса» после первого задания дня: заправка станка теряла КОЛИЧЕСТВО полос.
//
// Диагноз на боевых данных (ateh, Станок 3, 22.07): вчерашняя резка 625865 и первая сегодняшняя
// 636043 — обе MWR113L(2208) OUT с полосами 110 мм × 8, переставлять нечего. Хранимые колонки так и
// пишут: «Наладка ножей» 636043 = 0. А упаковщик брал заправку станка из отчёта prev_cut_setup, где
// строка = ПОЛОСА, и количество (batch_count) не читалось: 8 полос по 110 мм превращались в ОДИН нож.
// Против сегодняшних восьми это «переставить 7» → бинарная переналадка ножей KNIFE = 30 мин, на
// которую упаковщик сдвинул planStart следующего задания. В колонках этих 30 минут нет — отсюда
// пустые полчаса между 09:06 и 09:36, которых «не может быть, раз наладка записана»: она и не была
// записана, стороны считали ножи ОДНОЙ И ТОЙ ЖЕ вчерашней резки по разным источникам.
//
// #4371: отчёт prev_cut_setup убран, единственный источник заправки на входе в окно —
// prevSetupBeforeWindow по заданиям прошлых дней. Ножи там берутся из knifeWidths резки (их
// разворачивает по strip_qty aggregateStrips отчёта cut_strips), поэтому количество полос не
// теряется по построению. Проверки те же — на новом источнике.
//
// Run with: node experiments/atex-production-planning-4315.test.js

process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function eqo(a, e, name) {
    var ok = JSON.stringify(a) === JSON.stringify(e);
    assert(ok, name + (ok ? '' : '\n  ожидалось ' + JSON.stringify(e) + '\n  получено  ' + JSON.stringify(a)));
}

// Времена из таблицы «Время операции, мин» (ateh): ножи 30, смена сырья/намотки 15.
var TIMES = { KNIFE: 30, MATERIAL_WINDING: 15, BETWEEN_CUTS: 2 };

var BASE = Date.UTC(2026, 6, 22);            // «С» = 22.07.2026
var YESTERDAY = '2026-07-21 08:00:00';       // задание прошлого дня — оно и несёт заправку

function cut(over) {
    var o = { id: 'c', slitter: { id: '1282' }, planDate: YESTERDAY, planStart: 0,
              materialId: '2208', winding: 'OUT', knifeWidths: [] };
    if (over) Object.keys(over).forEach(function (k) { o[k] = over[k]; });
    o.knifeCount = o.knifeWidths.length;
    return o;
}
function widths(w, n) { var out = []; for (var i = 0; i < n; i++) out.push(w); return out; }

// ── 1) Заправка на входе в окно несёт ВСЕ ножи задания, а не один ────────────────────────────────
(function () {
    var setup = planning.prevSetupBeforeWindow(
        [cut({ id: '625865', knifeWidths: widths(110, 8) })], BASE)['1282'];
    eqo([setup.materialId, setup.winding, setup.knifeWidths, setup.knifeCount],
        ['2208', 'OUT', widths(110, 8), 8],
        '#4315: вчерашняя резка 110 мм × 8 → 8 ножей в заправке (было: 1)');

    // Полосы разной ширины — каждая по своему количеству (боевая задача 636453).
    var multi = planning.prevSetupBeforeWindow(
        [cut({ id: '636453', slitter: { id: '1279' }, materialId: '1253',
               knifeWidths: widths(154, 5).concat([110]) })], BASE)['1279'];
    eqo([multi.knifeWidths, multi.knifeCount], [[154, 154, 154, 154, 154, 110], 6],
        '#4315: полосы разной ширины сохраняются каждая по своему количеству (154×5 + 110×1)');
})();

// ── 2) Заправку несёт ПОСЛЕДНЕЕ задание раньше «С», задания окна её не задают ─────────────────────
(function () {
    var map = planning.prevSetupBeforeWindow([
        cut({ id: 'старое',  planDate: '2026-07-20 08:00:00', knifeWidths: widths(95, 4) }),
        cut({ id: 'вчера',   planDate: YESTERDAY,             knifeWidths: widths(110, 8) }),
        cut({ id: 'сегодня', planDate: '2026-07-22 08:00:00', knifeWidths: widths(60, 2) })
    ], BASE);
    eqo([map['1282'].knifeWidths, map['1282'].dayOffset], [widths(110, 8), -1],
        '#4315: заправка = последнее задание раньше «С» (вчерашнее), день −1');

    eqo(planning.prevSetupBeforeWindow(
        [cut({ id: 'сегодня', planDate: '2026-07-22 08:00:00', knifeWidths: widths(60, 2) })], BASE),
        {}, '#4315: заданий раньше «С» нет → станка в карте нет (первая резка считает настройку с нуля)');
})();

// ── 3) Эффект: фантомная переналадка ножей не возникает (та самая «дыра в полчаса») ───────────────
(function () {
    // Боевой случай: станок заправлен вчерашней резкой 110×8, сегодня первая резка — те же 110×8.
    var today = { id: '636043', materialId: '2208', winding: 'OUT', batchId: 'b1', rollerWidth: 0,
                  knifeWidths: widths(110, 8), knifeCount: 8 };
    function setupMin(setup) {
        return planning.changeoverParts(planning.carryOverPrevCut(setup, today), today, TIMES)
            .reduce(function (s, p) { return s + p.minutes; }, 0);
    }
    // Как было (количество отброшено): 1 нож против 8 → переставить 7 → KNIFE 30.
    var stale = { materialId: '2208', winding: 'OUT', knifeWidths: [110], knifeCount: 1 };
    assert(setupMin(stale) === 30,
        '#4315 (демонстрация): заправка в ОДИН нож против 8 → фантомные 30 мин наладки = наблюдаемая дыра');

    var carried = planning.prevSetupBeforeWindow(
        [cut({ id: '625865', knifeWidths: widths(110, 8) })], BASE)['1282'];
    assert(setupMin(carried) === 0,
        '#4315 (фикс): заправка 110×8 против 110×8 → переналадки нет (0), сходится с хранимой наладкой 0');

    // Реальная смена ножей по-прежнему считается: сегодня другая ширина.
    var other = { id: 'X', materialId: '2208', winding: 'OUT', batchId: 'b1', rollerWidth: 0,
                  knifeWidths: widths(95, 8), knifeCount: 8 };
    var parts = planning.changeoverParts(planning.carryOverPrevCut(carried, other), other, TIMES);
    assert(parts.length === 1 && parts[0].code === 'KNIFE' && parts[0].minutes === 30,
        '#4315: настоящая смена ножей (110×8 → 95×8) по-прежнему стоит 30 мин');
})();

console.log('\n' + passed + '/' + total + ' passed');
